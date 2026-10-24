/** @vitest-environment jsdom */
/** Tests the actual background writer ordering independently of a tab UI. */
import { describe, expect, it, vi } from 'vitest';
import {
  createPromptWriteCoordinator, PROMPT_COMMIT_TYPE, PROMPT_STORAGE_KEY,
  type PromptCommitRequest,
} from '@/features/myPrompts/promptWriteCoordinator';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const make = (id: string): SavedPrompt => ({
  id, ownerId: 'account-1', title: id, content: id, createdAt: 1, updatedAt: 1,
});
const request = (next: SavedPrompt[]): PromptCommitRequest =>
  ({ type: PROMPT_COMMIT_TYPE, action: 'replace-account', ownerId: 'account-1', next });

function backing(initial: SavedPrompt[] = []) {
  let current = initial.map((item) => ({ ...item }));
  let rejectNext = false;
  const get = vi.fn(async () => ({ [PROMPT_STORAGE_KEY]: current.map((item) => ({ ...item })) }));
  const set = vi.fn(async (values: Record<string, unknown>) => {
    if (rejectNext) { rejectNext = false; throw new Error('quota exceeded'); }
    current = (values[PROMPT_STORAGE_KEY] as SavedPrompt[]).map((item) => ({ ...item }));
  });
  return {
    storage: { get, set } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>,
    current: () => current,
    get, set,
    failOnce: () => { rejectNext = true; },
  };
}

describe('background single-tab prompt writer', () => {
  it('writes validated replacements in order', async () => {
    const box = backing([make('initial')]);
    const writer = createPromptWriteCoordinator(box.storage);
    expect(await writer.commit(request([make('initial'), make('a')]))).toEqual({ ok: true });
    expect(await writer.commit(request([make('initial'), make('a'), make('b')]))).toEqual({ ok: true });
    expect(box.current().map((p) => p.id)).toEqual(['initial', 'a', 'b']);
  });

  it('a restarted worker reads persisted storage', async () => {
    const box = backing([make('initial')]);
    await createPromptWriteCoordinator(box.storage).commit(request([make('first')]));
    expect(await createPromptWriteCoordinator(box.storage).commit(request([make('second')])))
      .toEqual({ ok: true });
    expect(box.current()).toEqual([make('second')]);
  });

  it('rejects invalid data and duplicate IDs', async () => {
    const box = backing();
    const writer = createPromptWriteCoordinator(box.storage);
    expect(await writer.commit(request([make('same'), make('same')])))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(await writer.commit({ type: PROMPT_COMMIT_TYPE, next: [{ id: '__proto__' }] }))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(await writer.commit({ type: 'unknown', next: [] }))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(box.set).not.toHaveBeenCalled();
  });

  it('preserves prompts belonging to other accounts during account replacement', async () => {
    const other = { ...make('other'), ownerId: 'account-2' };
    const box = backing([make('initial'), other]);
    const writer = createPromptWriteCoordinator(box.storage);
    expect(await writer.commit(request([make('updated')]))).toEqual({ ok: true });
    expect(box.current()).toEqual([other, make('updated')]);
    const collision = { ...make('other'), ownerId: 'account-1' };
    expect(await writer.commit(request([collision]))).toEqual({
      ok: false, error: '提示词 ID 与其他账号的数据冲突，未保存。',
    });
    expect(box.current()).toEqual([other, make('updated')]);
  });

  it('protects malformed legacy storage from replacement', async () => {
    const get = vi.fn(async () => ({ [PROMPT_STORAGE_KEY]: 'unexpected' }));
    const set = vi.fn();
    const writer = createPromptWriteCoordinator({ get, set } as unknown as chrome.storage.StorageArea);
    expect(await writer.commit(request([make('fresh')])))
      .toEqual({ ok: false, error: 'Prompt storage contains invalid data; refusing to overwrite it' });
    expect(set).not.toHaveBeenCalled();
  });

  it('recovers from a failed storage write', async () => {
    const box = backing([make('original')]);
    const writer = createPromptWriteCoordinator(box.storage);
    box.failOnce();
    expect(await writer.commit(request([]))).toMatchObject({
      ok: false, error: expect.stringContaining('quota exceeded'),
    });
    expect(box.current()).toEqual([make('original')]);
    expect(await writer.commit(request([make('original'), make('new')]))).toEqual({ ok: true });
    expect(box.current().map((p) => p.id)).toEqual(['original', 'new']);
  });

  it('avoids redundant storage writes for identical data', async () => {
    const box = backing([make('original')]);
    expect(await createPromptWriteCoordinator(box.storage).commit(request([make('original')])))
      .toEqual({ ok: true });
    expect(box.set).not.toHaveBeenCalled();
  });
});
