/** Tests serial background TOC alias commits and persistent deletion fences. */
import { describe, expect, it, vi } from 'vitest';
import {
  createTocAliasWriteCoordinator, TOC_ALIAS_COMMIT_TYPE,
  TOC_ALIAS_PREFIX, TOC_ALIAS_DELETED_PREFIX,
  type TocAliasCommitRequest,
} from '@/features/conversationPrompts/tocAliasWriteCoordinator';

const route = 'conversation-123';
const key = TOC_ALIAS_PREFIX + route;
const deletedKey = TOC_ALIAS_DELETED_PREFIX + route;
const update = (messageId: string, expected: string | null, label: string | null,
  ownerId: string | null = 'account-1'): TocAliasCommitRequest =>
  ({ type: TOC_ALIAS_COMMIT_TYPE, action: 'update', routeKey: route,
    messageId, expected, label, ownerId });
const remove = (): TocAliasCommitRequest =>
  ({ type: TOC_ALIAS_COMMIT_TYPE, action: 'delete-conversation', routeKey: route });

function backing(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  let rejectSet = false;
  let rejectRemove = false;
  const get = vi.fn(async (keys: string | string[]) => {
    const requested = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(requested.filter((name) => Object.hasOwn(data, name))
      .map((name) => [name, data[name]]));
  });
  const set = vi.fn(async (values: Record<string, unknown>) => {
    if (rejectSet) { rejectSet = false; throw new Error('set failed'); }
    Object.assign(data, values);
  });
  const removeKey = vi.fn(async (keys: string | string[]) => {
    if (rejectRemove) { rejectRemove = false; throw new Error('remove failed'); }
    for (const name of typeof keys === 'string' ? [keys] : keys) delete data[name];
  });
  return {
    data, get, set, removeKey,
    storage: { get, set, remove: removeKey } as unknown as chrome.storage.StorageArea,
    failSet: () => { rejectSet = true; },
    failRemove: () => { rejectRemove = true; },
  };
}

describe('background TOC alias coordinator', () => {
  it('merges concurrent edits to distinct messages without losing data', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    const results = await Promise.all([
      writer.commit(update('msg-a', null, 'Title A')),
      writer.commit(update('msg-b', null, 'Title B')),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-1',
      aliases: { 'msg-a': 'Title A', 'msg-b': 'Title B' } });
  });

  it('rejects overlapping renames and restores with stale expected labels', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect((await writer.commit(update('msg', null, 'first'))).ok).toBe(true);
    expect(await writer.commit(update('msg', null, 'second')))
      .toEqual({ ok: false, conflict: true });
    expect(await writer.commit(update('msg', null, null)))
      .toEqual({ ok: false, conflict: true });
    expect((await writer.commit(update('msg', 'first', 'second'))).ok).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-1', aliases: { msg: 'second' } });
  });

  it('uses persistent data after worker restart and retains other message aliases on restore', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect((await writer.commit(update('msg-a', null, 'first'))).ok).toBe(true);
    const restarted = createTocAliasWriteCoordinator(box.storage);
    expect((await restarted.commit(update('msg-b', null, 'second'))).ok).toBe(true);
    expect((await restarted.commit(update('msg-a', 'first', null))).ok).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-1', aliases: { 'msg-b': 'second' } });
  });

  it('fences deletion before removal and rejects stale writes after restart', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect((await writer.commit(update('msg', null, 'initial'))).ok).toBe(true);
    expect(await writer.commit(remove())).toEqual({ ok: true, deleted: true });
    expect(box.data[deletedKey]).toBe(true);
    expect(box.data[key]).toBeUndefined();
    expect(await createTocAliasWriteCoordinator(box.storage).commit(update('msg', null, 'stale')))
      .toEqual({ ok: false, error: 'Conversation has been deleted' });
    expect(box.data[key]).toBeUndefined();
  });

  it('serializes delete after an in-flight edit', async () => {
    const box = backing();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    box.set.mockImplementationOnce(async (values: Record<string, unknown>) => {
      await gate;
      Object.assign(box.data, values);
    });
    const writer = createTocAliasWriteCoordinator(box.storage);
    const pending = writer.commit(update('msg', null, 'pending'));
    await vi.waitFor(() => expect(box.set).toHaveBeenCalledTimes(1));
    const deletion = writer.commit(remove());
    release();
    expect((await pending).ok).toBe(true);
    expect(await deletion).toEqual({ ok: true, deleted: true });
    expect(box.data[key]).toBeUndefined();
  });

  it('keeps a durable fence if alias removal fails', async () => {
    const box = backing({ [key]: { ownerId: null, aliases: { msg: 'old' } } });
    const writer = createTocAliasWriteCoordinator(box.storage);
    box.failRemove();
    expect(await writer.commit(remove())).toEqual({ ok: false, error: 'remove failed' });
    expect(box.data[deletedKey]).toBe(true);
    expect(await writer.commit(update('msg', 'old', 'new')))
      .toEqual({ ok: false, error: 'Conversation has been deleted' });
  });

  it('refuses invalid records, conflicting owners and hostile message identifiers', async () => {
    const box = backing({ [key]: { ownerId: 'account-A', aliases: { msg: 'original' } } });
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect(await writer.commit(update('msg', 'original', 'overwrite', 'account-B')))
      .toEqual({ ok: false, error: 'Conversation belongs to another account' });
    expect((await writer.commit({ ...update('msg', null, 'x'), messageId: '__proto__' })).ok)
      .toBe(false);
    expect((await writer.commit({ ...update('msg', null, 'x'), label: 'x'.repeat(241) })).ok)
      .toBe(false);
    const malformed = backing({ [key]: 'corrupt' });
    expect(await createTocAliasWriteCoordinator(malformed.storage)
      .commit(update('msg', null, 'new')))
      .toEqual({ ok: false, error: 'Invalid saved TOC aliases' });
    expect(malformed.data[key]).toBe('corrupt');
    expect(box.data[key]).toEqual({ ownerId: 'account-A', aliases: { msg: 'original' } });
  });

  it('requires a non-null verified account even when old scripts submit a write', async () => {
    const box = backing({ [key]: { ownerId: 'account-A', aliases: { msg: 'Keep' } } });
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect(await writer.commit(update('msg', 'Keep', 'Changed', null)))
      .toEqual({ ok: false, error: 'Verified ChatGPT account required for alias writes' });
    expect(box.data[key]).toEqual({ ownerId: 'account-A', aliases: { msg: 'Keep' } });
  });

  it('does not silently adopt all unowned legacy labels by editing a different message', async () => {
    const legacy = { ownerId: null, aliases: { 'private-old': 'Previous account title' } };
    const box = backing({ [key]: legacy });
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect(await writer.commit(update('new-message', null, 'new label', 'account-B')))
      .toEqual({ ok: false, error: 'Legacy aliases require explicit owner migration' });
    expect(box.data[key]).toEqual(legacy);
    expect(box.set).not.toHaveBeenCalled();
  });

  it('reports storage errors and keeps the queue usable', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    box.failSet();
    expect(await writer.commit(update('msg', null, 'failed')))
      .toEqual({ ok: false, error: 'set failed' });
    expect((await writer.commit(update('msg', null, 'saved'))).ok).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-1', aliases: { msg: 'saved' } });
  });
});
