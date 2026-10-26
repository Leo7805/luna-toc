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

const mocks = vi.hoisted(() => ({
  findPrompt: vi.fn(),
  findText: vi.fn(),
  getContainer: vi.fn(),
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
      findRenderedPromptByText: mocks.findText,
      readMountedWithSidebarIdx: vi.fn(() => []),
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
  it('does not use text fallback for a prompt containing attachments', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(null);
    const message = { id: 'file-prompt', text: '[文件] attachment', canMatchByText: false, createTime: 0 };
    initializePromptNavigation({
      getVirtualSearchContext: () => ({ conversationKey: 'conversation-1', prompts: [message] }),
      setJumpProgress: mocks.setJumpProgress,
      clearJumpProgress: mocks.clearJumpProgress,
      notifyJumpFailed: mocks.notifyJumpFailed,
    });
    jumpToMessage(message, 0);
    expect(mocks.findText).not.toHaveBeenCalled();
  });

  it('rejects text fallback for repeated prompts even when one is mounted', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(null);
    const messages = ['first', 'second'].map((id) => ({
      id, text: 'Repeat this prompt', canMatchByText: true, createTime: 0,
    }));
    initializePromptNavigation({
      getVirtualSearchContext: () => ({ conversationKey: 'conversation-1', prompts: messages }),
      setJumpProgress: mocks.setJumpProgress,
      clearJumpProgress: mocks.clearJumpProgress,
      notifyJumpFailed: mocks.notifyJumpFailed,
    });
    jumpToMessage(messages[1], 1);
    expect(mocks.findText).not.toHaveBeenCalled();
  });

  it('jumps to a currently mounted prompt by exact identity', () => {
    const container = document.createElement('div');
    const target = document.createElement('div');
    document.body.append(container, target);
    target.scrollIntoView = vi.fn();
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(target);
    jumpToMessage({ id: 'prompt-1', text: 'Prompt', canMatchByText: true, createTime: 0 }, 0);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();
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
    expect(mocks.clearJumpProgress).toHaveBeenCalled();
    expect(mocks.notifyJumpFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(599);
    expect(target.style.outline).toBe('2px solid #60a5fa');
    await vi.advanceTimersByTimeAsync(1);
    expect(target.style.outline).toBe('');
    expect(target.style.borderRadius).toBe('');
  });

  it('scrolls to the bottom of the selected answer, not the whole conversation', () => {
    const container = document.createElement('div');
    const user = document.createElement('div');
    user.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    const answer = document.createElement('div');
    answer.setAttribute('data-chatgpt-search-unit-key', 'turn-1:assistant');
    const nextUser = document.createElement('div');
    nextUser.setAttribute('data-chatgpt-search-unit-key', 'turn-2:user');
    const nextAnswer = document.createElement('div');
    nextAnswer.setAttribute('data-chatgpt-search-unit-key', 'turn-2:assistant');
    user.scrollIntoView = vi.fn();
    answer.scrollIntoView = vi.fn();
    nextAnswer.scrollIntoView = vi.fn();
    container.append(user, answer, nextUser, nextAnswer);
    document.body.append(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(user);

    jumpToMessage({ id: 'prompt-1', text: 'Prompt', canMatchByText: true, createTime: 0 }, 0, 'bottom');
    expect(answer.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' });
    expect(nextAnswer.scrollIntoView).not.toHaveBeenCalled();
    expect(user.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not cross into the next prompt when the selected answer is absent', () => {
    const container = document.createElement('div');
    const user = document.createElement('div');
    user.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    const nextUser = document.createElement('div');
    nextUser.setAttribute('data-chatgpt-search-unit-key', 'turn-2:user');
    const nextAnswer = document.createElement('div');
    nextAnswer.setAttribute('data-chatgpt-search-unit-key', 'turn-2:assistant');
    user.scrollIntoView = vi.fn();
    nextAnswer.scrollIntoView = vi.fn();
    container.append(user, nextUser, nextAnswer);
    document.body.append(container);
    mocks.getContainer.mockReturnValue(container);
    mocks.findPrompt.mockReturnValue(user);

    jumpToMessage({ id: 'prompt-1', text: 'Prompt', canMatchByText: true, createTime: 0 }, 0, 'bottom');
    expect(user.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' });
    expect(nextAnswer.scrollIntoView).not.toHaveBeenCalled();
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
});
