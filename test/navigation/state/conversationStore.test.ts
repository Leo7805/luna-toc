/**
 * Tests isolated conversationStore state, pagination accumulation,
 * chronological sorting, snapshot caching, and route transition migrations.
 */
import { describe, expect, it } from 'vitest';
import { createConversationStore } from '@/navigation/state/conversationStore';
import type { ChatMessage, ConversationData } from '@/features/conversationPrompts/message';

describe('conversationStore', () => {
  it('uses injected route resolver when provided', () => {
    let activeRoute = 'custom-route-1';
    const store = createConversationStore({
      getCurrentRouteKey: () => activeRoute,
    });

    expect(store.getCurrentConversationKey()).toBe('custom-route-1');
    activeRoute = 'custom-route-2';
    expect(store.getCurrentConversationKey()).toBe('custom-route-2');
  });

  it('accumulates paginated conversation data and sorts chronologically', () => {
    const store = createConversationStore({
      getCurrentRouteKey: () => 'conv-123',
    });

    // Page 2 arrives first (newer messages)
    const page2: ConversationData = {
      messages: [
        {
          id: 'msg-3',
          author: { role: 'user' },
          content: { parts: ['Third message'] },
          create_time: 300,
        } as ChatMessage,
        {
          id: 'asst-2',
          author: { role: 'assistant' },
          content: { parts: ['Second reply'] },
          create_time: 250,
        } as ChatMessage,
        {
          id: 'msg-2',
          author: { role: 'user' },
          content: { parts: ['Second message'] },
          create_time: 200,
        } as ChatMessage,
      ],
    };

    store.handleConversationData(page2);
    expect(store.getMessages().map((m) => m.id)).toEqual(['msg-2', 'msg-3']);

    // Page 1 arrives later (older message)
    const page1: ConversationData = {
      messages: [
        {
          id: 'asst-1',
          author: { role: 'assistant' },
          content: { parts: ['First reply'] },
          create_time: 150,
        } as ChatMessage,
        {
          id: 'msg-1',
          author: { role: 'user' },
          content: { parts: ['First message'] },
          create_time: 100,
        } as ChatMessage,
      ],
    };

    store.handleConversationData(page1);
    expect(store.getMessages().map((m) => m.id)).toEqual([
      'msg-1',
      'msg-2',
      'msg-3',
    ]);
  });

  it('deduplicates incoming user messages by message ID', () => {
    const store = createConversationStore({
      getCurrentRouteKey: () => 'conv-123',
    });

    const msg: ChatMessage = {
      id: 'msg-dup',
      author: { role: 'user' },
      content: { parts: ['Hello'] },
      create_time: 100,
    } as ChatMessage;

    expect(store.appendNavigatorMessage(msg)).toBe(true);
    expect(store.getMessages()).toHaveLength(1);

    // Duplicate append
    expect(store.appendNavigatorMessage(msg)).toBe(false);
    expect(store.getMessages()).toHaveLength(1);
  });

  it('preserves messages and copies snapshots when migrating from new-chat to permanent route', () => {
    let currentKey = 'new-chat:/';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    // Initialize first route
    store.syncRouteState('new-chat:/');

    // User sends prompt in empty new chat
    store.appendNavigatorMessage({
      id: 'prompt-1',
      author: { role: 'user' },
      content: { parts: ['Initial prompt'] },
      create_time: 100,
    } as ChatMessage);

    expect(store.getMessages()).toHaveLength(1);

    // ChatGPT updates route to permanent conversation URL
    currentKey = 'c-perm-456';
    const transition = store.syncRouteState('c-perm-456');

    expect(transition.isTransition).toBe(true);
    expect(transition.isNewChatRouteTransition).toBe(true);
    expect(transition.shouldPreserveMessages).toBe(true);
    expect(store.getPendingNewChatRouteKey()).toBe('new-chat:/');

    // Route reset with preserveMessages=true
    store.resetForCurrentRoute({
      preserveMessages: transition.shouldPreserveMessages,
      nextMessages: transition.cachedMessages,
    });

    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-1');
  });

  it('handles late arriving newUserMessage destined for pending new chat key', () => {
    let currentKey = 'new-chat:/';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('new-chat:/');

    // Switch route before message event fires
    currentKey = 'c-perm-789';
    store.syncRouteState('c-perm-789');

    // Late message arrives with the old new-chat routeKey
    const lateMessage: ChatMessage = {
      id: 'late-msg',
      author: { role: 'user' },
      content: { parts: ['Late incoming prompt'] },
      create_time: 200,
    } as ChatMessage;

    const result = store.handleNewUserMessage(lateMessage, 'new-chat:/');
    expect(result.accepted).toBe(true);
    expect(result.didAppend).toBe(true);
    expect(result.isMigrating).toBe(true);
    expect(store.getPendingNewChatRouteKey()).toBeNull();
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('late-msg');
  });

  it('queues and flushes pending new chat message', () => {
    let currentKey = 'new-chat:/';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('new-chat:/');

    // Message arrives for new-chat route key
    const msg: ChatMessage = {
      id: 'pending-1',
      author: { role: 'user' },
      content: { parts: ['Pending prompt'] },
      create_time: 150,
    } as ChatMessage;

    const result = store.handleNewUserMessage(msg, 'new-chat:/');
    expect(result.accepted).toBe(true);
    expect(store.getPendingNewChatMessage()).toBe(msg);

    // Flush pending message
    const flushed = store.flushPendingNewChatMessage();
    expect(flushed.didAppend).toBe(false); // already appended by handleNewUserMessage
    expect(store.getPendingNewChatMessage()).toBeNull();
  });

  it('isolates state across different store instances', () => {
    const storeA = createConversationStore({ getCurrentRouteKey: () => 'chat-A' });
    const storeB = createConversationStore({ getCurrentRouteKey: () => 'chat-B' });

    storeA.appendNavigatorMessage({
      id: 'msg-A',
      author: { role: 'user' },
      content: { parts: ['A'] },
    } as ChatMessage);

    expect(storeA.getMessages()).toHaveLength(1);
    expect(storeB.getMessages()).toHaveLength(0);
  });
});
