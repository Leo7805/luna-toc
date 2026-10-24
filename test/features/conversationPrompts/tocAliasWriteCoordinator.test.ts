/** Tests serial background TOC alias commits and persistent deletion fences. */
import { describe, expect, it, vi } from 'vitest';
import {
  createTocAliasWriteCoordinator, TOC_ALIAS_COMMIT_TYPE,
  TOC_ALIAS_PREFIX, TOC_ALIAS_DELETED_PREFIX,
} from '@/features/conversationPrompts/tocAliasWriteCoordinator';

const route = 'conversation-123';
const key = TOC_ALIAS_PREFIX + route;
const deletedKey = TOC_ALIAS_DELETED_PREFIX + route;
const update = (messageId: string, _expected: string | null, label: string | null,
  ownerId: string | null = 'account-1') =>
  ({ type: TOC_ALIAS_COMMIT_TYPE, action: 'update', routeKey: route,
    messageId, label, ownerId });
const remove = () =>
  ({ type: TOC_ALIAS_COMMIT_TYPE, action: 'delete-conversation', routeKey: route, ownerId: 'account-1' });

function backing(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  let rejectSet = false;
  let rejectRemove = false;
  const get = vi.fn(async (keys: string | string[] | null) => {
    const requested = keys === null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
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
  it('preserves distinct message edits within the ordered writer', async () => {
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

  it('supports sequential renames and restores without stale-value conditions', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect((await writer.commit(update('msg', null, 'first'))).ok).toBe(true);
    expect((await writer.commit(update('msg', null, 'second'))).ok).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-1', aliases: { msg: 'second' } });
    expect((await writer.commit(update('msg', null, null))).ok).toBe(true);
    expect(box.data[key]).toBeUndefined();
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
    const box = backing({ [key]: { ownerId: 'account-1', aliases: { msg: 'old' } } });
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
      .toEqual({ ok: false, error: 'Invalid TOC alias request' });
    expect(box.data[key]).toEqual({ ownerId: 'account-A', aliases: { msg: 'Keep' } });
  });

  it('deletes unowned legacy aliases and never attributes them to the active account', async () => {
    const legacy = { ownerId: null, aliases: { 'private-old': 'Previous account title' } };
    const invalidOwnerKey = TOC_ALIAS_PREFIX + 'conversation-456';
    const invalidOwner = { ownerId: 123, aliases: { message: 'Unbound too' } };
    const box = backing({ [key]: legacy, [invalidOwnerKey]: invalidOwner });
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect(await writer.commit({ type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-unowned' }))
      .toEqual({ ok: true, cleaned: 2 });
    expect(box.data[key]).toBeUndefined();
    expect(box.data[invalidOwnerKey]).toBeUndefined();
    expect((await writer.commit(update('new-message', null, 'new label', 'account-B'))).ok).toBe(true);
    expect(box.data[key]).toEqual({ ownerId: 'account-B', aliases: { 'new-message': 'new label' } });
  });

  it('does not delete aliases that already have a verified owner', async () => {
    const box = backing({ [key]: { ownerId: 'account-1', aliases: { msg: 'Keep' } } });
    expect(await createTocAliasWriteCoordinator(box.storage).commit({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-unowned',
    })).toEqual({ ok: true, cleaned: 0 });
    expect(box.data[key]).toEqual({ ownerId: 'account-1', aliases: { msg: 'Keep' } });
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
  it('requires an unchanged explicit preview before cleaning a local alias record', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect((await writer.commit(update('msg-a', null, 'Before'))).ok).toBe(true);
    const preview = structuredClone(box.data[key]);

    // Data changes after the user opened the cleanup preview.
    expect((await writer.commit(update('msg-b', null, 'New'))).ok).toBe(true);
    expect(await writer.commit({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation', routeKey: route,
      expected: preview,
    })).toEqual({ ok: false, conflict: true });
    expect(box.data[deletedKey]).toBeUndefined();
    expect(box.data[key]).toEqual({
      ownerId: 'account-1', aliases: { 'msg-a': 'Before', 'msg-b': 'New' },
    });

    const current = structuredClone(box.data[key]);
    expect(await writer.commit({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation', routeKey: route,
      expected: current,
    })).toEqual({ ok: true, deleted: true });
    expect(box.data[key]).toBeUndefined();
    expect(box.data[deletedKey]).toBe(true);
    expect(await writer.commit(update('msg-a', null, 'Stale')))
      .toEqual({ ok: false, error: 'Conversation has been deleted' });
  });

  it('does not clean missing records, malformed previews or an already fenced route', async () => {
    const box = backing();
    const writer = createTocAliasWriteCoordinator(box.storage);
    const request = {
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation' as const,
      routeKey: route, expected: { ownerId: 'account-1', aliases: { msg: 'Old' } },
    };
    expect(await writer.commit(request)).toEqual({ ok: false, conflict: true });
    expect(await writer.commit({ ...request, expected: { ownerId: 'account-1', aliases: Object.fromEntries([['__proto__', 'x']]) } }))
      .toEqual({ ok: false, error: 'Invalid TOC alias request' });
    expect((await writer.commit(update('msg', null, 'Old'))).ok).toBe(true);
    expect(await writer.commit(remove())).toEqual({ ok: true, deleted: true });
    expect(await writer.commit(request)).toEqual({ ok: false, conflict: true });
    expect(box.data[key]).toBeUndefined();
  });

  it('retains the deletion fence when a confirmed manual cleanup cannot remove data', async () => {
    const original = { ownerId: 'account-1', aliases: { msg: 'Important' } };
    const box = backing({ [key]: original });
    box.failRemove();
    const writer = createTocAliasWriteCoordinator(box.storage);
    expect(await writer.commit({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation',
      routeKey: route, expected: structuredClone(original),
    })).toEqual({ ok: false, error: 'remove failed' });
    expect(box.data[deletedKey]).toBe(true);
    expect(box.data[key]).toEqual(original);
  });

});
