/** @vitest-environment jsdom */
/** Tests independent virtual navigation strategy and regressions. */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  findPrompt: vi.fn(),
  findPromptByText: vi.fn(() => null as HTMLElement | null),
  getContainer: vi.fn(),
  createJumpId: vi.fn(() => 'jump-id-stub'),
  getTestConfig: vi.fn(() => null),
  logEvent: vi.fn(),
  setJumpProgress: vi.fn(),
  clearJumpProgress: vi.fn(),
  notifyJumpFailed: vi.fn(),
  onJumpComplete: vi.fn(),
  queryVirtualJumpTarget: vi.fn(),
  holdViewport: vi.fn(() => ({ status: 'ok' as const })),
  scrollToBottom: vi.fn(() => ({
    status: 'unavailable' as const,
    reason: 'test-default',
  })),
  readMountedWithSidebarIdx: vi.fn<() => Array<{ element: HTMLElement; sidebarIdx: number; unitKey?: string }>>(() => []),
  promptLandingViewportTopPx: undefined as number | undefined,
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    id: 'chatgpt',
    navigation: {
      getScrollContainer: mocks.getContainer,
      findRenderedPrompt: mocks.findPrompt,
      findRenderedPromptByText: mocks.findPromptByText,
      readMountedWithSidebarIdx: mocks.readMountedWithSidebarIdx,
      queryVirtualJumpTarget: mocks.queryVirtualJumpTarget,
      holdViewport: mocks.holdViewport,
      scrollToBottom: mocks.scrollToBottom,
      promptTopOffsetPx: 16,
      get promptLandingViewportTopPx() {
        return mocks.promptLandingViewportTopPx;
      },
    },
    diagnostics: {
      createJumpId: mocks.createJumpId,
      getTestConfig: mocks.getTestConfig,
      logEvent: mocks.logEvent,
    },
    config: {
      selectors: {
        userMessage: '[data-chatgpt-search-unit-key$=":user"]',
        assistantMessage: '[data-chatgpt-search-unit-key$=":assistant"]',
        messageId: 'data-chatgpt-search-message-ids',
      },
    },
  }),
}));

vi.mock('@/navigation/follow/follow', () => ({
  keepFollowing: vi.fn(),
}));

import { APP_CONFIG } from '@/config/config';
import { keepFollowing } from '@/navigation/follow/follow';
import { clearPromptHighlightOverlay } from '@/navigation/jump/promptHighlightOverlay';
import * as viewportWalker from '@/navigation/jump/viewportWalker';
import {
  alignElementInContainer,
  cancelActiveNavigationSearch,
  computePromptLandingOffset,
  initializePromptNavigation,
  jumpToConversationEdge,
  jumpToMessage,
} from '@/navigation/jump/promptNavigation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.promptLandingViewportTopPx = undefined;
  document.body.innerHTML = '';
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: number[] = [];

      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    })
  );
  mocks.queryVirtualJumpTarget.mockReturnValue(undefined);
  mocks.readMountedWithSidebarIdx.mockReturnValue([]);

  initializePromptNavigation({
    getVirtualSearchContext: () => ({
      conversationKey: 'conversation-1',
      prompts: [
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
      ],
    }),
    setJumpProgress: mocks.setJumpProgress,
    clearJumpProgress: mocks.clearJumpProgress,
    notifyJumpFailed: mocks.notifyJumpFailed,
    onJumpComplete: mocks.onJumpComplete,
  });
});

