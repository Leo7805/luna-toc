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

      // Fast-forward fake timers beyond 8000ms no-progress watchdog budget
      await vi.advanceTimersByTimeAsync(8100);

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
});
