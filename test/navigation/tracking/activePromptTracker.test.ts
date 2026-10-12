/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivePromptTracker } from '@/navigation/tracking/activePromptTracker';
import { getActivePlatform } from '@/platforms';
import type { Platform } from '@/platforms/platformInterface';

describe('activePromptTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const basePlatform = getActivePlatform('chatgpt.com');
  const mockPlatform: Platform = {
    ...basePlatform,
    config: {
      ...basePlatform.config,
      selectors: {
        ...basePlatform.config.selectors,
        userMessage: '[data-message-author-role="user"]',
        messageId: 'data-message-id',
      },
    },
    navigation: {
      ...basePlatform.navigation,
      getMessageIdFromElement: (element: HTMLElement) =>
        element.getAttribute('data-message-id') || null,
    },
  };

  const sampleMessages = [
    { id: 'msg-0' },
    { id: 'msg-1' },
    { id: 'msg-2' },
  ];

  it('finds conversation index from direct and ancestor elements', () => {
    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    const directElement = document.createElement('div');
    directElement.setAttribute('data-message-id', 'msg-1');
    expect(tracker.findConversationIndexByElement(directElement)).toBe(1);

    const parentElement = document.createElement('div');
    parentElement.setAttribute('data-message-id', 'msg-2');
    const childElement = document.createElement('span');
    parentElement.appendChild(childElement);
    document.body.appendChild(parentElement);

    // Platform getMessageIdFromElement might only check target, but ancestor fallback works
    const platformWithoutGetter: Platform = {
      ...mockPlatform,
      navigation: {
        ...mockPlatform.navigation,
        getMessageIdFromElement: undefined,
      },
    };
    const trackerWithoutGetter = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => platformWithoutGetter,
    });
    expect(trackerWithoutGetter.findConversationIndexByElement(childElement)).toBe(2);

    // Non-existent message
    const unknownElement = document.createElement('div');
    unknownElement.setAttribute('data-message-id', 'msg-999');
    expect(tracker.findConversationIndexByElement(unknownElement)).toBe(-1);
  });

  it('computes mounted prompt signatures using unit key adapter with fallback to message IDs', () => {
    const platformWithUnitKey: Platform = {
      ...mockPlatform,
      navigation: {
        ...mockPlatform.navigation,
        getPromptUnitKeyFromElement: (el) =>
          el.getAttribute('data-test-unit-key') || null,
      },
    };

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => platformWithUnitKey,
    });

    expect(tracker.getMountedPromptSignature()).toBe('');

    const el1 = document.createElement('div');
    el1.setAttribute('data-message-author-role', 'user');
    el1.setAttribute('data-test-unit-key', 'unit-0');
    el1.setAttribute('data-message-id', 'msg-0');

    const el2 = document.createElement('div');
    el2.setAttribute('data-message-author-role', 'user');
    el2.setAttribute('data-message-id', 'msg-1');

    document.body.append(el1, el2);
    expect(tracker.getMountedPromptSignature()).toBe('unit-0|msg-1');
  });

  it('computes mounted prompt signatures with real ChatGPT platform adapter', () => {
    const chatgptPlatform = getActivePlatform('chatgpt.com');
    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => chatgptPlatform,
    });

    const el1 = document.createElement('div');
    el1.setAttribute('data-chatgpt-search-unit-key', 'chatgpt-unit-0:user');
    el1.setAttribute('data-chatgpt-search-message-ids', 'msg-0');

    const el2 = document.createElement('div');
    el2.setAttribute('data-chatgpt-search-unit-key', 'chatgpt-unit-1:user');
    el2.setAttribute('data-chatgpt-search-message-ids', 'msg-1');

    document.body.append(el1, el2);
    expect(tracker.getMountedPromptSignature()).toBe(
      'chatgpt-unit-0:user|chatgpt-unit-1:user'
    );
  });

  it('locks cursor and rejects conflicting active updates during lock period', () => {
    let notifiedIndex: number | null = null;
    let notifiedChanged: boolean | null = null;

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
      onActiveIndexChange: (index, changed) => {
        notifiedIndex = index;
        notifiedChanged = changed;
      },
    });

    expect(tracker.getActiveIndex()).toBeNull();
    tracker.setActiveIndex(0);
    expect(tracker.getActiveIndex()).toBe(0);
    expect(notifiedIndex).toBe(0);
    expect(notifiedChanged).toBe(true);

    // Lock to index 1 for 1000ms
    tracker.lockActiveIndex(1, 1000);
    expect(tracker.getActiveIndex()).toBe(1);
    expect(tracker.isLocked()).toBe(true);
    expect(tracker.getLockedIndex()).toBe(1);

    // Conflicting setActiveIndex is blocked
    const updated = tracker.setActiveIndex(2);
    expect(updated).toBe(false);
    expect(tracker.getActiveIndex()).toBe(1);

    // After timer expires, new index can be set
    vi.advanceTimersByTime(1001);
    expect(tracker.isLocked()).toBe(false);
    expect(tracker.setActiveIndex(2)).toBe(true);
    expect(tracker.getActiveIndex()).toBe(2);
  });

  it('releases lock immediately via unlockActiveIndex', () => {
    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.lockActiveIndex(0, 5000);
    expect(tracker.isLocked()).toBe(true);
    tracker.unlockActiveIndex();
    expect(tracker.isLocked()).toBe(false);
    expect(tracker.setActiveIndex(2)).toBe(true);
    expect(tracker.getActiveIndex()).toBe(2);
  });

  it('cleans up and resets all observers, timers, and active state', () => {
    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.lockActiveIndex(1, 2000);
    tracker.reset();

    expect(tracker.getActiveIndex()).toBeNull();
    expect(tracker.isLocked()).toBe(false);
    expect(tracker.getLockedIndex()).toBeNull();
  });

  it('isolates state across independent instances', () => {
    const trackerA = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });
    const trackerB = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    trackerA.setActiveIndex(0);
    expect(trackerA.getActiveIndex()).toBe(0);
    expect(trackerB.getActiveIndex()).toBeNull();
  });
});
