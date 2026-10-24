/** Manual cleanup inventories only local aliases and requires worker confirmation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listLocalTocAliases, requestManualTocAliasCleanup } from '@/features/conversationPrompts/aliasCleanup';
import {
  TOC_ALIAS_PREFIX, TOC_ALIAS_DELETED_PREFIX, TOC_ALIAS_COMMIT_TYPE,
} from '@/features/conversationPrompts/tocAliasWriteCoordinator';

const route = 'conversation-123';
const record = { ownerId: 'account-1', aliases: { msg: 'Title' } };
afterEach(() => vi.unstubAllGlobals());

describe('manual local alias cleanup', () => {
  it('lists only valid unfenced records without changing local storage', async () => {
    const storage = {
      get: vi.fn(async () => ({
        [TOC_ALIAS_PREFIX + route]: record,
        [TOC_ALIAS_PREFIX + 'conversation-456']: { ownerId: 'account-2', aliases: { msg: 'Other' } },
        [TOC_ALIAS_DELETED_PREFIX + 'conversation-456']: true,
        [TOC_ALIAS_PREFIX + 'conversation-789']: 'corrupt',
        [TOC_ALIAS_PREFIX + 'local-test']: { ownerId: null, aliases: { msg: 'Ignored' } },
      })),
    } as unknown as chrome.storage.StorageArea;
    const result = await listLocalTocAliases(storage);
    expect(result).toEqual({
      candidates: [{ routeKey: route, record, aliasCount: 1 }],
      unreadable: 2,
    });
    expect(storage.get).toHaveBeenCalledWith(null);
  });

  it('sends an unchanged record snapshot and requires explicit delete acknowledgment', async () => {
    const sendMessage = vi.fn((request: unknown, cb: (r: unknown) => void) =>
      cb({ ok: true, deleted: true }));
    vi.stubGlobal('chrome', { runtime: { id: 'extension', lastError: null, sendMessage } });
    await requestManualTocAliasCleanup({ routeKey: route, record, aliasCount: 1 });
    expect(sendMessage).toHaveBeenCalledWith({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation', routeKey: route, expected: record,
    }, expect.any(Function));
  });

  it('surfaces preview conflicts and unknown worker responses', async () => {
    const sendMessage = vi.fn((_request: unknown, cb: (r: unknown) => void) =>
      cb({ ok: false, conflict: true }));
    vi.stubGlobal('chrome', { runtime: { id: 'extension', lastError: null, sendMessage } });
    const selection = { routeKey: route, record, aliasCount: 1 };
    await expect(requestManualTocAliasCleanup(selection)).rejects.toThrow('目录记录已变化');
    sendMessage.mockImplementationOnce((_request: unknown, cb: (r: unknown) => void) =>
      cb({ ok: true, record }));
    await expect(requestManualTocAliasCleanup(selection)).rejects.toThrow('未确认删除');
  });
});
