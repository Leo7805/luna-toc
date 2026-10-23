/** @vitest-environment jsdom */
/** Tests the actual background writer ordering independently of a tab UI. */
import { describe, expect, it, vi } from 'vitest';
import {
  createPromptWriteCoordinator, PROMPT_COMMIT_TYPE, PROMPT_STORAGE_KEY,
  type PromptCommitRequest,
} from '@/features/myPrompts/promptWriteCoordinator';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const make = (id: string): SavedPrompt => ({
  id, title: id, content: id, createdAt: 1, updatedAt: 1,
});
const request = (expected: SavedPrompt[], next: SavedPrompt[]): PromptCommitRequest =>
  ({ type: PROMPT_COMMIT_TYPE, expected, next });

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

describe('background conditional prompt writer', () => {
  it('serializes concurrent commits and conflicts the second stale snapshot', async () => {
    const box = backing([make('initial')]);
    const writer = createPromptWriteCoordinator(box.storage);
    const results = await Promise.all([
      writer.commit(request([make('initial')], [make('initial'), make('a')])),
      writer.commit(request([make('initial')], [make('initial'), make('b')])),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: false, conflict: true }]);
    expect(box.current().map((p) => p.id)).toEqual(['initial', 'a']);
    expect(box.set).toHaveBeenCalledTimes(1);
  });

  it('fresh coordinator after worker suspension observes persisted storage', async () => {
    const box = backing([make('initial')]);
    const writer1 = createPromptWriteCoordinator(box.storage);
    expect(await writer1.commit(request([make('initial')], [make('initial'), make('a')])))
      .toEqual({ ok: true });
    const writer2 = createPromptWriteCoordinator(box.storage);
    expect(await writer2.commit(request([make('initial')], [make('initial'), make('b')])))
      .toEqual({ ok: false, conflict: true });
    expect(await writer2.commit(request([make('initial'), make('a')], [
      make('initial'), make('a'), make('b'),
    ]))).toEqual({ ok: true });
    expect(box.current().map((p) => p.id)).toEqual(['initial', 'a', 'b']);
  });

  it('invalid data and duplicate IDs never reach storage', async () => {
    const box = backing();
    const writer = createPromptWriteCoordinator(box.storage);
    expect(await writer.commit(request([], [make('same'), make('same')])))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(await writer.commit({ type: PROMPT_COMMIT_TYPE, expected: [], next: [{ id: '__proto__' }] }))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(await writer.commit({ type: 'unknown', expected: [], next: [] }))
      .toEqual({ ok: false, error: 'Invalid prompt update request' });
    expect(box.set).not.toHaveBeenCalled();
  });

  it('rejects malformed existing storage rather than destroying it', async () => {
    const get = vi.fn(async () => ({ [PROMPT_STORAGE_KEY]: 'unexpected' }));
    const set = vi.fn();
    const writer = createPromptWriteCoordinator({ get, set } as unknown as chrome.storage.StorageArea);
    expect(await writer.commit(request([], [make('fresh')])))
      .toEqual({ ok: false, error: 'Prompt storage contains invalid data; refusing to overwrite' });
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps the commit queue usable after a storage rejection', async () => {
    const box = backing([make('original')]);
    const writer = createPromptWriteCoordinator(box.storage);
    box.failOnce();
    expect(await writer.commit(request([make('original')], [])))
      .toEqual({ ok: false, error: 'quota exceeded' });
    expect(box.current()).toEqual([make('original')]);
    expect(await writer.commit(request([make('original')], [make('original'), make('new')])))
      .toEqual({ ok: true });
    expect(box.current().map((p) => p.id)).toEqual(['original', 'new']);
  });

  it('avoids a redundant write if a retry proposes the already-committed snapshot', async () => {
    const box = backing([make('original')]);
    const writer = createPromptWriteCoordinator(box.storage);
    const same = request([make('original')], [make('original')]);
    expect(await writer.commit(same)).toEqual({ ok: true });
    expect(box.set).not.toHaveBeenCalled();
  });
});
