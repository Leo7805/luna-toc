/** @vitest-environment jsdom */
/**
 * Tests native same-tab SPA message navigation (`?message=<id>` via History API +
 * `popstate`) in `promptCoordinator` and `nativeMessageJump`, verifying zero
 * viewport/alignment interference while ChatGPT controls scrolling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coordinatePromptJump } from '@/navigation/jump/prompt/promptCoordinator';
import { getActivePlatform } from '@/platforms';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

const CONV_ID = '6b0157ca-fbd4-83ec-95f5-f69264e32c31';
const MSG_226_ID = '2ebc4639-745b-49a5-abbf-2f55ef750a3e';
const MSG_100_ID = '0fcd1935-9855-462b-bca5-38ef1b2d9491';

function makeMessage(id: string, text = `Prompt ${id}`): NavigatorMessage {
  return { id, text, canMatchByText: true, createTime: 1000 };
}

function createScrollContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'thread-scroll-container';
  Object.defineProperty(container, 'scrollHeight', { value: 30000, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
  container.scrollTop = 29100;
  container.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 900,
      left: 0,
      right: 800,
      width: 800,
      height: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

function setElementTop(el: HTMLElement, top: number, height = 100): void {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 760,
      width: 760,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function mountPromptEl(container: HTMLElement, id: string, top = 10): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('data-chatgpt-search-unit-key', `${id}:0:user`);
  el.setAttribute('data-chatgpt-search-message-ids', id);
  setElementTop(el, top);
  container.appendChild(el);
  return el;
}

describe('native same-tab SPA message navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', `/c/${CONV_ID}`);
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(`https://chatgpt.com/c/${CONV_ID}`),
    });
    container = createScrollContainer();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('1. preserves mounted-target fast path with holdViewport and onTargetReady without pushState', () => {
    const mountedEl = mountPromptEl(container, MSG_226_ID, 250);
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const holdViewportSpy = vi.spyOn(getActivePlatform().navigation, 'holdViewport');
    const onTargetReady = vi.fn();
    const onJumpComplete = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_226_ID),
      index: 225,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
        onTargetReady,
        onJumpComplete,
      },
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(holdViewportSpy).toHaveBeenCalledWith(container);
    expect(onTargetReady).toHaveBeenCalledTimes(1);
    expect(onTargetReady.mock.calls[0][0].target).toBe(mountedEl);
    expect(onJumpComplete).not.toHaveBeenCalled();
  });

  it('2-3. does not call holdViewport or onTargetReady/alignment scrolls during native SPA navigation and completes when stably landed at ~10px', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(`https://chatgpt.com/c/${CONV_ID}?model=gpt-5`),
    });

    const holdViewportSpy = vi.spyOn(getActivePlatform().navigation, 'holdViewport');
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;
    const pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation((_s, _t, url) => {
      if (typeof url === 'string') {
        Object.defineProperty(window, 'location', {
          writable: true,
          value: new URL(url, 'https://chatgpt.com'),
        });
      }
    });

    const popstateEvents: PopStateEvent[] = [];
    const onPopstate = (ev: PopStateEvent) => {
      popstateEvents.push(ev);
      setTimeout(() => {
        container.scrollTop = 19473;
        mountPromptEl(container, MSG_226_ID, 10);
      }, 100);
    };
    window.addEventListener('popstate', onPopstate);

    const onTargetReady = vi.fn();
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    try {
      coordinatePromptJump({
        message: makeMessage(MSG_226_ID),
        index: 225,
        mode: 'target-driven',
        hooks: {
          getVirtualSearchContext: () => ({
            conversationKey: CONV_ID,
            prompts: [makeMessage(MSG_226_ID)],
          }),
          isCancelled: () => false,
          onTargetDrivenStart: vi.fn(),
          onMissingContextFailure: vi.fn(),
          onMountFailure,
          clearJumpProgress: vi.fn(),
          onTargetReady,
          onJumpComplete,
        },
      });

      expect(holdViewportSpy).not.toHaveBeenCalled();
      expect(pushStateSpy).toHaveBeenCalledTimes(1);
      expect(pushStateSpy).toHaveBeenCalledWith(
        null,
        '',
        `/c/${CONV_ID}?model=gpt-5&message=${MSG_226_ID}`
      );
      expect(popstateEvents).toHaveLength(1);

      // Immediately after initial mount (t=150ms), target is not yet settled
      await vi.advanceTimersByTimeAsync(150);
      expect(onJumpComplete).not.toHaveBeenCalled();
      expect(onTargetReady).not.toHaveBeenCalled();

      // After bounded settling window passes with stable top ~10px (completes fast without waiting for 15s ceiling)
      await vi.advanceTimersByTimeAsync(500);

      expect(holdViewportSpy).not.toHaveBeenCalled();
      expect(scrollToSpy).not.toHaveBeenCalled();
      expect(container.scrollTop).toBe(19473);
      expect(onTargetReady).not.toHaveBeenCalled();
      expect(onMountFailure).not.toHaveBeenCalled();
      expect(onJumpComplete).toHaveBeenCalledTimes(1);
      expect(onJumpComplete).toHaveBeenCalledWith(225);
    } finally {
      window.removeEventListener('popstate', onPopstate);
    }
  });

  it('4-6. does not report success for transiently mounted, off-screen, or disconnected targets', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const onTargetReady = vi.fn();
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_226_ID),
      index: 225,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure,
        clearJumpProgress: vi.fn(),
        onTargetReady,
        onJumpComplete,
      },
    });

    // Transient off-screen mount (like top: -1448 observed in Chrome), then disconnects
    await vi.advanceTimersByTimeAsync(100);
    const transientEl = mountPromptEl(container, MSG_226_ID, -1448);
    await vi.advanceTimersByTimeAsync(100);
    transientEl.remove();

    // Even if it briefly mounts visibly for 100ms then disconnects, it must not succeed
    await vi.advanceTimersByTimeAsync(100);
    const briefEl = mountPromptEl(container, MSG_226_ID, 10);
    await vi.advanceTimersByTimeAsync(100);
    briefEl.remove();

    await vi.advanceTimersByTimeAsync(16000);

    expect(onTargetReady).not.toHaveBeenCalled();
    expect(onJumpComplete).not.toHaveBeenCalled();
    expect(onMountFailure).toHaveBeenCalledTimes(1);
    expect(onMountFailure).toHaveBeenCalledWith(225);
  });

  it('5. waits for positional stability before reporting completion when native scroll is still moving', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_226_ID),
      index: 225,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure,
        clearJumpProgress: vi.fn(),
        onTargetReady: vi.fn(),
        onJumpComplete,
      },
    });

    const el = mountPromptEl(container, MSG_226_ID, 420);
    await vi.advanceTimersByTimeAsync(150);
    expect(onJumpComplete).not.toHaveBeenCalled();

    // Simulate ChatGPT still adjusting layout/scroll position
    setElementTop(el, 210);
    container.scrollTop = 19600;
    await vi.advanceTimersByTimeAsync(150);
    expect(onJumpComplete).not.toHaveBeenCalled();

    // Final native landing at top: 10px
    setElementTop(el, 10);
    container.scrollTop = 19473;
    await vi.advanceTimersByTimeAsync(200);
    expect(onJumpComplete).not.toHaveBeenCalled();

    // Remains stable across full settling window
    await vi.advanceTimersByTimeAsync(300);
    expect(onMountFailure).not.toHaveBeenCalled();
    expect(onJumpComplete).toHaveBeenCalledTimes(1);
    expect(onJumpComplete).toHaveBeenCalledWith(225);
  });

  it('6. keeps the same route key for same-conversation ?message=<id> URLs so TOC is not reset', () => {
    const platform = getActivePlatform();
    const keyBefore = platform.routing.getCurrentRouteKey();

    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(`https://chatgpt.com/c/${CONV_ID}?message=${MSG_226_ID}`),
    });
    const keyAfter = platform.routing.getCurrentRouteKey();

    expect(keyBefore).toBe(CONV_ID);
    expect(keyAfter).toBe(CONV_ID);
  });

  it('7. cancellation and rapid successive clicks invalidate earlier completion and deliver only the latest target', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});

    let version = 1;
    const onJumpComplete = vi.fn();

    // Click 1 -> #226
    const v1 = version;
    coordinatePromptJump({
      message: makeMessage(MSG_226_ID),
      index: 225,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_100_ID), makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => v1 !== version,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
        onTargetReady: vi.fn(),
        onJumpComplete,
      },
    });

    // Click 1 mounts, then rapid Click 2 supersedes it before settling finishes
    mountPromptEl(container, MSG_226_ID, 10);
    await vi.advanceTimersByTimeAsync(100);

    version += 1;
    const v2 = version;
    coordinatePromptJump({
      message: makeMessage(MSG_100_ID),
      index: 99,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_100_ID), makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => v2 !== version,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
        onTargetReady: vi.fn(),
        onJumpComplete,
      },
    });

    mountPromptEl(container, MSG_100_ID, 10);
    await vi.advanceTimersByTimeAsync(600);

    expect(onJumpComplete).toHaveBeenCalledTimes(1);
    expect(onJumpComplete).toHaveBeenCalledWith(99);
  });

  it('8. fails cleanly without retries, scroll writes, or walker fallback when native navigation never mounts target', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const holdViewportSpy = vi.spyOn(getActivePlatform().navigation, 'holdViewport');
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;
    const initialScrollTop = container.scrollTop;

    const onTargetReady = vi.fn();
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_226_ID),
      index: 225,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure,
        clearJumpProgress: vi.fn(),
        onTargetReady,
        onJumpComplete,
      },
    });

    expect(pushStateSpy).toHaveBeenCalledTimes(1);

    // Must not fail prematurely before the 15s ceiling
    await vi.advanceTimersByTimeAsync(14000);
    expect(onMountFailure).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(holdViewportSpy).not.toHaveBeenCalled();
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(initialScrollTop);
    expect(onTargetReady).not.toHaveBeenCalled();
    expect(onJumpComplete).not.toHaveBeenCalled();
    expect(onMountFailure).toHaveBeenCalledTimes(1);
    expect(onMountFailure).toHaveBeenCalledWith(225);
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
  });

  it('9. fails safely without pushState when message ID is empty or route does not match conversation', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const nav = getActivePlatform().navigation;
    expect(typeof nav.navigateToMessage).toBe('function');

    expect(nav.navigateToMessage!(CONV_ID, '')).toEqual({
      status: 'unavailable',
      reason: 'invalid-target',
    });
    expect(nav.navigateToMessage!('other-conv-id', MSG_226_ID)).toEqual({
      status: 'unavailable',
      reason: 'route-mismatch',
    });
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('10. Issue A: distant target mounting at 7000ms succeeds within the 15s bounded ceiling', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_100_ID),
      index: 99,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_100_ID), makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure,
        clearJumpProgress: vi.fn(),
        onTargetReady: vi.fn(),
        onJumpComplete,
      },
    });

    await vi.advanceTimersByTimeAsync(7000);
    expect(onMountFailure).not.toHaveBeenCalled();
    expect(onJumpComplete).not.toHaveBeenCalled();

    container.scrollTop = 32379;
    mountPromptEl(container, MSG_100_ID, 10);
    await vi.advanceTimersByTimeAsync(500);

    expect(onMountFailure).not.toHaveBeenCalled();
    expect(onJumpComplete).toHaveBeenCalledTimes(1);
    expect(onJumpComplete).toHaveBeenCalledWith(99);
  });

  it('11. Issue A: cancellation during extended wait stops promptly without completion or failure', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    let cancelled = false;
    const onJumpComplete = vi.fn();
    const onMountFailure = vi.fn();

    coordinatePromptJump({
      message: makeMessage(MSG_100_ID),
      index: 99,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_100_ID), makeMessage(MSG_226_ID)],
        }),
        isCancelled: () => cancelled,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure,
        clearJumpProgress: vi.fn(),
        onTargetReady: vi.fn(),
        onJumpComplete,
      },
    });

    await vi.advanceTimersByTimeAsync(4000);
    cancelled = true;
    mountPromptEl(container, MSG_100_ID, 10);
    await vi.advanceTimersByTimeAsync(12000);

    expect(onJumpComplete).not.toHaveBeenCalled();
    expect(onMountFailure).not.toHaveBeenCalled();
  });

  it('12. Issue B: unmounted last prompt skips native pushState and uses scrollToBottom -> waitForNativeBottomSettle -> onTargetReady', async () => {
    const LAST_ID = '9cd218f0-1dbe-4e10-aacb-5ef5f4907776';
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const scrollToBottomSpy = vi
      .spyOn(getActivePlatform().navigation, 'scrollToBottom')
      .mockImplementation(() => {
        container.scrollTop = 29100;
        mountPromptEl(container, LAST_ID, 10);
        return { status: 'ok' };
      });
    const onTargetReady = vi.fn();
    const onJumpComplete = vi.fn();

    coordinatePromptJump({
      message: makeMessage(LAST_ID),
      index: 1,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID), makeMessage(LAST_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
        onTargetReady,
        onJumpComplete,
      },
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(scrollToBottomSpy).toHaveBeenCalledWith(container);

    await vi.advanceTimersByTimeAsync(300);

    expect(onTargetReady).toHaveBeenCalledTimes(1);
    expect(
      onTargetReady.mock.calls[0][0].target.getAttribute('data-chatgpt-search-message-ids')
    ).toBe(LAST_ID);
    expect(onJumpComplete).not.toHaveBeenCalled();
  });

  it('13. Issue B: mounted last prompt retains normal fast-path behavior without pushState or scrollToBottom', () => {
    const LAST_ID = '9cd218f0-1dbe-4e10-aacb-5ef5f4907776';
    const mountedLast = mountPromptEl(container, LAST_ID, 200);
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const scrollToBottomSpy = vi.spyOn(getActivePlatform().navigation, 'scrollToBottom');
    const onTargetReady = vi.fn();

    coordinatePromptJump({
      message: makeMessage(LAST_ID),
      index: 1,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID), makeMessage(LAST_ID)],
        }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
        onTargetReady,
        onJumpComplete: vi.fn(),
      },
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(scrollToBottomSpy).not.toHaveBeenCalled();
    expect(onTargetReady).toHaveBeenCalledTimes(1);
    expect(onTargetReady.mock.calls[0][0].target).toBe(mountedLast);
  });

  it('14. Issue B: cancellation during unmounted last-prompt bottom settlement aborts cleanly', async () => {
    const LAST_ID = '9cd218f0-1dbe-4e10-aacb-5ef5f4907776';
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    vi.spyOn(getActivePlatform().navigation, 'scrollToBottom').mockReturnValue({
      status: 'ok',
    });
    let cancelled = false;
    const onTargetReady = vi.fn();
    const clearJumpProgress = vi.fn();

    coordinatePromptJump({
      message: makeMessage(LAST_ID),
      index: 1,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({
          conversationKey: CONV_ID,
          prompts: [makeMessage(MSG_226_ID), makeMessage(LAST_ID)],
        }),
        isCancelled: () => cancelled,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: vi.fn(),
        clearJumpProgress,
        onTargetReady,
        onJumpComplete: vi.fn(),
      },
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    cancelled = true;
    await vi.advanceTimersByTimeAsync(200);

    expect(onTargetReady).not.toHaveBeenCalled();
    expect(clearJumpProgress).toHaveBeenCalledTimes(1);
  });
});
