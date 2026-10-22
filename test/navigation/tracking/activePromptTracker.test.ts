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

  it('does NOT activate Prompt N+1 while it has not sufficiently entered the viewport', () => {
    createPromptElement('msg-0', -400, -320);
    // Container height is 800px. Prompt 1 top is at 790px (only 10px entered < 16px threshold)
    createPromptElement('msg-1', 790, 870);

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

  it('Rule A (Scenario A1): activates visible Prompt N+1 even when Assistant Response N occupies the viewport top', () => {
    // Prompt 0 is above viewport top (user is reading assistant response 0)
    createPromptElement('msg-0', -400, -320);
    // Prompt 1 is visible near the bottom edge (top = 700px, container height = 800px)
    createPromptElement('msg-1', 700, 780);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Rule A: Prompt 1 is visible in viewport, so it takes precedence over Assistant 0
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('makes Prompt N+1 Active once it enters the viewport past the visibility threshold', () => {
    const el0 = createPromptElement('msg-0', -600, -520);
    // Below viewport (850px)
    const el1 = createPromptElement('msg-1', 850, 930);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Below viewport: Rule B fallback keeps Prompt 0
    expect(tracker.getActiveIndex()).toBe(0);

    // Scroll down so Prompt 1 enters past the visibility threshold (e.g. top = 750px)
    mockRect(el0, { top: -700, bottom: -620 });
    mockRect(el1, { top: 750, bottom: 830 });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('returns Active to Prompt N-1 symmetrically when upward scrolling brings Prompt N-1 into the viewport', () => {
    const el0 = createPromptElement('msg-0', -200, -120);
    const el1 = createPromptElement('msg-1', 16, 96);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);

    // Scroll upward: Prompt 0 enters the viewport above Prompt 1
    mockRect(el0, { top: 50, bottom: 130 });
    mockRect(el1, { top: 500, bottom: 580 });

    tracker.checkActivePrompt();
    // Rule A: Prompt 0 is visually topmost, so active returns to 0
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('Rule A: activates final short prompt when visible in viewport even if it cannot reach top boundary', () => {
    // Prompt 1 is above the viewport (e.g. -400px); final short Prompt 2 is visible at 500px
    createPromptElement('msg-1', -400, -320);
    createPromptElement('msg-2', 500, 580);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Rule A: Final short prompt 2 is visible in viewport, so it becomes Active
    expect(tracker.getActiveIndex()).toBe(2);
  });

  it('Rule A (Scenario A2): selects the visually topmost prompt when multiple prompts are visible', () => {
    // Both Prompt 1 and Prompt 2 are visible
    createPromptElement('msg-1', 100, 180);
    createPromptElement('msg-2', 500, 580);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('Rule A: uses visual geometry order when DOM query order differs from visual order', () => {
    // Prompt 2 is first in DOM, but visually lower (top = 500)
    createPromptElement('msg-2', 500, 580);
    // Prompt 1 is second in DOM, but visually higher (top = 100)
    createPromptElement('msg-1', 100, 180);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Visual sort selects Prompt 1 despite DOM position
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('Rule A (Scenario A3): prompt partially leaving through top remains active while above threshold', () => {
    // Prompt 1 is leaving top: top is -50px, bottom is 30px (extends past viewportTop 18px by 12px)
    createPromptElement('msg-1', -50, 30);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('Rule A: very short prompt activates when at least 50% visible', () => {
    createPromptElement('msg-0', -400, -320);
    // Short prompt: height 20px (top = 788, bottom = 808). Entry threshold = min(16, 10) = 10px.
    // containerBottom = 800. top (788) <= 800 - 10 = 790 => visible
    createPromptElement('msg-1', 788, 808);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('Rule A (Scenario A4): ignores unlisted prompt and selects visible valid TOC prompt', () => {
    // Unlisted prompt without TOC entry (e.g. interrupted Prompt A) is at top 50px
    createPromptElement('msg-unlisted', 50, 130);
    // Valid Prompt 1 is at top 250px
    createPromptElement('msg-1', 250, 330);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages, // only contains msg-0, msg-1, msg-2
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Unlisted prompt is ignored; valid Prompt 1 is selected
    expect(tracker.getActiveIndex()).toBe(1);
  });

  it('Rule B: falls back to top-boundary prompt during long assistant response when no prompt is visible', () => {
    // Prompt 0 is far above viewport; Prompt 1 is far below viewport
    createPromptElement('msg-0', -600, -520);
    createPromptElement('msg-1', 950, 1030);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    // Rule B: neither prompt visible, selects Prompt 0 via latestAboveTop
    expect(tracker.getActiveIndex()).toBe(0);
  });

  it('Rule B: ignores unlisted prompt when no valid prompt is visible', () => {
    createPromptElement('msg-0', -600, -520);
    // Only an unlisted prompt is in the viewport
    createPromptElement('msg-unlisted', 100, 180);

    const tracker = createActivePromptTracker({
      getMessages: () => sampleMessages,
      getPlatform: () => mockPlatform,
    });

    tracker.checkActivePrompt();
    expect(tracker.getActiveIndex()).toBe(0);
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
