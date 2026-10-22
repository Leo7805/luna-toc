/** Tests persistence and account ownership for custom TOC labels. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTocAliasStore } from '@/features/conversationPrompts/tocAliasStore';

const saved: Record<string, unknown> = {};
const onChanged: Array<(changes: Record<string, { newValue: unknown }>, area: string) => void> = [];
beforeEach(() => {
  for (const key of Object.keys(saved)) delete saved[key];
  onChanged.length = 0;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | null) => keys === null
          ? { ...saved }
          : { [keys]: saved[keys] }),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(saved, values); }),
        remove: vi.fn(async (key: string) => { delete saved[key]; }),
      },
      onChanged: { addListener: (fn: typeof onChanged[number]) => { onChanged.push(fn); } },
    },
  });
});

describe('TOC alias storage', () => {
  it('saves and restores labels scoped by conversation and message IDs', async () => {
    const store = createTocAliasStore();
    await store.update('conversation-123', 'message-1', '重命名标题', 'account-1');
    expect(store.get('conversation-123', 'message-1')).toBe('重命名标题');
    const reload = createTocAliasStore();
    await reload.load('conversation-123');
    expect(reload.get('conversation-123', 'message-1')).toBe('重命名标题');
    expect(await reload.owner('conversation-123')).toBe('account-1');
    await store.update('conversation-123', 'message-1', null, 'account-1');
    expect(store.get('conversation-123', 'message-1')).toBeNull();
    expect(saved['chatToc:aliases:v1:conversation-123']).toBeUndefined();
  });
  it('rejects temporary conversations and keeps storage independent', async () => {
    const store = createTocAliasStore();
    await expect(store.update('local-123456', 'msg-1', 'ignored', null)).rejects.toThrow();
    await store.update('conversation-123', 'msg-1', 'one', null);
    await store.update('conversation-456', 'msg-1', 'two', null);
    expect(await store.references()).toEqual(['conversation-123', 'conversation-456']);
    await store.removeConversation('conversation-123');
    expect(store.get('conversation-456', 'msg-1')).toBe('two');
  });
});
