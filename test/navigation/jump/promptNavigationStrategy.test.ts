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
import {
  APP_CONFIG,
  type ChatGptNavigationAlgorithm,
} from '@/config/config';

const mocks = vi.hoisted(() => ({
  navigationAlgorithm: 'legacy-native' as ChatGptNavigationAlgorithm,
  createAnchor: vi.fn(),
  findPrompt: vi.fn(),
  getContainer: vi.fn(),
  getMetrics: vi.fn(),
  isPromptVisible: vi.fn(),
  observePosition: vi.fn(),
  recordConfirmed: vi.fn(),
  searchVirtualPrompt: vi.fn(),
}));

vi.mock('@/platforms/chatgpt/virtualSearchAdapter', () => ({
  createChatGptElementNavigationAnchor: mocks.createAnchor,
  findRenderedChatGptPrompt: mocks.findPrompt,
  getChatGptScrollContainer: mocks.getContainer,
  getChatGptScrollMetrics: mocks.getMetrics,
  isChatGptElementVisible: mocks.isPromptVisible,
  observeChatGptVirtualPosition: mocks.observePosition,
}));

vi.mock('@/navigation/jump/navigationAnchorStore', () => ({
  createNavigationAnchorStore: () => ({
    findConfirmed: vi.fn(),
    getConfirmedAnchors: vi.fn().mockResolvedValue([]),
    getObservedAnchors: vi.fn().mockReturnValue([]),
    recordConfirmed: mocks.recordConfirmed,
    recordObservation: vi.fn(),
  }),
}));

vi.mock('@/navigation/jump/virtualSearchController', () => ({
  searchVirtualPrompt: mocks.searchVirtualPrompt,
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
  mocks.recordConfirmed.mockResolvedValue(undefined);
  mocks.isPromptVisible.mockReturnValue(false);
  mocks.searchVirtualPrompt.mockResolvedValue({
    status: 'unresolved',
    attempts: 1,
    lastPlan: null,
    lastPosition: { status: 'none' },
  });

  initializePromptNavigation({
    getNativePromptButtons: () => [],
    normalizeText: (text) => text,
    findConversationIndexByElement: () => -1,
    getConversationMessageCount: () => 1,
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
      fingerprintIndex: [],
      segmentIndex: [],
    }),
    lockActiveIndex: vi.fn(),
      setJumpProgress: vi.fn(),
      clearJumpProgress: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prompt navigation strategy', () => {
  it('uses ChatGPT native buttons in the default legacy strategy', () => {
    const nativeButton = document.createElement('button');
    const click = vi.spyOn(nativeButton, 'click');
    initializePromptNavigation({
      getNativePromptButtons: () => [nativeButton],
      normalizeText: (text) => text,
      findConversationIndexByElement: () => -1,
      getConversationMessageCount: () => 1,
      getVirtualSearchContext: () => ({
        conversationKey: 'conversation-1',
        prompts: [],
        fingerprintIndex: [],
        segmentIndex: [],
      }),
      lockActiveIndex: vi.fn(),
      setJumpProgress: vi.fn(),
      clearJumpProgress: vi.fn(),
    });

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(click).toHaveBeenCalledOnce();
    expect(mocks.findPrompt).not.toHaveBeenCalled();
    expect(mocks.searchVirtualPrompt).not.toHaveBeenCalled();
  });

  it('avoids native buttons when an independent target is rendered', async () => {
    mocks.navigationAlgorithm = 'independent-virtual';
    const nativeButton = document.createElement('button');
    const click = vi.spyOn(nativeButton, 'click');
    const container = document.createElement('div');
    const target = document.createElement('div');
    document.body.append(container, target);
    target.scrollIntoView = vi.fn();
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(target);
    mocks.isPromptVisible.mockReturnValue(true);
    mocks.createAnchor.mockReturnValue({
      conversationKey: 'conversation-1',
      promptId: 'prompt-1',
      promptIndex: 0,
      scrollTop: 100,
      scrollHeight: 1_000,
      viewportWidth: 800,
      viewportHeight: 600,
      scrollProgress: 0.25,
      updatedAt: 1,
    });
    initializePromptNavigation({
      getNativePromptButtons: () => [nativeButton],
      normalizeText: (text) => text,
      findConversationIndexByElement: () => -1,
      getConversationMessageCount: () => 1,
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
        fingerprintIndex: [],
        segmentIndex: [],
      }),
      lockActiveIndex: vi.fn(),
      setJumpProgress: vi.fn(),
      clearJumpProgress: vi.fn(),
    });

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(mocks.recordConfirmed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      APP_CONFIG.navigation.search.renderWaitMs
    );

    expect(click).not.toHaveBeenCalled();
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'start',
    });
    expect(mocks.recordConfirmed).toHaveBeenCalledOnce();
    expect(mocks.searchVirtualPrompt).not.toHaveBeenCalled();
  });

  it('searches when a retained target DOM node is outside the chat viewport', () => {
    mocks.navigationAlgorithm = 'independent-virtual';
    const container = document.createElement('div');
    const offscreenTarget = document.createElement('div');
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(offscreenTarget);
    mocks.isPromptVisible.mockReturnValue(false);

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(mocks.searchVirtualPrompt).toHaveBeenCalledOnce();
    const searchOptions = mocks.searchVirtualPrompt.mock.calls[0]![0];
    expect(searchOptions.isTargetRendered()).toBe(false);
    expect(offscreenTarget.scrollIntoView).toBeUndefined();
  });

  it('starts independent virtual search without calling the legacy path', () => {
    mocks.navigationAlgorithm = 'independent-virtual';
    const nativeButton = document.createElement('button');
    const click = vi.spyOn(nativeButton, 'click');
    const container = document.createElement('div');
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(null);
    initializePromptNavigation({
      getNativePromptButtons: () => [nativeButton],
      normalizeText: (text) => text,
      findConversationIndexByElement: () => -1,
      getConversationMessageCount: () => 1,
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
        fingerprintIndex: [],
        segmentIndex: [],
      }),
      lockActiveIndex: vi.fn(),
      setJumpProgress: vi.fn(),
      clearJumpProgress: vi.fn(),
    });

    jumpToMessage(
      {
        id: 'prompt-1',
        text: 'Prompt',
        canMatchByText: true,
        createTime: 0,
      },
      0
    );

    expect(click).not.toHaveBeenCalled();
    expect(mocks.searchVirtualPrompt).toHaveBeenCalledOnce();
    expect(
      mocks.searchVirtualPrompt.mock.calls[0]?.[0]
        .targetDomRecoveryDirection
    ).toBe(-1);
  });
});
