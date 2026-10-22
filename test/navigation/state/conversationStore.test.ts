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

    // Stage 1: ChatGPT updates route to temporary local conversation key
    currentKey = 'local-temp-123';
    const transitionLocal = store.syncRouteState('local-temp-123');

    expect(transitionLocal.isTransition).toBe(true);
    expect(transitionLocal.isNewChatRouteTransition).toBe(true);
    expect(transitionLocal.shouldPreserveMessages).toBe(true);
    expect(store.getPendingNewChatRouteKey()).toBe('new-chat:/');

    store.resetForCurrentRoute({
      preserveMessages: transitionLocal.shouldPreserveMessages,
      nextMessages: transitionLocal.cachedMessages,
    });
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-1');

    // Stage 2: ChatGPT updates route to permanent conversation URL
    currentKey = 'c-perm-456';
    const transitionPerm = store.syncRouteState('c-perm-456');

    expect(transitionPerm.isTransition).toBe(true);
    expect(transitionPerm.isNewChatRouteTransition).toBe(true);
    expect(transitionPerm.shouldPreserveMessages).toBe(true);
    expect(store.getPendingNewChatRouteKey()).toBe('local-temp-123');

    // Test 2: Verify temporary local state is cleaned after migration
    expect(store.getCachedConversationMessages('local-temp-123')).toHaveLength(0);

    store.resetForCurrentRoute({
      preserveMessages: transitionPerm.shouldPreserveMessages,
      nextMessages: transitionPerm.cachedMessages,
    });

    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-1');

    // Empty conversation data arrives for permanent route
    store.handleConversationData(
      { messages: [] } as ConversationData,
      'c-perm-456'
    );
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-1');

    // Server later returns prompt-1
    store.handleConversationData(
      {
        messages: [
          {
            id: 'prompt-1',
            author: { role: 'user' },
            content: { parts: ['Initial prompt'] },
            create_time: 100,
          } as ChatMessage,
        ],
      } as ConversationData,
      'c-perm-456'
    );
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-1');

    // Second prompt arrives under permanent route
    store.appendNavigatorMessage(
      {
        id: 'prompt-2',
        author: { role: 'user' },
        content: { parts: ['Second prompt'] },
        create_time: 200,
      } as ChatMessage,
      'c-perm-456'
    );
    expect(store.getMessages()).toHaveLength(2);
    expect(store.getMessages().map((m) => m.id)).toEqual([
      'prompt-1',
      'prompt-2',
    ]);
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

  it('isolates accumulated and snapshot state across consecutive new-chat sessions without cross-contamination', () => {
    let currentKey = 'new-chat:/';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    // --- Session A ---
    store.syncRouteState('new-chat:/');
    store.appendNavigatorMessage({
      id: 'prompt-A1',
      author: { role: 'user' },
      content: { parts: ['Prompt A1 text'] },
      create_time: 100,
    } as ChatMessage);

    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-A1');

    // Migrate to conversation-A
    currentKey = 'c-perm-A';
    const transitionA = store.syncRouteState('c-perm-A');
    store.resetForCurrentRoute({
      preserveMessages: transitionA.shouldPreserveMessages,
      nextMessages: transitionA.cachedMessages,
    });
    expect(store.getMessages().map((m) => m.id)).toEqual(['prompt-A1']);

    // --- Session B ---
    // User starts a second new chat (URL returns to new-chat:/)
    currentKey = 'new-chat:/';
    const transitionB = store.syncRouteState('new-chat:/');
    expect(transitionB.isNewChatRouteTransition).toBe(false);
    expect(transitionB.shouldPreserveMessages).toBe(false);

    // Verify temporary snapshot is empty when Session B begins
    expect(transitionB.cachedMessages).toHaveLength(0);
    expect(store.getCachedConversationMessages('new-chat:/')).toHaveLength(0);

    store.resetForCurrentRoute({
      preserveMessages: transitionB.shouldPreserveMessages,
      nextMessages: transitionB.cachedMessages,
    });
    expect(store.getMessages()).toHaveLength(0);

    // User submits prompt-B1 in Session B
    store.appendNavigatorMessage({
      id: 'prompt-B1',
      author: { role: 'user' },
      content: { parts: ['Prompt B1 text'] },
      create_time: 200,
    } as ChatMessage);

    expect(store.getMessages().map((m) => m.id)).toEqual(['prompt-B1']);

    // Migrate to conversation-B
    currentKey = 'c-perm-B';
    const transitionB2 = store.syncRouteState('c-perm-B');
    store.resetForCurrentRoute({
      preserveMessages: transitionB2.shouldPreserveMessages,
      nextMessages: transitionB2.cachedMessages,
    });

    // Empty or partial conversationData arrives for conversation-B
    store.handleConversationData(
      { messages: [] } as ConversationData,
      'c-perm-B'
    );

    // Final messages in Session B must equal [prompt-B1], with no trace of prompt-A1
    expect(store.getMessages().map((m) => m.id)).toEqual(['prompt-B1']);
    expect(store.getMessages().some((m) => m.id === 'prompt-A1')).toBe(false);
  });

  it('keeps real conversation switching isolated without migrating messages', () => {
    let currentKey = 'c-real-conv-A';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('c-real-conv-A');
    store.appendNavigatorMessage({
      id: 'prompt-A1',
      author: { role: 'user' },
      content: { parts: ['Prompt A1 from real conversation A'] },
      create_time: 100,
    } as ChatMessage);

    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('prompt-A1');

    // User switches from real-A to real-B
    currentKey = 'c-real-conv-B';
    const transition = store.syncRouteState('c-real-conv-B');

    expect(transition.isTransition).toBe(true);
    expect(transition.isNewChatRouteTransition).toBe(false);
    expect(transition.shouldPreserveMessages).toBe(false);
    expect(transition.cachedMessages).toHaveLength(0);

    store.resetForCurrentRoute({
      preserveMessages: transition.shouldPreserveMessages,
      nextMessages: transition.cachedMessages,
    });

    // Conversation B starts empty; prompt-A1 must not migrate
    expect(store.getMessages()).toHaveLength(0);
  });

  it('tracks conversation completeness per route key and reports it via syncRouteState and isConversationComplete', () => {
    let currentKey = 'conv-1';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('conv-1');
    expect(store.isConversationComplete('conv-1')).toBe(false);

    store.markConversationComplete('conv-1');
    expect(store.isConversationComplete('conv-1')).toBe(true);

    // Switch to conv-2 (not complete)
    currentKey = 'conv-2';
    const transition2 = store.syncRouteState('conv-2');
    expect(transition2.isComplete).toBe(false);
    expect(store.isConversationComplete('conv-2')).toBe(false);

    // Switch back to conv-1 (complete)
    currentKey = 'conv-1';
    const transition1 = store.syncRouteState('conv-1');
    expect(transition1.isComplete).toBe(true);
    expect(store.isConversationComplete('conv-1')).toBe(true);
  });

  it('preserves completeness across message appending and conversationData merges', () => {
    let currentKey = 'conv-complete-preserve';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('conv-complete-preserve');
    store.markConversationComplete('conv-complete-preserve');
    expect(store.isConversationComplete('conv-complete-preserve')).toBe(true);

    // Append new prompt
    store.appendNavigatorMessage({
      id: 'prompt-new',
      author: { role: 'user' },
      content: { parts: ['New prompt'] },
    } as ChatMessage);

    expect(store.isConversationComplete('conv-complete-preserve')).toBe(true);

    // Merge background conversationData
    store.handleConversationData({
      messages: [
        {
          id: 'prompt-merged',
          author: { role: 'user' },
          content: { parts: ['Merged prompt'] },
          create_time: 150,
        } as ChatMessage,
      ],
    });

    expect(store.isConversationComplete('conv-complete-preserve')).toBe(true);
  });

  it('propagates completeness across route migration stages', () => {
    let currentKey = 'new-chat:/';
    const store = createConversationStore({
      getCurrentRouteKey: () => currentKey,
    });

    store.syncRouteState('new-chat:/');
    store.appendNavigatorMessage({
      id: 'prompt-initial',
      author: { role: 'user' },
      content: { parts: ['Initial prompt'] },
      create_time: 100,
    } as ChatMessage);

    store.markConversationComplete('new-chat:/');
    expect(store.isConversationComplete('new-chat:/')).toBe(true);

    // Stage 1: migrate to local
    currentKey = 'local-migration-key';
    const transitionLocal = store.syncRouteState('local-migration-key');
    expect(transitionLocal.isComplete).toBe(true);
    expect(store.isConversationComplete('local-migration-key')).toBe(true);

    // Stage 2: migrate to permanent
    currentKey = 'c-perm-migration-key';
    const transitionPerm = store.syncRouteState('c-perm-migration-key');
    expect(transitionPerm.isComplete).toBe(true);
    expect(store.isConversationComplete('c-perm-migration-key')).toBe(true);
  });

  it('preserves optimistic message with real event payload shape (createTime, missing author) across delayed conversationData', () => {
    const store = createConversationStore({
      getCurrentRouteKey: () => 'conv-real-shape',
    });

    // Real event payload shape emitted by pageHook/conversationStream.ts
    const optimisticPayload = {
      id: 'msg-opt-hi8',
      content: { parts: ['hi8 real prompt'] },
      metadata: { attachments: [] },
      createTime: 1712345690,
    } as unknown as ChatMessage;

    store.handleNewUserMessage(optimisticPayload, 'conv-real-shape');
    expect(store.getMessages().map((m) => m.id)).toEqual(['msg-opt-hi8']);

    // Delayed background pagination / backfill arrives with older history
    store.handleConversationData(
      {
        messages: [
          {
            id: 'msg-older-hi7',
            author: { role: 'user' },
            content: { parts: ['hi7 older prompt'] },
            create_time: 1712345600,
          } as ChatMessage,
          {
            id: 'asst-older-hi7',
            author: { role: 'assistant' },
            content: { parts: ['hi7 reply'] },
            create_time: 1712345650,
          } as ChatMessage,
        ],
      },
      'conv-real-shape'
    );

    // Optimistic prompt must NOT be discarded by extractUserMessages
    expect(store.getMessages().map((m) => m.id)).toEqual([
      'msg-older-hi7',
      'msg-opt-hi8',
    ]);
  });

  it('reconciles confirmed server message with optimistic message without creating duplicates', () => {
    const store = createConversationStore({
      getCurrentRouteKey: () => 'conv-reconcile-dup',
    });

    // 1. Optimistic message appended
    store.handleNewUserMessage(
      {
        id: 'msg-opt-hi8',
        content: { parts: ['hi8 pending'] },
        createTime: 1712345690,
      } as ChatMessage,
      'conv-reconcile-dup'
    );

    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('msg-opt-hi8');

    // 2. Server response arrives with confirmed message (same ID, server create_time, metadata) and assistant turn
    store.handleConversationData(
      {
        messages: [
          {
            id: 'msg-opt-hi8',
            author: { role: 'user' },
            content: { parts: ['hi8 confirmed'] },
            metadata: { finish_details: { type: 'stop' } },
            create_time: 1712345690,
          } as ChatMessage,
          {
            id: 'asst-reply-hi8',
            author: { role: 'assistant' },
            content: { parts: ['hi8 answer'] },
            create_time: 1712345700,
          } as ChatMessage,
        ],
      },
      'conv-reconcile-dup'
    );

    // Replaces in-place without producing duplicate TOC entries
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getMessages()[0].id).toBe('msg-opt-hi8');
    expect(store.getMessages()[0].text).toBe('hi8 confirmed');
  });

  describe('collapsedMessageMap lifecycle', () => {
    it('accumulates collapsed message mappings across paginated backfill', () => {
      const store = createConversationStore({
        getCurrentRouteKey: () => 'conv-collapsed-backfill',
      });

      // Page 2 arrives first (newer messages: user-2 interrupted, followed by user-3)
      store.handleConversationData({
        messages: [
          {
            id: 'user-2',
            author: { role: 'user' },
            content: { parts: ['Interrupted 2'] },
            create_time: 200,
          } as ChatMessage,
          {
            id: 'user-3',
            author: { role: 'user' },
            content: { parts: ['Prompt 3'] },
            create_time: 210,
          } as ChatMessage,
          {
            id: 'asst-3',
            author: { role: 'assistant' },
            content: { parts: ['Reply 3'] },
            create_time: 220,
          } as ChatMessage,
        ],
      });

      let map = store.getCollapsedMessageMap();
      expect(map.size).toBe(1);
      expect(map.get('user-2')).toBe('user-3');

      // Page 1 arrives later (older messages: user-1a interrupted, followed by user-1b)
      store.handleConversationData({
        messages: [
          {
            id: 'user-1a',
            author: { role: 'user' },
            content: { parts: ['Interrupted 1'] },
            create_time: 100,
          } as ChatMessage,
          {
            id: 'user-1b',
            author: { role: 'user' },
            content: { parts: ['Prompt 1b'] },
            create_time: 110,
          } as ChatMessage,
          {
            id: 'asst-1',
            author: { role: 'assistant' },
            content: { parts: ['Reply 1'] },
            create_time: 120,
          } as ChatMessage,
        ],
      });

      map = store.getCollapsedMessageMap();
      expect(map.size).toBe(2);
      expect(map.get('user-1a')).toBe('user-1b');
      expect(map.get('user-2')).toBe('user-3');
    });

    it('migrates collapsed message mapping on new-chat route promotion', () => {
      let currentKey = 'new-chat:/';
      const store = createConversationStore({
        getCurrentRouteKey: () => currentKey,
      });

      store.syncRouteState();

      // Data arrives on new-chat route
      store.handleConversationData({
        messages: [
          {
            id: 'user-stop',
            author: { role: 'user' },
            content: { parts: ['Stopped'] },
            create_time: 100,
          } as ChatMessage,
          {
            id: 'user-final',
            author: { role: 'user' },
            content: { parts: ['Final'] },
            create_time: 110,
          } as ChatMessage,
          {
            id: 'asst-final',
            author: { role: 'assistant' },
            content: { parts: ['Reply'] },
            create_time: 120,
          } as ChatMessage,
        ],
      });

      expect(store.getCollapsedMessageMap().get('user-stop')).toBe('user-final');

      // Route transition from new-chat to permanent ID
      currentKey = 'c/perm-123';
      const transition = store.syncRouteState();
      expect(transition.shouldPreserveMessages).toBe(true);

      // Collapsed map should now be accessible under the permanent route key
      expect(store.getCollapsedMessageMap('c/perm-123').get('user-stop')).toBe(
        'user-final'
      );
      // And the old new-chat key mapping was cleaned up
      expect(store.getCollapsedMessageMap('new-chat:/').size).toBe(0);
    });

    it('clears collapsed mapping when resetting route without preserving messages', () => {
      const store = createConversationStore({
        getCurrentRouteKey: () => 'conv-reset',
      });

      store.handleConversationData({
        messages: [
          {
            id: 'u1',
            author: { role: 'user' },
            content: { parts: ['Prompt 1'] },
            create_time: 100,
          } as ChatMessage,
          {
            id: 'u2',
            author: { role: 'user' },
            content: { parts: ['Prompt 2'] },
            create_time: 110,
          } as ChatMessage,
          {
            id: 'a2',
            author: { role: 'assistant' },
            content: { parts: ['Reply'] },
            create_time: 120,
          } as ChatMessage,
        ],
      });

      expect(store.getCollapsedMessageMap().size).toBe(1);

      store.resetForCurrentRoute({ preserveMessages: false });
      expect(store.getCollapsedMessageMap().size).toBe(0);
    });

    it('clears collapsed mapping on setMessages and full reset', () => {
      const store = createConversationStore({
        getCurrentRouteKey: () => 'conv-reset-all',
      });

      store.handleConversationData({
        messages: [
          {
            id: 'u1',
            author: { role: 'user' },
            content: { parts: ['Prompt 1'] },
            create_time: 100,
          } as ChatMessage,
          {
            id: 'u2',
            author: { role: 'user' },
            content: { parts: ['Prompt 2'] },
            create_time: 110,
          } as ChatMessage,
          {
            id: 'a2',
            author: { role: 'assistant' },
            content: { parts: ['Reply'] },
            create_time: 120,
          } as ChatMessage,
        ],
      });

      expect(store.getCollapsedMessageMap().size).toBe(1);

      store.setMessages([]);
      expect(store.getCollapsedMessageMap().size).toBe(0);
    });
  });
});
