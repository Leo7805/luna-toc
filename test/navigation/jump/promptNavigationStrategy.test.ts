/** @vitest-environment jsdom */
/** Tests configuration-based routing between ChatGPT navigation strategies. */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ChatGptNavigationAlgorithm } from '@/config/config';

const mocks = vi.hoisted(() => ({
  navigationAlgorithm: 'legacy-native' as ChatGptNavigationAlgorithm,
  findPrompt: vi.fn(),
  getContainer: vi.fn(),
  isPromptVisible: vi.fn(),
  createJumpId: vi.fn(() => 'jump-id-stub'),
  getTestConfig: vi.fn(() => null),
  logEvent: vi.fn(),
  setJumpProgress: vi.fn(),
  clearJumpProgress: vi.fn(),
  notifyJumpFailed: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    id: 'chatgpt',
    navigation: {
      getScrollContainer: mocks.getContainer,
      findRenderedPrompt: mocks.findPrompt,
      isElementVisible: mocks.isPromptVisible,
      getScrollMetrics: vi.fn(),
      createElementNavigationAnchor: vi.fn(),
      observeVirtualPosition: vi.fn(),
      getPromptMountDiagnostic: vi.fn(),
    },
    diagnostics: {
      createJumpId: mocks.createJumpId,
      getTestConfig: mocks.getTestConfig,
      logEvent: mocks.logEvent,
    },
  }),
}));

vi.mock('@/platforms/chatgpt/virtualSearchAdapter', () => ({
  getChatGptScrollContainer: mocks.getContainer,
  findRenderedChatGptPrompt: mocks.findPrompt,
  findRenderedChatGptPromptByText: vi.fn(() => null),
  readMountedWithSidebarIdx: vi.fn(() => []),
}));

vi.mock('@/navigation/follow/follow', () => ({
  keepFollowing: vi.fn(),
}));

vi.mock('@/navigation/navigationSettings', () => ({
  getChatGptNavigationAlgorithm: () => mocks.navigationAlgorithm,
}));

import {
  initializePromptNavigation,
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
  mocks.navigationAlgorithm = 'legacy-native';
  mocks.isPromptVisible.mockReturnValue(false);

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
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prompt navigation strategy', () => {
  it('falls back to legacy navigation in the default legacy strategy', () => {
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

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(container.scrollTop).toBe(0);
    expect(mocks.findPrompt).not.toHaveBeenCalled();
    expect(mocks.setJumpProgress).not.toHaveBeenCalled();
  });

  it('navigates directly via fast-path when target is rendered in independent-virtual strategy', async () => {
    mocks.navigationAlgorithm = 'independent-virtual';
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
    expect(mocks.clearJumpProgress).toHaveBeenCalled();
    expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    expect(target.style.outline).toBe('');
  });

  it('initiates virtual step-loading when target is not rendered in the DOM', () => {
    mocks.navigationAlgorithm = 'independent-virtual';
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
    mocks.navigationAlgorithm = 'independent-virtual';
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
});
