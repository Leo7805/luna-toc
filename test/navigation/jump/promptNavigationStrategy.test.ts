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
  getContainer: vi.fn(),
  createJumpId: vi.fn(() => 'jump-id-stub'),
  getTestConfig: vi.fn(() => null),
  logEvent: vi.fn(),
  setJumpProgress: vi.fn(),
  clearJumpProgress: vi.fn(),
  notifyJumpFailed: vi.fn(),
  onJumpComplete: vi.fn(),
  queryVirtualJumpTarget: vi.fn(),
  readMountedWithSidebarIdx: vi.fn<() => Array<{ element: HTMLElement; sidebarIdx: number; unitKey?: string }>>(() => []),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    id: 'chatgpt',
    navigation: {
      getScrollContainer: mocks.getContainer,
      findRenderedPrompt: mocks.findPrompt,
      findRenderedPromptByText: vi.fn(() => null),
      readMountedWithSidebarIdx: mocks.readMountedWithSidebarIdx,
      queryVirtualJumpTarget: mocks.queryVirtualJumpTarget,
      promptTopOffsetPx: 16,
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

import { keepFollowing } from '@/navigation/follow/follow';
import * as viewportWalker from '@/navigation/jump/viewportWalker';
import {
  cancelActiveNavigationSearch,
  initializePromptNavigation,
  jumpToConversationEdge,
  jumpToMessage,
} from '@/navigation/jump/promptNavigation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
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
    expect(target.style.outline).toBe('2px solid #60a5fa');
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

    const stepFrame = async (): Promise<boolean> => {
      while (rafQueue.length > 0) {
        const item = rafQueue.shift()!;
        if (!cancelledRafs.has(item.id)) {
          item.cb(0);
          for (let i = 0; i < 5; i++) {
            await Promise.resolve();
          }
          return true;
        }
      }
      return false;
    };

    it('initially unmounted Prompt #1 becomes mounted and aligns correctly on the first click', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      let promptTop = 200;
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

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(promptTop).toBe(16);

      // Flush 3 stable animation frames
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('layout changes after mounting trigger remeasurement and realignment', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
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

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);

      // TanStack Virtual dynamic ResizeObserver measurement shifts Prompt #1 to 80px
      promptTop = 80;

      // Frame 1 check detects displacement and realigns
      expect(await stepFrame()).toBe(true);
      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(2);
      expect(promptTop).toBe(16);

      // Flush 3 stable frames after realignment
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);

      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    });

    it('late layout shift after initial aligned frames resets stability window and realigns', async () => {
      const container = document.createElement('div');
      container.scrollTo = vi.fn();
      Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
      container.getBoundingClientRect = () =>
        ({ top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 } as DOMRect);
      document.body.appendChild(container);
      mocks.getContainer.mockReturnValue(container);

      const targetPrompt = document.createElement('div');
      let promptTop = 16;
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

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);

      // Frame 1: aligned (consecutive = 1)
      expect(await stepFrame()).toBe(true);
      // Frame 2: aligned (consecutive = 2)
      expect(await stepFrame()).toBe(true);

      // Late shift occurs before reaching REQUIRED_STABLE_FRAMES (3)
      promptTop = 95;

      // Frame 3 detects displacement, resets stability count, and realigns
      expect(await stepFrame()).toBe(true);
      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(2);
      expect(promptTop).toBe(16);

      // Flush 3 stable frames after realignment
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);

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

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);

      // Bounded at minimum scroll boundary: settles without repeated no-op scrolls
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);
      expect(await stepFrame()).toBe(true);

      expect(targetPrompt.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
      expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
    });

    it('already-mounted Prompt #1 retains its correct direct-jump behaviour without extra scrolls or delay', () => {
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

      // Flush any pending callbacks from Jump 1
      while (await stepFrame()) {
        // drain queue
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

      // Step until all bounded checks exhaust
      while (await stepFrame()) {
        // drain check budget
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
});
