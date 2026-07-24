/** @vitest-environment jsdom */
/** Tests configuration-based routing between ChatGPT navigation strategies. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_CONFIG,
  type ChatGptNavigationAlgorithm,
} from '@/config/config';

const mocks = vi.hoisted(() => ({
  createAnchor: vi.fn(),
  findPrompt: vi.fn(),
  getContainer: vi.fn(),
  getMetrics: vi.fn(),
  observePosition: vi.fn(),
  recordConfirmed: vi.fn(),
  searchVirtualPrompt: vi.fn(),
}));

vi.mock('@/platforms/chatgpt/virtualSearchAdapter', () => ({
  createChatGptElementNavigationAnchor: mocks.createAnchor,
  findRenderedChatGptPrompt: mocks.findPrompt,
  getChatGptScrollContainer: mocks.getContainer,
  getChatGptScrollMetrics: mocks.getMetrics,
  observeChatGptVirtualPosition: mocks.observePosition,
}));

vi.mock('@/features/navigation/navigationAnchorStore', () => ({
  createNavigationAnchorStore: () => ({
    findConfirmed: vi.fn(),
    getConfirmedAnchors: vi.fn().mockResolvedValue([]),
    getObservedAnchors: vi.fn().mockReturnValue([]),
    recordConfirmed: mocks.recordConfirmed,
    recordObservation: vi.fn(),
  }),
}));

vi.mock('@/features/navigation/virtualSearchController', () => ({
  searchVirtualPrompt: mocks.searchVirtualPrompt,
}));

vi.mock('@/features/navigation/follow', () => ({
  keepFollowing: vi.fn(),
}));

import {
  initializePromptNavigation,
  jumpToMessage,
} from '@/features/navigation/promptNavigation';

const mutableChatGptConfig = APP_CONFIG.platforms.chatgpt as {
  navigationAlgorithm: ChatGptNavigationAlgorithm;
};

beforeEach(() => {
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
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  mutableChatGptConfig.navigationAlgorithm = 'legacy-native';
  mocks.recordConfirmed.mockResolvedValue(undefined);
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
    }),
    lockActiveIndex: vi.fn(),
  });
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
      }),
      lockActiveIndex: vi.fn(),
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

  it('avoids native buttons when an independent target is rendered', () => {
    mutableChatGptConfig.navigationAlgorithm = 'independent-virtual';
    const nativeButton = document.createElement('button');
    const click = vi.spyOn(nativeButton, 'click');
    const container = document.createElement('div');
    const target = document.createElement('div');
    target.scrollIntoView = vi.fn();
    container.scrollTo = vi.fn();
    Object.defineProperties(container, {
      scrollTop: { configurable: true, writable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 5_000 },
      clientHeight: { configurable: true, value: 1_000 },
    });
    container.getBoundingClientRect = () =>
      ({ top: 100 }) as DOMRect;
    target.getBoundingClientRect = () =>
      ({ top: 300 }) as DOMRect;
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(target);
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
      }),
      lockActiveIndex: vi.fn(),
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
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 1_184,
      behavior: 'auto',
    });
    expect(mocks.recordConfirmed).toHaveBeenCalledOnce();
    expect(mocks.searchVirtualPrompt).not.toHaveBeenCalled();
  });

  it('starts independent virtual search without calling the legacy path', () => {
    mutableChatGptConfig.navigationAlgorithm = 'independent-virtual';
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
      }),
      lockActiveIndex: vi.fn(),
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
  });
});