afterEach(() => {
  clearPromptHighlightOverlay();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prompt navigation strategy', () => {
  it('always uses independent navigation for jumpToMessage and ignores any legacy navigation preference', () => {
    localStorage.setItem(
      'chatToc:navigationSettings',
      JSON.stringify({ chatgpt: 'legacy-native' })
    );

    const container = document.createElement('div');
    const target = document.createElement('div');
    document.body.append(container, target);
    target.scrollIntoView = vi.fn();
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(target);

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
    vi.advanceTimersByTime(250);
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
  });

  it('viewport-driven mode navigates to prompt without calling onJumpStart or onJumpComplete', async () => {
    const onJumpStart = vi.fn();
    const onJumpComplete = vi.fn();

    initializePromptNavigation({
      getVirtualSearchContext: () => ({
        conversationKey: 'conv-test',
        prompts: [{ id: 'p-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }],
      }),
      onJumpStart,
      onJumpComplete,
    });

    const container = document.createElement('div');
    const mountedPrompt = document.createElement('div');
    mountedPrompt.setAttribute('data-chatgpt-search-unit-key', 'p-1:user');
    mountedPrompt.setAttribute('data-chatgpt-search-message-ids', 'p-1');
    container.appendChild(mountedPrompt);
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(mountedPrompt);
    mountedPrompt.scrollIntoView = vi.fn();

    jumpToMessage({ id: 'p-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0, {
      mode: 'viewport-driven',
    });

    expect(mountedPrompt.scrollIntoView).toHaveBeenCalledOnce();
    expect(onJumpStart).not.toHaveBeenCalled();
    expect(onJumpComplete).not.toHaveBeenCalled();
  });

  it('navigates directly to absolute edge in jumpToConversationEdge', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    container.scrollTop = 500;
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);

    jumpToConversationEdge('top');

    expect(container.scrollTop).toBe(0);
  });

  it('navigates directly via fast-path when target is rendered in independent-virtual strategy', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');
    document.body.append(container, target);
    target.scrollIntoView = vi.fn();
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(target);

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'start',
    });
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).not.toBeNull();
    expect(target.style.outline).toBe('');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    expect(target.style.outline).toBe('');
  });

  it('initiates virtual step-loading when target is not rendered in the DOM', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(null);

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(mocks.setJumpProgress).toHaveBeenCalledWith({
      active: true,
      targetIndex: 0,
      remainingSteps: 50,
    });
  });

  it('starts independent virtual search without calling the legacy path', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    container.scrollTop = 400;
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(null);

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(mocks.setJumpProgress).toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.notifyJumpFailed).toHaveBeenCalledOnce();
    expect(mocks.clearJumpProgress).toHaveBeenCalled();
    expect(container.scrollTop).toBe(400);
  });

  it('locks virtual mode for older target and does not fall back to walker on exhaustion', async () => {
    const walkerSpy = vi.spyOn(viewportWalker, 'loadUntilMountedViaViewport');
    try {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);
      mocks.findPrompt.mockReturnValue(null);

      // Target not in layout, turnCount 50
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'target-not-in-layout',
        turnCount: 50,
      });

      // Mounted element at sidebarIdx 5 -> Target at index 0 => direction -1 (older)
      mocks.readMountedWithSidebarIdx.mockReturnValue([
        { element: document.createElement('div'), sidebarIdx: 5, unitKey: 'k-5' },
      ]);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        0
      );

      // Fast-forward fake timers beyond 20000ms no-progress watchdog budget
      await vi.advanceTimersByTimeAsync(20100);

      // Walker was NEVER invoked
      expect(walkerSpy).not.toHaveBeenCalled();
      // Navigation terminated cleanly
      expect(mocks.notifyJumpFailed).toHaveBeenCalledOnce();
      expect(mocks.clearJumpProgress).toHaveBeenCalled();
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({ attempts: 'virtual-exhausted' }),
        undefined
      );
    } finally {
      walkerSpy.mockRestore();
    }
  });

  describe('jump completion ordering & onJumpComplete hook', () => {
    it('primary success: scroll success -> keepFollowing(1800) -> onJumpComplete', () => {
      const container = document.createElement('div');
      const target = document.createElement('div');
      document.body.append(container, target);
      target.scrollIntoView = vi.fn();
      mocks.getContainer.mockReturnValue(container);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        3
      );

      expect(target.scrollIntoView).toHaveBeenCalledOnce();
      expect(keepFollowing).toHaveBeenCalledWith(1800);
      vi.advanceTimersByTime(250);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(3);
    });

    it('primary scroll failure (target disconnected): no Follow refresh, no completion', () => {
      const container = document.createElement('div');
      const target = document.createElement('div');
      // target not appended to DOM -> isConnected === false
      mocks.getContainer.mockReturnValue(container);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        3
      );

      // keepFollowing was called with 15000 on jump start, but NOT refreshed with 1800
      expect(keepFollowing).not.toHaveBeenCalledWith(1800);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    });

    it('primary superseded jump: no Follow refresh, no completion', () => {
      const container = document.createElement('div');
      const target1 = document.createElement('div');
      const target2 = document.createElement('div');
      document.body.append(container, target1, target2);

      // Custom scrollIntoView that triggers a second jump synchronously during the scroll of jump 1
      target1.scrollIntoView = vi.fn(() => {
        jumpToMessage(
          {
            id: 'prompt-2',
            text: 'Prompt 2',
            canMatchByText: true,
            createTime: 0,
          },
          4
        );
      });
      target2.scrollIntoView = vi.fn();

      mocks.getContainer.mockReturnValue(container);
      mocks.findPrompt.mockReturnValueOnce(target1).mockReturnValueOnce(target2);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt 1',
          canMatchByText: true,
          createTime: 0,
        },
        3
      );

      // Only the winning jump 2 (index 4) completes; jump 1 (index 3) was superseded
      vi.advanceTimersByTime(250);
      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
    });

    it('600ms re-poll success: scroll success -> Follow refresh -> completion exactly once', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      mocks.getContainer.mockReturnValue(container);

      // Initially disconnected target -> primary scrollTargetIntoView returns false
      const targetDisconnected = document.createElement('div');
      mocks.findPrompt.mockReturnValueOnce(targetDisconnected);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        2
      );

      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      // Later, re-poll finds connected target
      const targetConnected = document.createElement('div');
      document.body.appendChild(targetConnected);
      targetConnected.scrollIntoView = vi.fn();
      mocks.findPrompt.mockReturnValue(targetConnected);

      await vi.advanceTimersByTimeAsync(600);

      expect(targetConnected.scrollIntoView).toHaveBeenCalled();
      expect(keepFollowing).toHaveBeenCalledWith(1800);
      expect(mocks.onJumpComplete).toHaveBeenCalledOnce();
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(2);
    });

    it('600ms re-poll failure: no Follow refresh, no completion', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      mocks.getContainer.mockReturnValue(container);

      const targetDisconnected = document.createElement('div');
      mocks.findPrompt.mockReturnValue(targetDisconnected);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        2
      );

      await vi.advanceTimersByTimeAsync(600);

      expect(keepFollowing).not.toHaveBeenCalledWith(1800);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    });

    it('600ms re-poll superseded: no Follow refresh, no completion', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      mocks.getContainer.mockReturnValue(container);

      const targetDisconnected = document.createElement('div');
      mocks.findPrompt.mockReturnValueOnce(targetDisconnected);

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt',
          canMatchByText: true,
          createTime: 0,
        },
        2
      );

      // Supersede with a second jump at t=300ms
      await vi.advanceTimersByTimeAsync(300);
      const target2 = document.createElement('div');
      document.body.appendChild(target2);
      target2.scrollIntoView = vi.fn();
      mocks.findPrompt.mockReturnValue(target2);

      jumpToMessage(
        {
          id: 'prompt-2',
          text: 'Prompt 2',
          canMatchByText: true,
          createTime: 0,
        },
        5
      );

      await vi.advanceTimersByTimeAsync(250);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(5);
      mocks.onJumpComplete.mockClear();

      // Advance to 600ms when jump 1 re-poll would fire
      await vi.advanceTimersByTimeAsync(300);

      // Jump 1 re-poll sees jumpVersion !== navigationJumpVersion and does not complete
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    });
  });

  describe('post-mount layout stabilization & alignment', () => {
    interface QueuedFrame {
      id: number;
      cb: FrameRequestCallback;
    }
    let rafQueue: QueuedFrame[] = [];
    let cancelledRafs = new Set<number>();
    let nextRafId = 1;

    beforeEach(() => {
      rafQueue = [];
      cancelledRafs = new Set<number>();
      nextRafId = 1;

      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafQueue.push({ id, cb });
        return id;
      }));

      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
        cancelledRafs.add(id);
      }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const stepFrame = async (deltaMs = 16): Promise<boolean> => {
      vi.advanceTimersByTime(deltaMs);
      const batch = rafQueue.splice(0, rafQueue.length);
      let executed = false;
      for (const item of batch) {
        if (!cancelledRafs.has(item.id)) {
          item.cb(performance.now());
          executed = true;
        }
      }
      if (executed) {
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        return true;
      }
      return false;
    };

    const flushStableWindow = async (durationMs = 350, deltaMs = 16): Promise<void> => {
      const frames = Math.ceil(durationMs / deltaMs) + 2;
      for (let i = 0; i < frames; i++) {
        if (!(await stepFrame(deltaMs))) break;
      }
    };

    it('initially unmounted Prompt #1 becomes mounted and aligns correctly on the first click', async () => {
      const container = document.createElement('div');
      let promptTop = 200;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          promptTop -= delta;
        }
      });
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage(
        {
          id: 'prompt-1',
          text: 'Prompt 1',
          canMatchByText: true,
          createTime: 0,
        },
        0
      );

      // Mount prompt into container and resolve mount check
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Direct container scroll aligned target to 16px (0 + 200 - 16 = 184)
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 184, behavior: 'auto' });
      expect(promptTop).toBe(16);

      // Flush stable animation window (>= 120ms and >= 3 consecutive aligned frames)
      await flushStableWindow();

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('layout changes after mounting trigger remeasurement and realignment', async () => {
      const container = document.createElement('div');
      let promptTop = 300;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          promptTop -= delta;
        }
      });
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(promptTop).toBe(16);
      const callsBeforeShift = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;

      // TanStack Virtual dynamic ResizeObserver measurement shifts Prompt #1 to 80px
      promptTop = 80;

      // Frame 1 check detects displacement and realigns via container.scrollTo
      expect(await stepFrame()).toBe(true);
      expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeShift + 1);
      expect(promptTop).toBe(16);

      // Flush stable window after realignment
      await flushStableWindow();

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('late layout shift after initial aligned frames resets stability window and realigns', async () => {
      const container = document.createElement('div');
      let promptTop = 16;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          promptTop -= delta;
        }
      });
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Already aligned at 16px after coarse jump; only the coarse scrollTo(0) ran
      const callsBeforeShift = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;

      // Frame 1: aligned (consecutive = 1)
      expect(await stepFrame()).toBe(true);
      // Frame 2: aligned (consecutive = 2)
      expect(await stepFrame()).toBe(true);

      // Late shift occurs before reaching stability window
      promptTop = 95;

      // Frame 3 detects displacement, resets stability count, and realigns
      expect(await stepFrame()).toBe(true);
      expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeShift + 1);
      expect(promptTop).toBe(16);

      // Flush stable window after realignment
      await flushStableWindow();

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('handles unreachable top offset at scroll minimum without repeated scrolls or failure', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 0;
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      // Element sits at top: 6px, but container.scrollTop is already 0 (cannot scroll up any further)
      const targetPrompt = document.createElement('div');
      const promptTop = 6;
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Only the coarse scrollTo(0) ran; direct alignment recognizes clamp at scrollTop=0
      expect(container.scrollTo).toHaveBeenCalledTimes(1);

      // Bounded at minimum scroll boundary: settles without repeated no-op scrolls
      await flushStableWindow();

      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('does not classify prompt clipped above viewport as bounded when scrollTop is 0', async () => {
      const container = document.createElement('div');
      let promptTop = -60;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 200;
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      // Prompt is clipped 60px above visible viewport while container is at scrollTop = 0
      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Prompt remains clipped at -60px while scrollTop = 0: must NOT classify as 'bounded'
      await flushStableWindow(120);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      // Once layout settles and target moves into aligned position (16px), it completes cleanly
      promptTop = 16;
      await flushStableWindow();
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('executes final physical scroll to top:0 after unmounted Prompt #1 is mounted and stabilized when alignToTopEdge is enabled', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts: any) => {
        if (typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 1200;
      Object.defineProperty(container, 'scrollHeight', { value: 15000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 1200,
        turnCount: 500,
      });

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Flush stable window to complete post-mount stabilization
      await flushStableWindow();

      // Final physical scroll was executed after target resolution
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(container.scrollTop).toBe(0);
    });

    it('executes final physical scroll to top:0 on already-mounted Prompt #1 fast path when alignToTopEdge is enabled', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts: any) => {
        if (typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 500;
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);
      document.body.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      for (let i = 0; i < 12; i++) {
        if (!(await stepFrame())) break;
      }

      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(container.scrollTop).toBe(0);
    });

    it('executes final physical scroll to top:0 when stabilization exhausts retry budget but target is mounted', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts: any) => {
        if (typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 500;
      Object.defineProperty(container, 'scrollHeight', { value: 6000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      // Target persistently fails to stabilize (diff is always 134px > tolerance)
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 150, bottom: 250, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 1200,
        turnCount: 500,
      });

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Step past the 600ms pass budget / 3 cooldown-paced realignments to exhaust stabilization
      for (let i = 0; i < 45; i++) {
        if (!(await stepFrame())) break;
      }

      // Assert terminal exhaustion branch was reached
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({ status: 'alignment-unstable' }),
        undefined
      );
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(container.scrollTop).toBe(0);
    });

    it('does not execute final physical scroll if target is lost/disconnected during stabilization', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 1200;
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 1200,
        turnCount: 500,
      });

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      // Target mounts initially, then disconnects immediately
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      targetPrompt.remove();
      mocks.findPrompt.mockReturnValue(null);

      for (let i = 0; i < 20; i++) {
        if (!(await stepFrame())) break;
      }

      expect(container.scrollTo).not.toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    it('pending navigation cancellation before target mount prevents final physical-top scroll', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 1200;
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      // Target is unmounted while virtual search begins
      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 1200,
        turnCount: 500,
      });

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      // User cancels via wheel/touch browse intent while navigation is still pending
      cancelActiveNavigationSearch();

      // Target mounts later after cancellation
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);

      for (let i = 0; i < 20; i++) {
        if (!(await stepFrame())) break;
      }

      expect(container.scrollTo).not.toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    it('user cancellation after initial physical scroll prevents verification frame from overriding user interaction', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts: any) => {
        if (typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 500;
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);
      document.body.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);

      // Already-mounted fast path stabilizes and executes initial physical scroll to top:0
      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );
      for (let i = 0; i < 12; i++) {
        if ((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
        if (!(await stepFrame())) break;
      }
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

      // User scrolls down to 400px before the scheduled verification frame fires
      container.scrollTop = 400;
      cancelActiveNavigationSearch();

      // Run the scheduled verification frame
      expect(await stepFrame()).toBe(true);

      // Verification frame must abort and NOT override user position back to 0
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(container.scrollTop).toBe(400);
    });

    it('ordinary Click Prompt navigation without alignToTopEdge does not scroll to physical top:0', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 600;
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(targetPrompt);

      // Normal Click Prompt without alignToTopEdge
      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      for (let i = 0; i < 20; i++) {
        if (!(await stepFrame())) break;
      }

      expect(container.scrollTo).not.toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    it('already-mounted Prompt #1 retains its correct direct-jump behaviour without extra scrolls or delay', async () => {
      const container = document.createElement('div');
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      document.body.appendChild(targetPrompt);
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(targetPrompt);

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);

      for (let i = 0; i < 12; i++) {
        if (!(await stepFrame())) break;
      }

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
      expect(keepFollowing).toHaveBeenCalledWith(1800);
    });

    it('user wheel/touch cancellation prevents late realignment', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      let promptTop = 300;
      targetPrompt.scrollIntoView = vi.fn(() => {
        promptTop = 16;
      });
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      await stepFrame();

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);

      cancelActiveNavigationSearch();

      promptTop = 150;
      await stepFrame();

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('a newer navigation prevents stale alignment work from the previous jump', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const target1 = document.createElement('div');
      let prompt1Top = 200;
      target1.scrollIntoView = vi.fn(() => {
        prompt1Top = 16;
      });
      target1.getBoundingClientRect = () =>
        ({ top: prompt1Top, bottom: prompt1Top + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      const target2 = document.createElement('div');
      target2.scrollIntoView = vi.fn();
      target2.getBoundingClientRect = () =>
        ({ top: 16, bottom: 116, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      // Jump 1 is initially unmounted
      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);

      container.appendChild(target1);
      mocks.findPrompt.mockReturnValue(target1);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      await stepFrame();

      expect(target1.scrollIntoView).toHaveBeenCalledTimes(1);

      // Jump 2 starts while Jump 1 stabilization is pending
      document.body.appendChild(target2);
      mocks.findPrompt.mockReturnValue(target2);
      jumpToMessage({ id: 'prompt-2', text: 'Prompt 2', canMatchByText: true, createTime: 0 }, 1);

      // Flush pending stabilization callbacks from Jump 1 (bounded because the
      // active Jump 2 highlight overlay continues RAF sync until 1200ms elapses)
      for (let i = 0; i < 20; i++) {
        if (!(await stepFrame())) break;
      }

      expect(target1.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('enforces MAX_TOTAL_CHECKS upper bound without false completion', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 500;
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      // Target persistently fails to align even after scrollIntoView calls
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: 80, bottom: 180, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 427,
      });

      jumpToMessage({ id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }, 0);
      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      await stepFrame();

      // Step past the 600ms pass budget / 3 cooldown-paced realignments to exhaust stabilization
      for (let i = 0; i < 45; i++) {
        if (!(await stepFrame())) break;
      }

      // Halts after realignment limit without reporting false success
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).toHaveBeenCalled();
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({ status: 'alignment-unstable' }),
        undefined
      );
    });
  });

  describe('prompt landing offset calculation and application', () => {
    it('computes standard 190px landing offset for normal desktop container', () => {
      const result = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 0,
        containerClientHeightPx: 900,
        scrollPaddingTopPx: 0,
      });

      expect(result).toEqual({
        scrollMarginTopPx: 190,
        expectedContainerOffsetPx: 190,
      });
    });

    it('accounts for non-zero container top without double-counting and respects minimum floor', () => {
      const belowHeader = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 60,
        containerClientHeightPx: 840,
        scrollPaddingTopPx: 0,
      });
      expect(belowHeader).toEqual({
        scrollMarginTopPx: 130,
        expectedContainerOffsetPx: 130,
      });

      const deepContainer = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 200,
        containerClientHeightPx: 600,
        scrollPaddingTopPx: 0,
      });
      expect(deepContainer).toEqual({
        scrollMarginTopPx: 16,
        expectedContainerOffsetPx: 16,
      });
    });

    it('subtracts existing scrollPaddingTop without double-counting or negative margin', () => {
      const partialPadding = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 0,
        containerClientHeightPx: 900,
        scrollPaddingTopPx: 80,
      });
      expect(partialPadding).toEqual({
        scrollMarginTopPx: 110,
        expectedContainerOffsetPx: 190,
      });

      const hostPaddingExceedsTarget = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 0,
        containerClientHeightPx: 900,
        scrollPaddingTopPx: 220,
      });
      expect(hostPaddingExceedsTarget).toEqual({
        scrollMarginTopPx: 0,
        expectedContainerOffsetPx: 220,
      });
    });

    it('clamps to 30% of a 450px scroll container and preserves host scrollPaddingTop when it exceeds the clamp', () => {
      const shortViewport = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 0,
        containerClientHeightPx: 450,
        scrollPaddingTopPx: 0,
      });
      expect(shortViewport).toEqual({
        scrollMarginTopPx: 135,
        expectedContainerOffsetPx: 135,
      });

      // Exception to the 30% clamp: host scrollPaddingTop (180px) exceeds 135px clamp.
      // Preserves host padding rather than applying a negative scrollMarginTop.
      const hostPaddingExceedsClamp = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: 16,
        containerTopPx: 0,
        containerClientHeightPx: 450,
        scrollPaddingTopPx: 180,
      });
      expect(hostPaddingExceedsClamp).toEqual({
        scrollMarginTopPx: 0,
        expectedContainerOffsetPx: 180,
      });
    });

    it('handles invalid, negative, or non-finite geometry and CSS values defensively', () => {
      const invalidGeometry = computePromptLandingOffset({
        desiredViewportTopPx: 190,
        minContainerOffsetPx: Number.NaN,
        containerTopPx: Number.POSITIVE_INFINITY,
        containerClientHeightPx: Number.NaN,
        scrollPaddingTopPx: Number.NaN,
      });
      expect(invalidGeometry).toEqual({
        scrollMarginTopPx: 190,
        expectedContainerOffsetPx: 190,
      });

      const negativeValues = computePromptLandingOffset({
        desiredViewportTopPx: -50,
        minContainerOffsetPx: -10,
        containerTopPx: Number.NaN,
        containerClientHeightPx: -400,
        scrollPaddingTopPx: -20,
      });
      expect(negativeValues).toEqual({
        scrollMarginTopPx: 16,
        expectedContainerOffsetPx: 16,
      });
    });

    it('falls back to legacy minContainerOffsetPx for platforms without promptLandingViewportTopPx', () => {
      const legacy = computePromptLandingOffset({
        desiredViewportTopPx: undefined,
        minContainerOffsetPx: 16,
        containerTopPx: 40,
        containerClientHeightPx: 800,
        scrollPaddingTopPx: 24,
      });
      expect(legacy).toEqual({
        scrollMarginTopPx: 16,
        expectedContainerOffsetPx: 40,
      });
    });

    it('applies computed scrollMarginTop during scrollIntoView and restores previous value, including with scrollPaddingTop: auto', () => {
      mocks.promptLandingViewportTopPx = 190;

      const container = document.createElement('div');
      Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 40, bottom: 940, left: 0, right: 800, width: 800, height: 900 } as DOMRect);
      container.style.scrollPaddingTop = 'auto';
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const target = document.createElement('div');
      target.style.scrollMarginTop = '12px';
      let appliedMarginDuringScroll = '';
      target.scrollIntoView = vi.fn(() => {
        appliedMarginDuringScroll = target.style.scrollMarginTop;
      });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt', canMatchByText: true, createTime: 0 },
        0
      );

      // desiredViewportTopPx (190) - containerTop (40) = 150px, scrollPaddingTop ('auto') -> 0
      expect(appliedMarginDuringScroll).toBe('150px');
      expect(target.style.scrollMarginTop).toBe('12px');
      expect(target.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'start',
      });
    });

    it('stabilizes unmounted target alignment at the computed 190px landing offset', async () => {
      mocks.promptLandingViewportTopPx = 190;

      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      let nextRafId = 1;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => {
          const idx = rafQueue.findIndex((item) => item.id === id);
          if (idx >= 0) rafQueue.splice(idx, 1);
        })
      );

      const stepFrame = async (deltaMs = 16): Promise<boolean> => {
        vi.advanceTimersByTime(deltaMs);
        const batch = rafQueue.splice(0, rafQueue.length);
        if (batch.length === 0) return false;
        for (const item of batch) {
          item.cb(performance.now());
        }
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        return true;
      };

      const container = document.createElement('div');
      let promptTop = 320;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          promptTop -= delta;
        }
      });
      container.scrollTop = 600;
      Object.defineProperty(container, 'scrollHeight', { value: 4000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 900, left: 0, right: 800, width: 800, height: 900 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      targetPrompt.scrollIntoView = vi.fn();
      targetPrompt.getBoundingClientRect = () =>
        ({ top: promptTop, bottom: promptTop + 100, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 5,
        topOffsetPx: 600,
        turnCount: 50,
      });

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        5
      );

      container.appendChild(targetPrompt);
      mocks.findPrompt.mockReturnValue(targetPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Direct container scroll aligned target to 190px without mutating scrollMarginTop
      expect(promptTop).toBe(190);
      expect(targetPrompt.style.scrollMarginTop).toBe('');
      const scrollCallsBeforeShift = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;

      // Simulate post-mount height shift pushing target to 250px
      promptTop = 250;
      expect(await stepFrame()).toBe(true);
      expect((container.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        scrollCallsBeforeShift + 1
      );
      expect(promptTop).toBe(190);

      // Flush stable window (>= 350ms for unmounted virtual-layout jumps) at 190px
      for (let i = 0; i < 26; i++) {
        await stepFrame();
      }
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(5);
    });

    it('handles Prompt #1 TOC navigation at scrollTop=0 boundary and last prompt at maxScrollTop boundary with 190px target', async () => {
      mocks.promptLandingViewportTopPx = 190;

      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      let nextRafId = 1;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => {
          const idx = rafQueue.findIndex((item) => item.id === id);
          if (idx >= 0) rafQueue.splice(idx, 1);
        })
      );
      const stepFrame = async (deltaMs = 16): Promise<boolean> => {
        vi.advanceTimersByTime(deltaMs);
        const batch = rafQueue.splice(0, rafQueue.length);
        if (batch.length === 0) return false;
        for (const item of batch) {
          item.cb(performance.now());
        }
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        return true;
      };

      // Case 1: Prompt #1 clamped at scrollTop = 0 (sits at top: 24px, cannot reach 190px)
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      container.scrollTop = 0;
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 900, left: 0, right: 800, width: 800, height: 900 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const firstPrompt = document.createElement('div');
      firstPrompt.scrollIntoView = vi.fn();
      firstPrompt.getBoundingClientRect = () =>
        ({ top: 24, bottom: 124, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 20,
      });

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );
      container.appendChild(firstPrompt);
      mocks.findPrompt.mockReturnValue(firstPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      for (let i = 0; i < 26; i++) {
        await stepFrame();
      }
      // Only coarse scrollTo(0) ran; direct alignment recognized clamp at scrollTop=0
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);

      // Case 2: Last prompt clamped at maxScrollTop (sits at top: 420px > 190px, cannot scroll further down)
      vi.clearAllMocks();
      mocks.getContainer.mockReturnValue(container);
      container.scrollTop = 2100; // scrollHeight (3000) - clientHeight (900)
      const lastPrompt = document.createElement('div');
      lastPrompt.scrollIntoView = vi.fn();
      lastPrompt.getBoundingClientRect = () =>
        ({ top: 420, bottom: 520, left: 0, right: 800, width: 800, height: 100 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 19,
        topOffsetPx: 2100,
        turnCount: 20,
      });

      jumpToMessage(
        { id: 'prompt-20', text: 'Prompt 20', canMatchByText: true, createTime: 0 },
        19
      );
      container.appendChild(lastPrompt);
      mocks.findPrompt.mockReturnValue(lastPrompt);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      for (let i = 0; i < 26; i++) {
        await stepFrame();
      }
      // Only coarse scrollTo(2100) ran; direct alignment recognized clamp at maxScrollTop
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(19);
    });

    it('preserves alignToTopEdge final scroll to top:0 for Jump to First Prompt even with 190px landing target', () => {
      mocks.promptLandingViewportTopPx = 190;

      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 500;
      Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 900, left: 0, right: 800, width: 800, height: 900 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const firstPrompt = document.createElement('div');
      firstPrompt.scrollIntoView = vi.fn();
      firstPrompt.getBoundingClientRect = () =>
        ({ top: 190, bottom: 290, left: 0, right: 800, width: 800, height: 100 } as DOMRect);
      container.appendChild(firstPrompt);
      mocks.findPrompt.mockReturnValue(firstPrompt);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0,
        { mode: 'viewport-driven', alignToTopEdge: true }
      );

      vi.advanceTimersByTime(250);
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(container.scrollTop).toBe(0);
    });
  });

  describe('independent prompt highlight overlay', () => {
    const OVERLAY_SELECTOR = '[data-luna-toc-highlight-overlay="true"]';

    function mockRect(
      element: HTMLElement,
      rect: { top: number; left: number; width: number; height: number }
    ): void {
      element.getBoundingClientRect = () =>
        ({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          x: rect.left,
          y: rect.top,
          toJSON: () => {},
        } as DOMRect);
    }

    function createRectContainer(
      rect = { top: 0, left: 0, width: 1000, height: 700 }
    ): HTMLDivElement {
      const container = document.createElement('div');
      mockRect(container, rect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);
      return container;
    }

    it('creates a fixed, pointer-transparent overlay matching target geometry without mutating target element', () => {
      const container = createRectContainer();
      const target = document.createElement('div');
      target.className = 'chatgpt-user-turn';
      target.style.outline = '1px dashed red';
      target.style.borderRadius = '12px';
      target.scrollIntoView = vi.fn();
      mockRect(target, { top: 190, left: 120, width: 640, height: 84 });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      const overlays = document.querySelectorAll<HTMLDivElement>(OVERLAY_SELECTOR);
      expect(overlays).toHaveLength(1);

      const overlay = overlays[0];
      expect(overlay.parentElement).toBe(document.body);
      expect(overlay.style.position).toBe('fixed');
      expect(overlay.style.pointerEvents).toBe('none');
      expect(overlay.style.boxSizing).toBe('border-box');
      expect(overlay.style.background).toBe('transparent');
      expect(overlay.style.border).toMatch(
        /^2px solid (#60a5fa|rgb\(96, 165, 250\))$/
      );
      expect(overlay.style.borderRadius).toBe('8px');
      expect(overlay.style.zIndex).toBe(
        String(APP_CONFIG.ui.stacking.baseZIndex - 1)
      );
      expect(overlay.style.display).toBe('block');
      expect(overlay.style.top).toBe('190px');
      expect(overlay.style.left).toBe('120px');
      expect(overlay.style.width).toBe('640px');
      expect(overlay.style.height).toBe('84px');
      expect(overlay.style.clipPath).toBe('');

      // Target element must remain completely untouched
      expect(target.className).toBe('chatgpt-user-turn');
      expect(target.style.outline).toBe('1px dashed red');
      expect(target.style.outlineOffset).toBe('');
      expect(target.style.borderRadius).toBe('12px');
      expect(target.style.position).toBe('');
    });

    it('removes overlay and cleans up listeners and animation frame after 2500ms', () => {
      const rafCallbacks = new Map<number, FrameRequestCallback>();
      let nextRafId = 1;
      const cancelRaf = vi.fn((id: number) => {
        rafCallbacks.delete(id);
      });
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafCallbacks.set(id, cb);
          return id;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', cancelRaf);

      const container = createRectContainer();
      const addScrollSpy = vi.spyOn(container, 'addEventListener');
      const removeScrollSpy = vi.spyOn(container, 'removeEventListener');
      const addResizeSpy = vi.spyOn(window, 'addEventListener');
      const removeResizeSpy = vi.spyOn(window, 'removeEventListener');

      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      mockRect(target, { top: 200, left: 100, width: 500, height: 60 });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);
      expect(addScrollSpy).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function),
        { passive: true }
      );
      expect(addResizeSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function),
        { passive: true }
      );

      vi.advanceTimersByTime(2499);
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
      expect(cancelRaf).toHaveBeenCalled();
      expect(removeScrollSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(removeResizeSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      // Idempotent repeat cleanup
      expect(() => clearPromptHighlightOverlay()).not.toThrow();
    });

    it('restarts 2500ms duration on repeated clicks to the same target with only one overlay', () => {
      const container = createRectContainer();
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      mockRect(target, { top: 190, left: 100, width: 500, height: 60 });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      vi.advanceTimersByTime(1200);
      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

      // At t = 2400ms (first timer would have expired at 2500ms), overlay must still be present
      vi.advanceTimersByTime(1300);
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

      // At t = 3700ms (2500ms after second click), overlay is removed
      vi.advanceTimersByTime(1200);
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
    });

    it('immediately replaces previous overlay when switching to a different target', () => {
      const container = createRectContainer();
      const targetA = document.createElement('div');
      const targetB = document.createElement('div');
      targetA.scrollIntoView = vi.fn();
      targetB.scrollIntoView = vi.fn();
      mockRect(targetA, { top: 190, left: 50, width: 400, height: 50 });
      mockRect(targetB, { top: 340, left: 80, width: 520, height: 90 });
      container.append(targetA, targetB);

      mocks.findPrompt.mockReturnValue(targetA);
      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );
      expect(document.querySelector<HTMLDivElement>(OVERLAY_SELECTOR)?.style.top).toBe('190px');

      mocks.findPrompt.mockReturnValue(targetB);
      jumpToMessage(
        { id: 'prompt-2', text: 'Prompt 2', canMatchByText: true, createTime: 0 },
        1
      );

      const overlays = document.querySelectorAll<HTMLDivElement>(OVERLAY_SELECTOR);
      expect(overlays).toHaveLength(1);
      expect(overlays[0].style.top).toBe('340px');
      expect(overlays[0].style.left).toBe('80px');
      expect(overlays[0].style.width).toBe('520px');
      expect(overlays[0].style.height).toBe('90px');
    });

    it('synchronizes overlay geometry on scroll, resize, and RAF layout updates', () => {
      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      let nextRafId = 1;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => {
          const idx = rafQueue.findIndex((entry) => entry.id === id);
          if (idx >= 0) rafQueue.splice(idx, 1);
        })
      );

      const container = createRectContainer();
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      let currentRect = { top: 190, left: 100, width: 500, height: 70 };
      target.getBoundingClientRect = () =>
        ({
          ...currentRect,
          right: currentRect.left + currentRect.width,
          bottom: currentRect.top + currentRect.height,
          x: currentRect.left,
          y: currentRect.top,
          toJSON: () => {},
        } as DOMRect);
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      const overlay = document.querySelector<HTMLDivElement>(OVERLAY_SELECTOR)!;
      expect(overlay.style.top).toBe('190px');

      // 1. Scroll update
      currentRect = { top: 260, left: 100, width: 500, height: 70 };
      container.dispatchEvent(new Event('scroll'));
      expect(overlay.style.top).toBe('260px');

      // 2. Window resize update
      currentRect = { top: 260, left: 60, width: 420, height: 70 };
      window.dispatchEvent(new Event('resize'));
      expect(overlay.style.left).toBe('60px');
      expect(overlay.style.width).toBe('420px');

      // 3. RAF-driven async layout shift (no scroll or resize event)
      currentRect = { top: 295, left: 60, width: 420, height: 85 };
      const frame = rafQueue.shift();
      expect(frame).toBeDefined();
      frame!.cb(16);
      expect(overlay.style.top).toBe('295px');
      expect(overlay.style.height).toBe('85px');
    });

    it('tears down immediately when the highlighted target disconnects', () => {
      const container = createRectContainer();
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      mockRect(target, { top: 190, left: 100, width: 500, height: 70 });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

      target.remove();
      container.dispatchEvent(new Event('scroll'));
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
    });

    it('clips partially visible targets and hides targets completely outside scroll container bounds', () => {
      const container = createRectContainer({
        top: 100,
        left: 50,
        width: 700,
        height: 500,
      });
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      let currentRect = { top: 70, left: 100, width: 500, height: 80 };
      target.getBoundingClientRect = () =>
        ({
          ...currentRect,
          right: currentRect.left + currentRect.width,
          bottom: currentRect.top + currentRect.height,
          x: currentRect.left,
          y: currentRect.top,
          toJSON: () => {},
        } as DOMRect);
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      const overlay = document.querySelector<HTMLDivElement>(OVERLAY_SELECTOR)!;
      // Top protrudes 30px above container top (100 - 70 = 30px)
      expect(overlay.style.display).toBe('block');
      expect(overlay.style.clipPath).toBe('inset(30px 0px 0px 0px)');

      // Completely scrolled above container (bottom = 90 <= container top 100)
      currentRect = { top: 10, left: 100, width: 500, height: 80 };
      container.dispatchEvent(new Event('scroll'));
      expect(overlay.style.display).toBe('none');

      // Back fully inside container
      currentRect = { top: 200, left: 100, width: 500, height: 80 };
      container.dispatchEvent(new Event('scroll'));
      expect(overlay.style.display).toBe('block');
      expect(overlay.style.clipPath).toBe('');
    });

    it('ignores stale RAF callbacks from a superseded highlight session', () => {
      const scheduledCallbacks: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          scheduledCallbacks.push(cb);
          return scheduledCallbacks.length;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const container = createRectContainer();
      const targetA = document.createElement('div');
      const targetB = document.createElement('div');
      targetA.scrollIntoView = vi.fn();
      targetB.scrollIntoView = vi.fn();
      mockRect(targetA, { top: 190, left: 50, width: 400, height: 60 });
      mockRect(targetB, { top: 320, left: 80, width: 500, height: 80 });
      container.append(targetA, targetB);

      // Start session A
      mocks.findPrompt.mockReturnValue(targetA);
      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );
      const staleSessionARaf = scheduledCallbacks[0];

      // Disconnect targetA and supersede with session B
      targetA.remove();
      mocks.findPrompt.mockReturnValue(targetB);
      jumpToMessage(
        { id: 'prompt-2', text: 'Prompt 2', canMatchByText: true, createTime: 0 },
        1
      );

      // Manually fire stale RAF callback from session A
      staleSessionARaf(16);

      // Session B overlay must remain intact and unaffected
      const overlays = document.querySelectorAll<HTMLDivElement>(OVERLAY_SELECTOR);
      expect(overlays).toHaveLength(1);
      expect(overlays[0].style.top).toBe('320px');
    });

    it('keeps RAF geometry synchronization active beyond 90 frames (high-refresh-rate) until 1200ms expires', () => {
      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      let nextRafId = 1;
      const cancelRaf = vi.fn((id: number) => {
        const idx = rafQueue.findIndex((entry) => entry.id === id);
        if (idx >= 0) rafQueue.splice(idx, 1);
      });
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', cancelRaf);

      const container = createRectContainer();
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      let top = 190;
      target.getBoundingClientRect = () =>
        ({
          top,
          left: 100,
          width: 500,
          height: 70,
          right: 600,
          bottom: top + 70,
          x: 100,
          y: top,
          toJSON: () => {},
        } as DOMRect);
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 },
        0
      );

      const overlay = document.querySelector<HTMLDivElement>(OVERLAY_SELECTOR)!;
      expect(overlay.style.top).toBe('190px');

      // Simulate 150 frames (~1040ms at 144Hz, well past the old 90-frame cap)
      for (let frame = 1; frame <= 150; frame++) {
        const batch = rafQueue.splice(0, rafQueue.length);
        expect(batch.length).toBeGreaterThan(0);
        for (const entry of batch) {
          entry.cb(frame * 7);
        }
      }

      // Move target after 150 frames while still inside the 1200ms window
      top = 275;
      const post150Batch = rafQueue.splice(0, rafQueue.length);
      expect(post150Batch.length).toBeGreaterThan(0);
      for (const entry of post150Batch) {
        entry.cb(151 * 7);
      }
      expect(overlay.style.top).toBe('275px');

      // Once 2500ms elapses, session tears down and cancels the pending RAF
      vi.advanceTimersByTime(2500);
      expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
      expect(cancelRaf).toHaveBeenCalled();
      expect(rafQueue).toHaveLength(0);
    });
  });

  describe('disconnect recovery, wall-clock stabilization, and bounded guards', () => {
    function createFrameDriver() {
      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      const cancelledRafs = new Set<number>();
      let nextRafId = 1;

      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => {
          cancelledRafs.add(id);
        })
      );

      const stepFrame = async (deltaMs = 16): Promise<boolean> => {
        vi.advanceTimersByTime(deltaMs);
        const batch = rafQueue.splice(0, rafQueue.length);
        let executed = false;
        for (const item of batch) {
          if (!cancelledRafs.has(item.id)) {
            item.cb(performance.now());
            executed = true;
          }
        }
        if (executed) {
          for (let i = 0; i < 5; i++) {
            await Promise.resolve();
          }
          return true;
        }
        return false;
      };

      return { stepFrame, rafQueue };
    }

    function createScrollContainer(height = 900, scrollHeight = 8000): HTMLDivElement {
      const container = document.createElement('div');
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.scrollTop = 6000;
      Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: height, left: 0, right: 800, width: 800, height } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);
      return container;
    }

    it('recovers when target lands, then external scroll-back disconnects it during stabilization', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer();

      const firstNode = document.createElement('div');
      let firstTop = 190;
      firstNode.scrollIntoView = vi.fn(() => {
        firstTop = 190;
      });
      firstNode.getBoundingClientRect = () =>
        ({ top: firstTop, bottom: firstTop + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      const recoveredNode = document.createElement('div');
      let recoveredTop = 340;
      recoveredNode.scrollIntoView = vi.fn(() => {
        recoveredTop = 190;
      });
      recoveredNode.getBoundingClientRect = () =>
        ({ top: recoveredTop, bottom: recoveredTop + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget
        .mockReturnValueOnce({
          status: 'ok',
          targetIndex: 4,
          topOffsetPx: 1200,
          turnCount: 100,
        })
        .mockReturnValueOnce({
          status: 'ok',
          targetIndex: 4,
          topOffsetPx: 1350, // refreshed virtual-layout offset after remeasurement
          turnCount: 100,
        });

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Initial mount and landing
      container.appendChild(firstNode);
      mocks.findPrompt.mockReturnValue(firstNode);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(container.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });

      // Simulate external snap back to bottom: container jumps and unmounts target
      container.scrollTop = 7100;
      firstNode.remove();
      mocks.findPrompt.mockReturnValue(null);

      // Advance past DISCONNECT_GRACE_MS (50ms) and DISCONNECT_GRACE_FRAMES (2)
      for (let i = 0; i < 5; i++) {
        await stepFrame(16);
      }

      // Recovery re-queried virtual layout with refreshed offset 1350
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(2);
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 1350, behavior: 'auto' });

      // Target remounts after recovery scroll; simulate container.scrollTo shifting recoveredTop
      const origScrollTo = container.scrollTo;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          recoveredTop -= delta;
        }
      });
      container.appendChild(recoveredNode);
      mocks.findPrompt.mockReturnValue(recoveredNode);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(origScrollTo).toHaveBeenCalled();
      expect(recoveredTop).toBe(190);

      // Stabilize for >= 350ms (far virtual jump layout-quiescence window)
      for (let i = 0; i < 26; i++) {
        await stepFrame(16);
      }

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('exhausts cleanly after at most 2 disconnect recovery attempts', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer();

      const makePrompt = () => {
        const el = document.createElement('div');
        el.scrollIntoView = vi.fn();
        el.getBoundingClientRect = () =>
          ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
        return el;
      };

      const node0 = makePrompt();
      const node1 = makePrompt();
      const node2 = makePrompt();

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 4,
        topOffsetPx: 1200,
        turnCount: 100,
      });

      const walkerSpy = vi
        .spyOn(viewportWalker, 'loadUntilMountedViaViewport')
        .mockImplementation(async () => {
          container.appendChild(node2);
          mocks.findPrompt.mockReturnValue(node2);
          return node2;
        });

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Initial mount -> disconnect
      container.appendChild(node0);
      mocks.findPrompt.mockReturnValue(node0);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      node0.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 5; i++) await stepFrame(16);
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(2); // initial + recovery 1
      expect(walkerSpy).not.toHaveBeenCalled();

      // Recovery 1 mounts -> disconnects again; Recovery 2 escalates to viewport-walker
      container.appendChild(node1);
      mocks.findPrompt.mockReturnValue(node1);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      node1.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 5; i++) await stepFrame(16);
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(2);
      expect(walkerSpy).toHaveBeenCalledTimes(1);

      // Recovery 2 mounts -> disconnects a 3rd time (recovery budget exhausted)
      for (let i = 0; i < 5; i++) await Promise.resolve();
      node2.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 8; i++) await stepFrame(16);

      // No 3rd recovery attempted; fails cleanly with target-disconnected
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(2);
      expect(walkerSpy).toHaveBeenCalledTimes(1);
      walkerSpy.mockRestore();
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).toHaveBeenCalledOnce();
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({ status: 'target-disconnected' }),
        undefined
      );
    });

    it('paces realignment with 50ms cooldown when target stays mounted but displaced', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer();
      const scrollToSpy = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          top -= delta;
        }
      });
      container.scrollTo = scrollToSpy;

      const target = document.createElement('div');
      let top = 280;
      target.scrollIntoView = vi.fn(() => {
        top = 190;
      });
      target.getBoundingClientRect = () =>
        ({ top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 4,
        topOffsetPx: 1200,
        turnCount: 100,
      });

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      const callsAfterInitialAlign = scrollToSpy.mock.calls.length;
      expect(top).toBe(190);

      // Displace target at 144Hz (7ms/frame): should realign once, then respect 50ms cooldown
      top = 350;
      await stepFrame(7);
      expect(scrollToSpy).toHaveBeenCalledTimes(callsAfterInitialAlign + 1);

      // Immediately displaced again within 50ms cooldown -> does NOT spam scrollTo
      top = 360;
      await stepFrame(7);
      await stepFrame(7);
      await stepFrame(7);
      expect(scrollToSpy).toHaveBeenCalledTimes(callsAfterInitialAlign + 1);

      // Once 50ms cooldown elapses, realigns again and then settles
      await stepFrame(35);
      expect(scrollToSpy).toHaveBeenCalledTimes(callsAfterInitialAlign + 2);
      expect(top).toBe(190);

      for (let i = 0; i < 55; i++) {
        await stepFrame(7);
      }
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
    });

    it.each([
      { label: '60Hz', deltaMs: 16 },
      { label: '120Hz', deltaMs: 8 },
      { label: '144Hz', deltaMs: 7 },
    ])('stabilizes consistently by wall-clock time at $label without fixed frame-cap premature failure', async ({ deltaMs }) => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer();

      const target = document.createElement('div');
      const top = 190;
      target.scrollIntoView = vi.fn();
      target.getBoundingClientRect = () =>
        ({ top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 4,
        topOffsetPx: 1200,
        turnCount: 100,
      });

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // After 3 frames (< 120ms), must NOT have completed prematurely
      await stepFrame(deltaMs);
      await stepFrame(deltaMs);
      await stepFrame(deltaMs);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      // Advance remaining frames to pass 350ms far-jump stability window (more than 8 frames on 120Hz/144Hz!)
      const remainingFrames = Math.ceil(350 / deltaMs) + 2;
      for (let i = 0; i < remainingFrames; i++) {
        await stepFrame(deltaMs);
      }

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('aborts in-flight disconnect recovery cleanly on cancellation or rapid consecutive TOC click', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer();

      const nodeA = document.createElement('div');
      nodeA.scrollIntoView = vi.fn();
      nodeA.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      const nodeB = document.createElement('div');
      nodeB.scrollIntoView = vi.fn();
      nodeB.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 4,
        topOffsetPx: 1200,
        turnCount: 100,
      });

      // Jump A starts and mounts, then disconnects to enter recovery
      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );
      container.appendChild(nodeA);
      mocks.findPrompt.mockReturnValue(nodeA);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      nodeA.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 5; i++) await stepFrame(16);

      // Recovery for Jump A is now waiting for mount; user rapidly clicks mounted Jump B
      container.appendChild(nodeB);
      mocks.findPrompt.mockReturnValue(nodeB);
      jumpToMessage(
        { id: 'prompt-6', text: 'Prompt 6', canMatchByText: true, createTime: 0 },
        5
      );

      // Advance through Jump B stabilization and past stale Jump A recovery timeout
      for (let i = 0; i < 12; i++) await stepFrame(16);
      vi.advanceTimersByTime(1500);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(5);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('does not classify target completely below visible container as bounded at maxScrollTop', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer(800, 3000);
      container.scrollTop = 2200; // maxScrollTop = 3000 - 800

      // Target sits at top: 950px (completely below 800px container bottom!)
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      target.getBoundingClientRect = () =>
        ({ top: 950, bottom: 1030, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 19,
        topOffsetPx: 2200,
        turnCount: 20,
      });

      jumpToMessage(
        { id: 'prompt-20', text: 'Prompt 20', canMatchByText: true, createTime: 0 },
        19
      );
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // Must NOT falsely settle as 'bounded'; tries realignment and fails when persistently offscreen
      for (let i = 0; i < 45; i++) {
        await stepFrame(16);
      }

      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).toHaveBeenCalledOnce();
    });

    it('emits structured console.warn("[LUNA JUMP FAILED]", ...) on failure only when chatTocDebugJump is enabled', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createFrameDriver();
      const container = createScrollContainer(800, 3000);
      container.scrollTop = 2200;

      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      target.getBoundingClientRect = () =>
        ({ top: 950, bottom: 1030, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 4,
        topOffsetPx: 1200,
        turnCount: 20,
      });

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        // Disabled by default -> no console.debug or console.warn
        localStorage.removeItem('chatTocDebugJump');
        jumpToMessage(
          { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
          4
        );
        container.appendChild(target);
        mocks.findPrompt.mockReturnValue(target);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        for (let i = 0; i < 45; i++) await stepFrame(16);
        expect(debugSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        // Enabled -> emits readable JSON console.debug without console.warn
        localStorage.setItem('chatTocDebugJump', '1');
        mocks.findPrompt.mockReturnValue(null);
        jumpToMessage(
          { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
          4
        );
        mocks.findPrompt.mockReturnValue(target);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        for (let i = 0; i < 45; i++) await stepFrame(16);

        expect(warnSpy).not.toHaveBeenCalled();
        expect(debugSpy).toHaveBeenCalledWith(
          expect.stringContaining('[LUNA JUMP FAILED] {"targetIndex":4'),
          expect.objectContaining({
            targetIndex: 4,
            targetMessageId: 'prompt-5',
            reason: 'alignment-unstable',
            strategy: 'virtual-layout',
            recoveryAttempts: 0,
            scrollPosition: expect.objectContaining({
              scrollTop: 2200,
              scrollHeight: 3000,
              clientHeight: 800,
              maxScrollTop: 2200,
            }),
          })
        );
      } finally {
        localStorage.removeItem('chatTocDebugJump');
        debugSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });

  describe('Stage 1 shared fast-path stabilization and displacement classification', () => {
    function createDynamicContainer(clientHeight = 963, initialScrollHeight = 13318, initialScrollTop = 12355) {
      const container = document.createElement('div');
      let scrollHeight = initialScrollHeight;
      Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
      Object.defineProperty(container, 'scrollHeight', {
        get: () => scrollHeight,
        set: (v: number) => {
          scrollHeight = v;
        },
        configurable: true,
      });
      container.scrollTop = initialScrollTop;
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: clientHeight, left: 0, right: 1679, width: 1679, height: clientHeight } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);
      return {
        container,
        setScrollHeight: (h: number) => {
          scrollHeight = h;
        },
      };
    }

    function createStepDriver() {
      let nowMs = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
      let nextId = 1;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          const id = nextId++;
          rafQueue.push({ id, cb });
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => {
          const idx = rafQueue.findIndex((e) => e.id === id);
          if (idx >= 0) rafQueue.splice(idx, 1);
        })
      );
      return {
        stepFrame: async (deltaMs = 16) => {
          nowMs += deltaMs;
          const batch = rafQueue.splice(0, rafQueue.length);
          for (const entry of batch) {
            entry.cb(nowMs);
          }
          await Promise.resolve();
        },
      };
    }

    it('re-aligns Mounted Fast Path target after virtual-list scrollHeight shrinkage (-1427px) and emits one jumpId without attempts: 8', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(963, 13318, 12355);

      // Model target document Y: initially at 12355 - 9721.5 = 2633.5
      let targetDocTop = 2633.5;
      const target = document.createElement('div');
      target.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 610, left: 0, right: 800, width: 800, height: 610 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Initial scroll brings scrollTop to 2443.5 (landing at 190px)
      expect(container.scrollTop).toBeCloseTo(2443.5, 1);
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      // Simulate Click 1 baseline: scrollHeight shrinks by 1427px while scrollTop stays at 2443.5
      setScrollHeight(11891);
      targetDocTop -= 1427;
      expect(target.getBoundingClientRect().top).toBeCloseTo(-1237, 0);

      // Step stabilization frames through layout-quiescent window (350ms): LunaTOC detects layout-shift and re-aligns to 190px
      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
      }

      expect(target.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

      // Single jumpId across JUMP_START, JUMP_FAST_PATH_RESULT, JUMP_FINISHED; no attempts: 8
      const jumpEvents = mocks.logEvent.mock.calls.filter(
        ([, eventName]) =>
          eventName === 'JUMP_START' ||
          eventName === 'JUMP_FAST_PATH_RESULT' ||
          eventName === 'JUMP_FINISHED'
      );
      expect(jumpEvents.length).toBeGreaterThanOrEqual(3);
      const jumpIds = new Set(jumpEvents.map(([id]) => id));
      expect(jumpIds.size).toBe(1);

      const finishedCall = jumpEvents.find(([, eventName]) => eventName === 'JUMP_FINISHED')!;
      expect(finishedCall[2]).toEqual(
        expect.objectContaining({
          status: 'found',
          strategy: 'fast-path',
          realignAttempts: 1,
          recoveryAttempts: 0,
          alignmentErrorPx: 0,
        })
      );
      expect(finishedCall[2]).not.toHaveProperty('attempts');
    });

    it('avoids unnecessary scrolling when already aligned but still verifies post-navigation stability', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 5000, 1000);

      let targetTop = 190;
      const target = document.createElement('div');
      target.getBoundingClientRect = () =>
        ({ top: targetTop, bottom: targetTop + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          targetTop -= delta;
        }
      });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // No unnecessary initial scroll, and NOT immediately marked complete before stability window
      expect(container.scrollTo).not.toHaveBeenCalled();
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      for (let i = 0; i < 12; i++) {
        await stepFrame(16);
      }

      expect(container.scrollTo).not.toHaveBeenCalled();
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
    });

    it('re-resolves disconnected target by stable message ID on fast path without reusing stale node', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 5000, 1000);

      const staleNode = document.createElement('div');
      staleNode.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.appendChild(staleNode);

      let replacementTop = 340;
      const freshNode = document.createElement('div');
      freshNode.getBoundingClientRect = () =>
        ({ top: replacementTop, bottom: replacementTop + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect);

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const delta = opts.top - container.scrollTop;
          container.scrollTop = opts.top;
          replacementTop -= delta;
        }
      });

      mocks.findPrompt.mockReturnValue(staleNode);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Stale node disconnects and ChatGPT remounts a new DOM node for the same message ID
      staleNode.remove();
      container.appendChild(freshNode);
      mocks.findPrompt.mockReturnValue(freshNode);

      for (let i = 0; i < 15; i++) {
        await stepFrame(16);
      }

      expect(replacementTop).toBe(190);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
    });

    it('classifies unexpected external scrollTop jump without user input as external-scroll-suspected instead of false-positive found', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 15377, 2444);

      let targetDocTop = 1206; // 1206 - 1016 = 190
      const target = document.createElement('div');
      target.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 610, left: 0, right: 800, width: 800, height: 610 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Initially landed at 190px (scrollTop = 1016)
      expect(container.scrollTop).toBe(1016);
      await stepFrame(16);

      // External scroll moves container back to bottom without any user input event
      container.scrollTop = 14414;
      await stepFrame(16);

      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).toHaveBeenCalledTimes(1);
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({
          status: 'external-scroll-suspected',
          displacementKind: 'external-scroll-suspected',
        }),
        undefined
      );
    });

    it('aborts stabilization cleanly when user scrolls via wheel during stabilization', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 5000, 1000);

      const target = document.createElement('div');
      target.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.scrollTo = vi.fn();
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      await stepFrame(16);
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
      await stepFrame(16);

      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
      expect(mocks.clearJumpProgress).toHaveBeenCalled();
      expect(mocks.logEvent).toHaveBeenCalledWith(
        'jump-id-stub',
        'JUMP_FINISHED',
        expect.objectContaining({
          status: 'cancelled-by-user',
          displacementKind: 'user-scroll',
        }),
        undefined
      );
    });

    it('invokes holdViewport() once before the first scroll write on both Fast Path and Virtual Layout, and fails safely when unavailable', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 5000, 3000);

      const callOrder: string[] = [];
      mocks.holdViewport.mockImplementation(() => {
        callOrder.push('holdViewport');
        return { status: 'ok' };
      });
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        callOrder.push('scrollTo');
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });

      const target = document.createElement('div');
      target.getBoundingClientRect = () => {
        const top = 1190 - container.scrollTop;
        return { top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect;
      };
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );
      expect(callOrder[0]).toBe('holdViewport');
      expect(callOrder[1]).toBe('scrollTo');

      // Unavailable controller degrades safely without throwing
      mocks.holdViewport.mockReturnValue({
        status: 'unavailable',
        reason: 'controller-unavailable',
      } as any);
      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );
      for (let i = 0; i < 12; i++) await stepFrame(16);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
    });

    it('does not prematurely report found at 150ms when late +8221px scrollHeight expansion unmounts target at ~300ms, and recovers to 190px', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(963, 13318, 12355);

      let targetDocTop = 2633.5;
      const initialTarget = document.createElement('div');
      initialTarget.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 610, left: 0, right: 800, width: 800, height: 610 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.appendChild(initialTarget);
      mocks.findPrompt.mockReturnValue(initialTarget);

      // Click Item 5 from bottom (far jump > clientHeight)
      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // t ~ 50ms: first layout shrink (-1427px) -> Stage 1 realigns to 190px
      setScrollHeight(11891);
      targetDocTop -= 1427;
      for (let i = 0; i < 8; i++) await stepFrame(16); // ~128ms
      expect(initialTarget.getBoundingClientRect().top).toBeCloseTo(190, 1);

      // At ~150ms, must NOT have prematurely reported JUMP_FINISHED: found
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();

      // t ~ 250-300ms: late +8221px virtual-list expansion pushes target out and unmounts it
      setScrollHeight(20444);
      container.scrollTop = 6069;
      initialTarget.remove();
      mocks.findPrompt.mockReturnValue(null);

      // Virtual layout bridge returns updated offset for remount recovery
      const recoveredTarget = document.createElement('div');
      let recoveredDocTop = 9750;
      recoveredTarget.getBoundingClientRect = () => {
        const top = recoveredDocTop - container.scrollTop;
        return { top, bottom: top + 610, left: 0, right: 800, width: 800, height: 610 } as DOMRect;
      };
      mocks.queryVirtualJumpTarget.mockImplementation(() => {
        // Simulate ChatGPT mounting target once virtual-layout scrolls to it
        setTimeout(() => {
          container.appendChild(recoveredTarget);
          mocks.findPrompt.mockReturnValue(recoveredTarget);
        }, 0);
        return {
          status: 'ok',
          targetIndex: 4,
          topOffsetPx: 9560,
          turnCount: 7,
        };
      });

      // Advance through disconnect grace -> recovery -> remount -> layout-quiescent settle
      for (let i = 0; i < 45; i++) {
        await stepFrame(16);
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(recoveredTarget.isConnected).toBe(true);
      expect(recoveredTarget.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('realigns after scrollHeight shrinkage clamps scrollTop near bottom instead of misclassifying as external-scroll-suspected', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(963, 22903, 18479.5);

      // Reproduces Scenario 5 (Item 4 -> Item 6): target at 190px (docY = 20856),
      // then scrollHeight shrinks 22903 -> 19628 clamping scrollTop down to 18665 (distFromBottom = 0)
      // while target shifts to top = 5px (-185px error).
      let targetDocTop = 20856;
      const target = document.createElement('div');
      target.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 82, left: 0, right: 800, width: 800, height: 82 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-6', text: 'Prompt 6', canMatchByText: true, createTime: 0 },
        5
      );
      expect(container.scrollTop).toBeCloseTo(20666, 0);
      expect(target.getBoundingClientRect().top).toBeCloseTo(190, 1);

      await stepFrame(16);

      // Layout shrinks: maxScrollTop drops to 18665, clamping scrollTop down (<= lastAppliedScrollTop)
      setScrollHeight(19628);
      container.scrollTop = 18665;
      targetDocTop = 18670; // target now at top = 5px (-185px error)

      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
      }

      // Should classify as layout-shift and realign to 190px (scrollTop = 18480), NOT external-scroll-suspected
      expect(target.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(5);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('refreshes the blue highlight overlay on final settled alignment for 2500ms even if overlay was torn down mid-stabilization', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(963, 5000, 1000);

      const target = document.createElement('div');
      target.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.scrollTo = vi.fn();
      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);

      jumpToMessage(
        { id: 'prompt-5', text: 'Prompt 5', canMatchByText: true, createTime: 0 },
        4
      );

      // Simulate overlay being cleared mid-stabilization (e.g. transient disconnect/offscreen)
      await stepFrame(16);
      clearPromptHighlightOverlay();
      expect(document.querySelector('[data-luna-toc-highlight-overlay="true"]')).toBeNull();

      // Finish stabilization -> overlay is refreshed on the final connected target
      for (let i = 0; i < 12; i++) {
        await stepFrame(16);
      }
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(4);
      expect(document.querySelectorAll('[data-luna-toc-highlight-overlay="true"]')).toHaveLength(1);

      // Remains visible for nearly the full 2500ms AFTER settled, then cleans up
      vi.advanceTimersByTime(2499);
      expect(document.querySelectorAll('[data-luna-toc-highlight-overlay="true"]')).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(document.querySelectorAll('[data-luna-toc-highlight-overlay="true"]')).toHaveLength(0);
    });

    it('never uses text fallback to jump to a different message when multiple prompts share identical text ("next")', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(907, 15000, 1000);

      const duplicatePrompts = [
        { id: 'id-13', text: 'next', canMatchByText: true, createTime: 1 },
        { id: 'id-14', text: 'next', canMatchByText: true, createTime: 2 },
        { id: 'id-15', text: 'next', canMatchByText: true, createTime: 3 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({
          conversationKey: 'dup-conv',
          prompts: duplicatePrompts,
        }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      // Only #13 is currently mounted in the DOM at top=190px
      const mounted13 = document.createElement('div');
      mounted13.setAttribute('data-chatgpt-search-message-ids', 'id-13');
      mounted13.textContent = 'next';
      mounted13.getBoundingClientRect = () =>
        ({ top: 190, bottom: 230, left: 0, right: 800, width: 800, height: 40 } as DOMRect);
      container.appendChild(mounted13);

      // Target #14 is NOT mounted yet; text fallback would have returned mounted13!
      const target14 = document.createElement('div');
      target14.setAttribute('data-chatgpt-search-message-ids', 'id-14');
      target14.textContent = 'next';
      let target14DocTop = 5190;
      target14.getBoundingClientRect = () => {
        const top = target14DocTop - container.scrollTop;
        return { top, bottom: top + 40, left: 0, right: 800, width: 800, height: 40 } as DOMRect;
      };

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top >= 4500 && !target14.isConnected) {
            container.appendChild(target14);
          }
        }
      });

      mocks.findPrompt.mockImplementation((id: string) => {
        if (id === 'id-13' && mounted13.isConnected) return mounted13;
        if (id === 'id-14' && target14.isConnected) return target14;
        return null;
      });
      mocks.findPromptByText.mockReturnValue(mounted13);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 1,
        topOffsetPx: 5000,
        turnCount: 3,
      });

      // Click #14 ("next"): must NOT fast-path to #13; must use Virtual Layout for id-14!
      jumpToMessage(duplicatePrompts[1], 1);

      expect(mocks.findPromptByText).not.toHaveBeenCalled();
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledWith(container, 'id-14');

      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(target14.isConnected).toBe(true);
      expect(target14.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
    });

    it('rejects text fallback candidate if its DOM message ID conflicts with expected message ID', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { container } = createDynamicContainer(907, 5000, 1000);
      const uniquePrompt = { id: 'expected-id', text: 'Unique prompt text', canMatchByText: true, createTime: 1 };
      initializePromptNavigation({
        getVirtualSearchContext: () => ({
          conversationKey: 'unique-conv',
          prompts: [uniquePrompt],
        }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const wrongNode = document.createElement('div');
      wrongNode.setAttribute('data-chatgpt-search-message-ids', 'different-id');
      container.appendChild(wrongNode);

      mocks.findPrompt.mockReturnValue(null);
      mocks.findPromptByText.mockReturnValue(wrongNode);
      mocks.queryVirtualJumpTarget.mockReturnValue({ status: 'unavailable', reason: 'test' });

      jumpToMessage(uniquePrompt, 0);

      // Must NOT fast-path onto wrongNode whose message ID conflicts with expected-id
      expect(mocks.logEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        'JUMP_FAST_PATH_RESULT',
        expect.anything(),
        undefined
      );
    });

    it('falls back to viewport-walker on recovery 1 when a clamped virtual-layout jump disconnects (elastic snap-back trap)', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 7271, 6364);

      // Initial virtual-layout mount lands clamped at bottom (top: 619px, scrollTop clamped at 6364)
      const collapsedTarget = document.createElement('div');
      collapsedTarget.scrollIntoView = vi.fn();
      collapsedTarget.getBoundingClientRect = () =>
        ({ top: 619, bottom: 701, left: 0, right: 800, width: 800, height: 82 } as DOMRect);

      // Viewport-walker recovery mounts target smoothly in the expanded container
      let recoveredDocTop = 18861;
      const recoveredTarget = document.createElement('div');
      recoveredTarget.scrollIntoView = vi.fn();
      recoveredTarget.getBoundingClientRect = () => {
        const top = recoveredDocTop - container.scrollTop;
        return { top, bottom: top + 82, left: 0, right: 800, width: 800, height: 82 } as DOMRect;
      };

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          container.scrollTop = Math.max(0, Math.min(maxScroll, opts.top));
        }
      });

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 16,
        topOffsetPx: 18861,
        turnCount: 17,
      });

      const walkerSpy = vi
        .spyOn(viewportWalker, 'loadUntilMountedViaViewport')
        .mockImplementation(async () => {
          setScrollHeight(22821);
          container.scrollTop = 18671;
          container.appendChild(recoveredTarget);
          mocks.findPrompt.mockReturnValue(recoveredTarget);
          return recoveredTarget;
        });

      jumpToMessage(
        { id: 'prompt-17', text: 'Step 1.2 — Missing Values Analysis', canMatchByText: true, createTime: 0 },
        16
      );

      // Initial virtual-layout mounts collapsed target (clamped: true at bottom)
      container.appendChild(collapsedTarget);
      mocks.findPrompt.mockReturnValue(collapsedTarget);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // Virtualizer expands scrollHeight back up and snaps scrollTop away, unmounting target
      setScrollHeight(22821);
      container.scrollTop = 13826;
      collapsedTarget.remove();
      mocks.findPrompt.mockReturnValue(null);

      for (let i = 0; i < 35; i++) {
        await stepFrame(16);
        await vi.advanceTimersByTimeAsync(0);
      }

      // Must NOT repeat the collapsing virtual-layout leap; must escalate to viewport-walker on recovery 1
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(1);
      expect(walkerSpy).toHaveBeenCalledTimes(1);
      expect(recoveredTarget.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(16);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

      walkerSpy.mockRestore();
    });

    it('re-invokes holdViewport() before post-mount alignment and realignment scroll writes', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 15209, 10000);

      let targetDocTop = 11333;
      const target = document.createElement('div');
      target.scrollIntoView = vi.fn();
      target.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 82, left: 0, right: 800, width: 800, height: 82 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 16,
        topOffsetPx: 11333,
        turnCount: 17,
      });

      jumpToMessage(
        { id: 'prompt-17', text: 'Step 1.2', canMatchByText: true, createTime: 0 },
        16
      );
      expect(mocks.holdViewport).toHaveBeenCalledTimes(2); // JUMP_START + virtual-layout coarse scroll

      container.appendChild(target);
      mocks.findPrompt.mockReturnValue(target);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // Post-mount alignment after virtual-layout re-invokes holdViewport()
      expect(mocks.holdViewport).toHaveBeenCalledTimes(3);

      // Layout shift triggers realignment -> re-invokes holdViewport() again before scroll write
      setScrollHeight(16000);
      targetDocTop += 300;
      for (let i = 0; i < 5; i++) await stepFrame(16);
      expect(mocks.holdViewport.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(target.getBoundingClientRect().top).toBeCloseTo(190, 1);
    });

    it('uses conditional native bottom-first for unmounted last prompt, calls holdViewport(), and lands at 190px', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 20000, 5000);

      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-2', text: 'Middle', canMatchByText: true, createTime: 2 },
        { id: 'p-last', text: 'Last prompt', canMatchByText: true, createTime: 3 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'last-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const lastDocTop = 19931 + 190;
      const lastEl = document.createElement('div');
      lastEl.scrollIntoView = vi.fn();
      lastEl.getBoundingClientRect = () => {
        const top = lastDocTop - container.scrollTop;
        return { top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });

      mocks.findPrompt.mockReturnValue(null);
      mocks.scrollToBottom.mockImplementation(() => {
        setScrollHeight(26014);
        container.scrollTop = 25107; // distFromBottom = 0
        container.appendChild(lastEl);
        mocks.findPrompt.mockReturnValue(lastEl);
        return { status: 'ok', method: 'native-controller' } as any;
      });

      jumpToMessage(prompts[2], 2);
      expect(mocks.scrollToBottom).toHaveBeenCalledWith(container);

      // Advance past bottom-first quiet window (~160ms) + fast-path stabilization
      for (let i = 0; i < 6; i++) {
        await stepFrame(40);
        await vi.advanceTimersByTimeAsync(40);
      }
      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
      }

      expect(mocks.holdViewport.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(lastEl.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(2);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('skips bottom-first when the last prompt is already mounted and never uses bottom-first for ordinary non-last prompts', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { container } = createDynamicContainer(907, 26014, 25107);
      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-2', text: 'Middle', canMatchByText: true, createTime: 2 },
        { id: 'p-last', text: 'Last prompt', canMatchByText: true, createTime: 3 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'last-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const lastEl = document.createElement('div');
      lastEl.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.appendChild(lastEl);
      mocks.findPrompt.mockReturnValue(lastEl);
      mocks.scrollToBottom.mockReturnValue({ status: 'ok', method: 'native-controller' } as any);

      // Last prompt already mounted -> Fast Path directly, no scrollToBottom
      jumpToMessage(prompts[2], 2);
      expect(mocks.scrollToBottom).not.toHaveBeenCalled();

      // Ordinary unmounted non-last prompt -> Virtual Layout directly, no scrollToBottom
      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({ status: 'unavailable', reason: 'test' });
      jumpToMessage(prompts[1], 1);
      expect(mocks.scrollToBottom).not.toHaveBeenCalled();
    });

    it('handles long final assistant response when bottom-first settles without mounting the last prompt', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 10000, 2000);

      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-last', text: 'Last with huge reply', canMatchByText: true, createTime: 2 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'long-reply-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const lastDocTop = 18000;
      const lastEl = document.createElement('div');
      lastEl.scrollIntoView = vi.fn();
      lastEl.getBoundingClientRect = () => {
        const top = lastDocTop - container.scrollTop;
        return { top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (Math.abs(opts.top - lastDocTop) < 1000 && !lastEl.isConnected) {
            container.appendChild(lastEl);
            mocks.findPrompt.mockReturnValue(lastEl);
          }
        }
      });

      mocks.findPrompt.mockReturnValue(null);
      // Native bottom reaches bottom of 40,000px reply, so last prompt at 18,000px is still unmounted
      mocks.scrollToBottom.mockImplementation(() => {
        setScrollHeight(40000);
        container.scrollTop = 39093;
        return { status: 'ok', method: 'native-controller' } as any;
      });
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 1,
        topOffsetPx: lastDocTop,
        turnCount: 2,
      });

      jumpToMessage(prompts[1], 1);
      for (let i = 0; i < 6; i++) {
        await stepFrame(40);
        await vi.advanceTimersByTimeAsync(40);
      }
      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
      }

      expect(mocks.scrollToBottom).toHaveBeenCalledOnce();
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledWith(container, 'p-last');
      expect(lastEl.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
    });

    it('cancels bottom-first cleanly when user scrolls or another jump supersedes it', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { container } = createDynamicContainer(907, 20000, 5000);
      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-last', text: 'Last', canMatchByText: true, createTime: 2 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'cancel-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      mocks.findPrompt.mockReturnValue(null);
      mocks.scrollToBottom.mockReturnValue({ status: 'ok', method: 'native-controller' } as any);

      jumpToMessage(prompts[1], 1);
      await vi.advanceTimersByTimeAsync(40);
      // User interrupts during bottom-first wait
      container.dispatchEvent(new Event('wheel'));
      await vi.advanceTimersByTimeAsync(200);

      expect(mocks.clearJumpProgress).toHaveBeenCalled();
      expect(mocks.queryVirtualJumpTarget).not.toHaveBeenCalled();
      expect(mocks.onJumpComplete).not.toHaveBeenCalled();
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('falls back to viewport-walker when direct virtual-layout exhausts with target-mount-timeout, and skips fallback if cancelled', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(907, 20000, 12000);
      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-2', text: 'Second', canMatchByText: true, createTime: 2 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'exhaust-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const target1 = document.createElement('div');
      target1.scrollIntoView = vi.fn();
      target1.getBoundingClientRect = () =>
        ({ top: 190, bottom: 270, left: 0, right: 800, width: 800, height: 80 } as DOMRect);
      container.scrollTo = vi.fn();

      mocks.findPrompt.mockReturnValue(null);
      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 0,
        turnCount: 2,
      });

      const walkerSpy = vi
        .spyOn(viewportWalker, 'loadUntilMountedViaViewport')
        .mockImplementation(async () => {
          container.appendChild(target1);
          mocks.findPrompt.mockReturnValue(target1);
          return target1;
        });

      // 1. Direct virtual jump exhausts -> falls back to viewport-walker -> lands cleanly
      jumpToMessage(prompts[0], 0);
      await vi.advanceTimersByTimeAsync(1100);
      for (let i = 0; i < 30; i++) {
        await stepFrame(16);
      }

      expect(walkerSpy).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);

      // 2. Cancelled before virtual-layout finishes -> must NOT start viewport-walker fallback
      walkerSpy.mockClear();
      target1.remove();
      mocks.findPrompt.mockReturnValue(null);
      jumpToMessage(prompts[0], 0);
      await vi.advanceTimersByTimeAsync(200);
      cancelActiveNavigationSearch();
      await vi.advanceTimersByTimeAsync(1500);
      expect(walkerSpy).not.toHaveBeenCalled();

      walkerSpy.mockRestore();
    });

    it('settles cleanly when offscreen scrollHeight oscillates (+/-1721px) while compensated target stays at 190px', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 125507, 18653);
      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-15', text: 'Fifteenth', canMatchByText: true, createTime: 15 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'hysteresis-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const target15 = document.createElement('div');
      target15.scrollIntoView = vi.fn();
      // Target stays locked at 190px visually because ChatGPT compensates scrollTop by exact +/-1721px
      target15.getBoundingClientRect = () =>
        ({ top: 190, bottom: 260, left: 0, right: 800, width: 800, height: 70 } as DOMRect);
      container.appendChild(target15);
      mocks.findPrompt.mockReturnValue(target15);

      jumpToMessage(prompts[1], 1);

      // Oscillate scrollHeight and scrollTop every frame by +/-1721px (keeping sh - st constant)
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) {
          setScrollHeight(123786);
          container.scrollTop = 16933;
        } else {
          setScrollHeight(125507);
          container.scrollTop = 18653;
        }
        await stepFrame(20);
      }

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('realigns when scrollHeight changes AND the target itself actually moves away from 190px', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container, setScrollHeight } = createDynamicContainer(907, 120000, 18000);
      const prompts = [
        { id: 'p-1', text: 'First', canMatchByText: true, createTime: 1 },
        { id: 'p-15', text: 'Fifteenth', canMatchByText: true, createTime: 15 },
      ];
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'displaced-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      let targetDocTop = 18190;
      const target15 = document.createElement('div');
      target15.scrollIntoView = vi.fn();
      target15.getBoundingClientRect = () => {
        const top = targetDocTop - container.scrollTop;
        return { top, bottom: top + 70, left: 0, right: 800, width: 800, height: 70 } as DOMRect;
      };
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });
      container.appendChild(target15);
      mocks.findPrompt.mockReturnValue(target15);

      jumpToMessage(prompts[1], 1);
      await stepFrame(20);

      // Genuine layout shift moves target away from 190px by +300px
      setScrollHeight(120300);
      targetDocTop += 300;
      for (let i = 0; i < 30; i++) {
        await stepFrame(20);
      }

      expect(target15.getBoundingClientRect().top).toBeCloseTo(190, 1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('keeps virtual-layout on recovery 2 when recovery 1 shifted topOffsetPx meaningfully instead of forcing viewport-walker', async () => {
      mocks.promptLandingViewportTopPx = 190;
      const { stepFrame } = createStepDriver();
      const { container } = createDynamicContainer(907, 120000, 0);
      const prompts = Array.from({ length: 20 }, (_, i) => ({
        id: `p-${i + 1}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i + 1,
      }));
      initializePromptNavigation({
        getVirtualSearchContext: () => ({ conversationKey: 'progress-recovery-conv', prompts }),
        setJumpProgress: mocks.setJumpProgress,
        clearJumpProgress: mocks.clearJumpProgress,
        notifyJumpFailed: mocks.notifyJumpFailed,
        onJumpComplete: mocks.onJumpComplete,
      });

      const makeNode = () => {
        const el = document.createElement('div');
        el.scrollIntoView = vi.fn();
        el.getBoundingClientRect = () =>
          ({ top: 190, bottom: 260, left: 0, right: 800, width: 800, height: 70 } as DOMRect);
        return el;
      };
      const node0 = makeNode();
      const node1 = makeNode();
      const node2 = makeNode();

      mocks.findPrompt.mockReturnValue(null);
      // Cold-start offsets converge across jumps: 10027.5 -> 15604 -> 18759
      mocks.queryVirtualJumpTarget
        .mockReturnValueOnce({ status: 'ok', targetIndex: 14, topOffsetPx: 10027.5, turnCount: 123 })
        .mockReturnValueOnce({ status: 'ok', targetIndex: 14, topOffsetPx: 15604, turnCount: 123 })
        .mockReturnValue({ status: 'ok', targetIndex: 14, topOffsetPx: 18759, turnCount: 123 });

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
        }
      });

      const walkerSpy = vi.spyOn(viewportWalker, 'loadUntilMountedViaViewport');

      jumpToMessage(prompts[14], 14);

      // Initial mount -> disconnects
      container.appendChild(node0);
      mocks.findPrompt.mockReturnValue(node0);
      await stepFrame(16);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      node0.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 5; i++) await stepFrame(16);

      // Recovery 1 mounts at shifted offset 15604 -> disconnects again
      container.appendChild(node1);
      mocks.findPrompt.mockReturnValue(node1);
      await stepFrame(16);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      node1.remove();
      mocks.findPrompt.mockReturnValue(null);
      for (let i = 0; i < 5; i++) await stepFrame(16);

      // Recovery 2 must stay on virtual-layout (query 3 = 18759), NOT force viewport-walker!
      container.appendChild(node2);
      mocks.findPrompt.mockReturnValue(node2);
      for (let i = 0; i < 30; i++) await stepFrame(20);

      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(3);
      expect(walkerSpy).not.toHaveBeenCalled();
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(14);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

      walkerSpy.mockRestore();
    });
  });
});
