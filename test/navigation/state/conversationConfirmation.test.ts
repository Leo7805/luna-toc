/** Verifies GET authority over late live duplicates using the actual store. */
import { describe, expect, it } from 'vitest';
import { createConversationStore } from '@/navigation/state/conversationStore';
import { createNavigatorMessage, type ChatMessage } from '@/features/conversationPrompts/message';

/** Creates deterministic messages without fabricating absent reply boundaries. */
function message(id: string, time: number, role = 'user'): ChatMessage {
  return { id, author: { role }, content: { parts: [id] }, create_time: time };
}

/** Restores routes exactly as the controller does, including snapshot restoration. */
function fixture(initial = 'A') {
  let route = initial;
  const store = createConversationStore({ getCurrentRouteKey: () => route });
  store.syncRouteState();
  return {
    store,
    switchTo(next: string) {
      route = next;
      const transition = store.syncRouteState();
      store.resetForCurrentRoute({
        preserveMessages: transition.shouldPreserveMessages,
        nextMessages: transition.cachedMessages,
      });
    },
    ids: () => store.getMessages().map((prompt) => prompt.id),
  };
}

const confirmedHistory = [message('1', 100), message('reply1', 150, 'assistant'), message('2', 200), message('3', 300)];

describe('GET confirmation precedence', () => {
  it.each(['foreground', 'background'])('does not revive confirmed collapsed prompts in %s', (mode) => {
    const f = fixture();
    f.store.handleConversationData({ messages: confirmedHistory });
    expect(f.ids()).toEqual(['1', '3']);
    expect([...f.store.getCollapsedMessageMap()]).toEqual([['2', '3']]);
    if (mode === 'background') {
      f.switchTo('B');
      f.store.handleConversationData({ messages: [message('B1', 100)] });
    }
    const before = structuredClone(f.store.getMessages());
    const result = f.store.handleNewUserMessage({ id: '2', content: { parts: ['stale'] }, createTime: 9999999990000 }, 'A');
    expect(result.didAppend).toBe(false);
    expect(f.store.getMessages()).toEqual(before);
    expect(f.store.getCachedConversationMessages('A').map((prompt) => prompt.id)).toEqual(['1', '3']);
    expect([...f.store.getCollapsedMessageMap('A')]).toEqual([['2', '3']]);
    if (mode === 'background') f.switchTo('A');
    expect([...f.store.getCollapsedMessageMap()]).toEqual([['2', '3']]);
    expect(f.ids()).toEqual(['1', '3']);
    // Omitting 2 cannot hide a raw overwrite or a wrongly re-created pending ID.
    f.store.handleConversationData({ messages: [confirmedHistory[0], confirmedHistory[1], confirmedHistory[3]] });
    expect(f.ids()).toEqual(['1', '3']);
    expect([...f.store.getCollapsedMessageMap()]).toEqual([['2', '3']]);
    expect(f.store.appendNavigatorMessage(message('2', 200))).toBe(false);
    expect(f.ids()).toEqual(['1', '3']);
  });

  it.each([
    ['foreground', 'create_time'], ['background', 'create_time'],
    ['foreground', 'createTime'], ['background', 'createTime'],
  ])('preserves confirmed fields and accepts later GET updates in %s with %s', (mode, timeField) => {
    const f = fixture();
    const server: ChatMessage = {
      ...message('3', 300), content: { parts: ['Server text'] },
      metadata: { attachments: [{ name: 'server.pdf', mime_type: 'application/pdf' }] },
    };
    f.store.handleConversationData({ messages: [...confirmedHistory.slice(0, 3), server, message('reply3', 350, 'assistant'), message('5', 500)] });
    const expected = structuredClone(f.store.getMessages());
    expect(expected.map((prompt) => prompt.id)).toEqual(['1', '3', '5']);
    expect(expected[1]).toEqual(createNavigatorMessage(server));
    if (mode === 'background') f.switchTo('B');
    const stale: ChatMessage = { id: '3', content: { parts: ['Old client text'] }, [timeField]: 9999999990000 };
    expect(f.store.handleNewUserMessage(stale, 'A').didAppend).toBe(false);
    expect(f.store.getCachedConversationMessages('A')).toEqual(expected);
    if (mode === 'background') f.switchTo('A');
    expect(f.store.getMessages()).toEqual(expected);
    // This GET does not repair 3; its data must still come from the confirmed raw map.
    f.store.handleConversationData({ messages: [message('1', 100)] });
    expect(f.store.getMessages()).toEqual(expected);
    const updated = { ...server, content: { parts: ['Updated server text'] }, create_time: 325, metadata: { attachments: [{ name: 'updated.png', mime_type: 'image/png' }] } };
    f.store.handleConversationData({ messages: [updated] });
    expect(f.ids()).toEqual(['1', '3', '5']);
    expect(f.store.getMessages()[1]).toEqual(createNavigatorMessage(updated));
    f.store.handleNewUserMessage(stale, 'A');
    f.store.handleConversationData({ messages: [] });
    expect(f.store.getMessages()[1]).toEqual(createNavigatorMessage(updated));
  });

  it('keeps live-only IDs pending across old GET and confirms only IDs actually received', () => {
    const f = fixture();
    f.store.handleConversationData({ messages: confirmedHistory.slice(0, 2) });
    expect(f.store.handleNewUserMessage(message('2', 200), 'A').didAppend).toBe(true);
    expect(f.store.handleNewUserMessage({ id: '3', content: { parts: ['3'] }, createTime: 300 }, 'A').didAppend).toBe(true);
    f.store.handleConversationData({ messages: confirmedHistory.slice(0, 2) });
    expect(f.ids()).toEqual(['1', '2', '3']);
    f.store.handleConversationData({ messages: [message('2', 200)] });
    expect(f.store.handleNewUserMessage(message('2', 9999), 'A').didAppend).toBe(false);
    f.store.handleConversationData({ messages: [] });
    expect(f.ids()).toEqual(['1', '2', '3']);
    expect(f.store.getMessages()[1].createTime).toBe(200);
  });

  it('moves confirmed and pending states through both temporary identities and cleans sources', () => {
    const f = fixture('new-chat:/');
    f.store.handleConversationData({ messages: [...confirmedHistory, message('reply3', 350, 'assistant')] });
    f.store.handleNewUserMessage(message('4', 400), 'new-chat:/');
    for (const key of ['local-new', 'permanent']) {
      const source = f.store.getCurrentConversationKey();
      f.switchTo(key);
      expect(f.store.getCachedConversationMessages(source)).toEqual([]);
      expect([...f.store.getCollapsedMessageMap(source)]).toEqual([]);
      expect([...f.store.getCollapsedMessageMap()]).toEqual([['2', '3']]);
      expect(f.store.appendNavigatorMessage(message('2', 9999))).toBe(false);
      f.store.handleConversationData({ messages: [] });
      expect(f.ids()).toEqual(['1', '3', '4']);
    }
    // A late event from the pending temporary identity uses the destination authority.
    expect(f.store.handleNewUserMessage(message('2', 9999), 'local-new').didAppend).toBe(false);
    f.store.handleConversationData({ messages: [] });
    expect(f.ids()).toEqual(['1', '3', '4']);
    f.switchTo('unrelated');
    expect(f.store.handleNewUserMessage(message('2', 200), 'unrelated').didAppend).toBe(true);
    expect(f.ids()).toEqual(['2']);
    // Reusing either old temporary namespace proves confirmation/pending/raw state moved away.
    for (const key of ['new-chat:/', 'local-new']) {
      f.switchTo(key);
      f.store.resetForCurrentRoute();
      f.store.handleConversationData({ messages: [] });
      expect(f.ids()).toEqual([]);
      expect(f.store.appendNavigatorMessage(message('2', 200))).toBe(true);
      f.store.handleConversationData({ messages: [] });
      expect(f.ids()).toEqual(['2']);
      f.store.resetForCurrentRoute();
    }
  });

  it('clears confirmation on reset and isolates independent stores', () => {
    const f = fixture();
    f.store.handleConversationData({ messages: confirmedHistory });
    expect(f.store.appendNavigatorMessage(message('2', 200))).toBe(false);
    const other = fixture();
    expect(other.store.appendNavigatorMessage(message('2', 200))).toBe(true);
    f.store.reset();
    expect(f.store.appendNavigatorMessage(message('2', 200))).toBe(true);
    f.store.handleConversationData({ messages: [] });
    expect(f.ids()).toEqual(['2']);
  });
});
