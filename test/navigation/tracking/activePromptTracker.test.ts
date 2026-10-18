/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivePromptTracker } from '@/navigation/tracking/activePromptTracker';
import { getActivePlatform } from '@/platforms';
import type { Platform } from '@/platforms/platformInterface';

describe('activePromptTracker', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.className = 'thread-scroll-container';
    mockRect(container, { top: 0, bottom: 800, height: 800 });
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function mockRect(
    element: HTMLElement,
    rect: { top: number; bottom: number; height?: number }
  ): void {
    element.getBoundingClientRect = () => ({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 100,
      width: 100,
      height: rect.height ?? rect.bottom - rect.top,
      x: 0,
      y: rect.top,
      toJSON: () => {},
    });
  }

  function createPromptElement(
    id: string,
    top: number,
    bottom: number
  ): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-message-author-role', 'user');
    el.setAttribute('data-message-id', id);
    mockRect(el, { top, bottom });
    document.body.appendChild(el);
    return el;
  }

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
      getThreadScrollContainer: () => container,
      getScrollContainer: () => container,
      getMessageIdFromElement: (element: HTMLElement) =>
        element.getAttribute('data-message-id') || null,
      promptTopOffsetPx: 16,
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

    expect(tracker.findConversationIndexByElement(childElement)).toBe(2);

    const unknownElement = document.createElement('div');
    unknownElement.setAttribute('data-message-id', 'msg-999');
    expect(tracker.findConversationIndexByElement(unknownElement)).toBe(-1);
  });

  it('activates Prompt N when navigation lands it at the intended top position', () => {
    // Navigation lands Prompt 1 at containerTop + promptTopOffsetPx (0 + 16 = 16px)
    createPromptElement('msg-0', -300, -200);
    createPromptElement('msg-1', 16, 96);
    createPromptElement('msg-2', 500, 580);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('does NOT activate Prompt N+1 while it is still below the effective navigation boundary', () => {
    createPromptElement('msg-0', -400, -320);
    // Boundary is containerTop (0) + 16 + 2 = 18px. Prompt 1 is at 25px (below boundary)
    createPromptElement('msg-1', 25, 105);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('tolerates a tiny 1-2px subpixel difference without leaving the previous prompt Active', () => {
    createPromptElement('msg-0', -400, -320);
    // Target landed at 17.5px (1.5px below intended 16px due to subpixel layout)
    createPromptElement('msg-1', 17.5, 97.5);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('keeps Prompt N Active throughout Assistant Response N even when Prompt N+1 is visible at bottom', () => {
    // Prompt 0 is above viewport top (user is reading assistant response 0)
    createPromptElement('msg-0', -400, -320);
    // Prompt 1 is visible near the bottom edge (top = 700px, container height = 800px)
    createPromptElement('msg-1', 700, 780);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('makes Prompt N+1 Active only after its top crosses the effective boundary', () => {
    const el0 = createPromptElement('msg-0', -600, -520);
    const el1 = createPromptElement('msg-1', 50, 130);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);

    // Scroll down so Prompt 1 reaches the effective boundary (top <= 18)
    mockRect(el0, { top: -650, bottom: -570 });
    mockRect(el1, { top: 16, bottom: 96 });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('returns Active to Prompt N-1 symmetrically on upward scrolling', () => {
    const el0 = createPromptElement('msg-0', -200, -120);
    const el1 = createPromptElement('msg-1', 16, 96);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);

    // Scroll upward: Prompt 1 moves below effective boundary (18px)
    mockRect(el0, { top: -100, bottom: -20 });
    mockRect(el1, { top: 40, bottom: 120 });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('preserves previous Active prompt when final short prompt cannot reach effective boundary', () => {
    // Turn 1 (Prompt 1) is at the top; Turn 2 (final short prompt) is near bottom (500px)
    createPromptElement('msg-1', 0, 80);
    createPromptElement('msg-2', 500, 580);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('falls back to Prompt 0 when at conversation top and Prompt 0 is below effective boundary', () => {
    // User is scrolled to very top; Prompt 0 sits at 40px (below effective boundary 18px)
    createPromptElement('msg-0', 40, 120);
    createPromptElement('msg-1', 450, 530);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('recalculates Active on DOM mutation remounting', async () => {
    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.initTracking();
    expect(tracker.getActiveIndex()).toBeNull();

    // Dynamically mount prompt that crossed the effective boundary
    createPromptElement('msg-0', 10, 90);

    // Allow MutationObserver microtask to fire, then run rAF
    await Promise.resolve();
    vi.runAllTimers();
    expect(tracker.getActiveIndex()).toBe(0);

    tracker.disconnect();
  });

  it('cleans up and resets all listeners and active state', () => {
    createPromptElement('msg-0', 10, 90);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.initTracking();
    expect(tracker.getActiveIndex()).toBe(0);

    tracker.reset();
    expect(tracker.getActiveIndex()).toBeNull();
  });

  it('isolates state across independent instances', () => {
    createPromptElement('msg-0', 10, 90);

    const trackerA = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });
    const trackerB = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    trackerA.checkActivePrompt();
    expect(trackerA.getActiveIndex()).toBe(0);
    expect(trackerB.getActiveIndex()).toBeNull();
  });

  describe('syncActiveIndex & authoritative landing', () => {
    const extendedMessages = Array.from({ length: 180 }, (_, i) => ({
      id: `msg-${i}`,
    }));

    it('syncActiveIndex sets active index and establishes explicit authority', () => {
      const onActiveChange = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onActiveIndexChange: onActiveChange,
      });

      tracker.syncActiveIndex(175);
      expect(tracker.getActiveIndex()).toBe(175);
      expect(onActiveChange).toHaveBeenCalledWith(175, true);
    });

    it('fires callback with changed: false on same-index sync', () => {
      const onActiveChange = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onActiveIndexChange: onActiveChange,
      });

      tracker.syncActiveIndex(175);
      onActiveChange.mockClear();

      tracker.syncActiveIndex(175);
      expect(onActiveChange).toHaveBeenCalledWith(175, false);
      expect(tracker.getActiveIndex()).toBe(175);
    });

    it('cancels pending pre-sync RAF so it cannot overwrite target', () => {
      createPromptElement('msg-2', 0, 100);
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
      });

      tracker.initTracking();
      // Queue a scroll check that would select index 2
      document.dispatchEvent(new Event('scroll'));

      // Explicitly sync to 175 before RAF runs
      tracker.syncActiveIndex(175);

      // Fast-forward animation frames/timers
      vi.runAllTimers();
      expect(tracker.getActiveIndex()).toBe(175);
      tracker.disconnect();
    });

    it('syncViewportIndex seeds viewport index and allows subsequent geometry updates without locking', () => {
      createPromptElement('msg-10', 0, 80);
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
      });

      tracker.initTracking();
      tracker.syncViewportIndex(175);
      expect(tracker.getViewportIndex()).toBe(175);

      // Subsequent scroll event updates viewport naturally based on element geometry
      container.dispatchEvent(new Event('scroll'));
      vi.runAllTimers();
      expect(tracker.getViewportIndex()).toBe(10);

      tracker.disconnect();
    });

    it('wheel inside active chat triggers onUserBrowseIntent', () => {
      const onBrowseIntent = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onUserBrowseIntent: onBrowseIntent,
      });

      tracker.initTracking();

      // Wheel on child inside active chat container
      const chatChild = document.createElement('div');
      container.appendChild(chatChild);
      chatChild.dispatchEvent(new Event('wheel', { bubbles: true }));

      expect(onBrowseIntent).toHaveBeenCalledOnce();

      // Wheel directly on container
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
      expect(onBrowseIntent).toHaveBeenCalledTimes(2);

      tracker.disconnect();
    });

    it('touchmove inside active chat triggers onUserBrowseIntent', () => {
      const onBrowseIntent = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onUserBrowseIntent: onBrowseIntent,
      });

      tracker.initTracking();

      container.dispatchEvent(new Event('touchmove', { bubbles: true }));
      expect(onBrowseIntent).toHaveBeenCalledOnce();

      tracker.disconnect();
    });

    it('wheel or touch outside active chat container does not trigger onUserBrowseIntent', () => {
      const onBrowseIntent = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onUserBrowseIntent: onBrowseIntent,
      });

      tracker.initTracking();

      // Outside element
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);
      outsideEl.dispatchEvent(new Event('wheel', { bubbles: true }));
      outsideEl.dispatchEvent(new Event('touchmove', { bubbles: true }));

      expect(onBrowseIntent).not.toHaveBeenCalled();

      tracker.disconnect();
    });

    it('wheel or touch on LunaTOC sidebar does not trigger onUserBrowseIntent or schedule check', () => {
      const onBrowseIntent = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onUserBrowseIntent: onBrowseIntent,
      });

      tracker.initTracking();

      const sidebar = document.createElement('div');
      sidebar.id = 'luna-toc-sidebar';
      const navigatorList = document.createElement('div');
      navigatorList.id = 'navigator-list';
      sidebar.appendChild(navigatorList);
      document.body.appendChild(sidebar);

      sidebar.dispatchEvent(new Event('wheel', { bubbles: true }));
      navigatorList.dispatchEvent(new Event('touchmove', { bubbles: true }));
      sidebar.dispatchEvent(new Event('scroll', { bubbles: true }));

      expect(onBrowseIntent).not.toHaveBeenCalled();

      tracker.disconnect();
    });

    it('lowestMountedIndex === 0 does not revert deep active position when not at top', () => {
      createPromptElement('msg-0', 1000, 1080);
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
      });

      // container is scrolled deep (scrollTop = 5000)
      Object.defineProperty(container, 'scrollTop', { value: 5000, configurable: true });
      tracker.syncViewportIndex(175);

      tracker.checkActivePrompt();
      expect(tracker.getActiveIndex()).toBe(175); // Does NOT force 0!
    });

    it('missing container does not assume top when active index exists', () => {
      createPromptElement('msg-0', 100, 180);
      const nullContainerPlatform: Platform = {
        ...mockPlatform,
        navigation: {
          ...mockPlatform.navigation,
          getThreadScrollContainer: () => null,
          getScrollContainer: () => null,
        },
      };

      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => nullContainerPlatform,
      });

      tracker.syncViewportIndex(175);

      tracker.checkActivePrompt();
      expect(tracker.getActiveIndex()).toBe(175); // Does NOT force 0!
    });

    it('reset clears state and disconnect cleans up listeners', () => {
      const onBrowseIntent = vi.fn();
      const tracker = createActivePromptTracker({
        getMessages: () => extendedMessages,
        getPlatform: () => mockPlatform,
        onUserBrowseIntent: onBrowseIntent,
      });

      tracker.initTracking();
      tracker.syncViewportIndex(175);
      expect(tracker.getViewportIndex()).toBe(175);

      tracker.reset();
      expect(tracker.getViewportIndex()).toBeNull();

      // Events after disconnect/reset do not trigger callbacks
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
      expect(onBrowseIntent).not.toHaveBeenCalled();
    });
  });
});
