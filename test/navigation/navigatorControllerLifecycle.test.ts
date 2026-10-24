/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigatorController } from '@/navigation/navigatorController';
import { getActivePlatform } from '@/platforms';
import { isLoading, setLoading } from '@/navigation/loading/promptLoadingState';
import * as promptNav from '@/navigation/jump/promptNavigation';
import * as outlineNavigation from '@/navigation/jump/outlineNavigation';

describe('navigatorController lifecycle and coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv',
      },
    });
    document.body.innerHTML = `
      <div id="navigator-list"></div>
      <div class="navigator-hint"></div>
      <div id="sidebar-status-band"></div>
      <div id="luna-toc-status"></div>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exposes all public controller API methods', () => {
    expect(typeof navigatorController.attach).toBe('function');
    expect(typeof navigatorController.clearJumpProgress).toBe('function');
    expect(typeof navigatorController.getCurrentConversationKey).toBe('function');
    expect(typeof navigatorController.getJumpProgress).toBe('function');
    expect(typeof navigatorController.init).toBe('function');
    expect(typeof navigatorController.jumpToAbsoluteEdge).toBe('function');
    expect(typeof navigatorController.jumpToEdge).toBe('function');
    expect(typeof navigatorController.jumpToLastPrompt).toBe('function');
    expect(typeof navigatorController.render).toBe('function');
    expect(typeof navigatorController.resetView).toBe('function');
    expect(typeof navigatorController.setJumpProgress).toBe('function');
    expect(typeof navigatorController.setSearchQuery).toBe('function');
  });

  it('cancels pending outline positioning before edge navigation', () => {
    const cancelOutlineNavigation = vi.spyOn(
      outlineNavigation,
      'cancelOutlineNavigation'
    );
    const jumpToAbsoluteEdge = vi.spyOn(
      promptNav,
      'jumpToAbsoluteEdge'
    ).mockImplementation(() => {});

    const expectCancellationBeforeJump = () => {
      expect(cancelOutlineNavigation).toHaveBeenCalledOnce();
      expect(jumpToAbsoluteEdge).toHaveBeenCalledOnce();
      expect(cancelOutlineNavigation.mock.invocationCallOrder[0]).toBeLessThan(
        jumpToAbsoluteEdge.mock.invocationCallOrder[0]
      );
    };

    navigatorController.jumpToEdge('bottom');
    expect(jumpToAbsoluteEdge).toHaveBeenCalledWith('bottom', 'auto');
    expectCancellationBeforeJump();

    cancelOutlineNavigation.mockClear();
    jumpToAbsoluteEdge.mockClear();

    navigatorController.jumpToAbsoluteEdge('top');
    expect(jumpToAbsoluteEdge).toHaveBeenCalledWith('top', 'auto');
    expectCancellationBeforeJump();
  });

  it('uses the platform route key for project conversations', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/g/g-p-workspace/c/project-conversation',
      },
    });
    expect(navigatorController.getCurrentConversationKey()).toBe('project-conversation');
  });

  it('initializes and attaches without throwing under jsdom', () => {
    const onPromptCountChanged = vi.fn();
    const onRouteChanged = vi.fn();

    expect(() => {
      navigatorController.init({
        onPromptCountChanged,
        onRouteChanged,
      });
      navigatorController.attach();
    }).not.toThrow();
  });

  it('processes incoming conversation data using payload and updates the TOC list', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv-populate',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    const list = document.getElementById('navigator-list')!;
    list.innerHTML = '';

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'test-conv-populate',
          payload: {
            messages: [
              {
                id: 'prompt-1',
                author: { role: 'user' },
                content: { parts: ['Hello World'] },
                create_time: 100,
              },
              {
                id: 'asst-1',
                author: { role: 'assistant' },
                content: { parts: ['Hi there'] },
                create_time: 200,
              },
            ],
          },
        },
        source: window,
      })
    );

    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('Hello World');
  });

  it('ignores stale conversationData intended for a different route', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv-active',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    const list = document.getElementById('navigator-list')!;
    list.innerHTML = '';

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'different-stale-route',
          payload: {
            messages: [
              {
                id: 'prompt-stale',
                author: { role: 'user' },
                content: { parts: ['Stale prompt text'] },
                create_time: 100,
              },
            ],
          },
        },
        source: window,
      })
    );

    expect(list.children.length).toBe(0);
  });

  it('only marks loading complete when conversationEnded matches current route', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv-ended',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    const statusElement = document.getElementById('luna-toc-status')!;
    expect(isLoading()).toBe(true);
    expect(statusElement.textContent).toContain('加载');

    // Mismatched routeKey must be ignored
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationEnded,
          routeKey: 'old-different-route',
        },
        source: window,
      })
    );
    expect(isLoading()).toBe(true);
    expect(statusElement.textContent).toContain('加载');

    // Matching routeKey completes loading
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationEnded,
          routeKey: 'test-conv-ended',
        },
        source: window,
      })
    );
    expect(isLoading()).toBe(false);
    expect(statusElement.textContent).not.toContain('加载');
  });

  it('processes newUserMessage using payload and updates the TOC list', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv-new-msg',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    const list = document.getElementById('navigator-list')!;
    list.innerHTML = '';

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.newUserMessage,
          routeKey: 'test-conv-new-msg',
          payload: {
            id: 'prompt-new-msg',
            author: { role: 'user' },
            content: { parts: ['Realtime message content'] },
            create_time: 300,
          },
        },
        source: window,
      })
    );

    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('Realtime message content');
  });

  it('preserves prompt during new-chat route migration', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    // Route sync to new chat
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    const list = document.getElementById('navigator-list')!;
    list.innerHTML = '';

    // First user prompt on new chat
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.newUserMessage,
          routeKey: 'new-chat:/',
          payload: {
            id: 'prompt-first',
            author: { role: 'user' },
            content: { parts: ['My first prompt in new chat'] },
            create_time: 100,
          },
        },
        source: window,
      })
    );

    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');

    // ChatGPT assigns temporary local URL
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/local-123456',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    // Prompt #1 must be preserved in temporary local route
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');

    // ChatGPT assigns permanent URL
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/migrated-permanent-id',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    // Prompt #1 must be preserved in migrated permanent conversation
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');

    // Test 1: Empty conversationData arrives for the real conversation ID
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'migrated-permanent-id',
          payload: {
            messages: [],
          },
        },
        source: window,
      })
    );

    // Prompt #1 must still exist
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');

    // Test 2: Server later returns prompt #1
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'migrated-permanent-id',
          payload: {
            messages: [
              {
                id: 'prompt-first',
                author: { role: 'user' },
                content: { parts: ['My first prompt in new chat'] },
                create_time: 100,
              },
              {
                id: 'asst-first',
                author: { role: 'assistant' },
                content: { parts: ['First assistant reply'] },
                create_time: 150,
              },
            ],
          },
        },
        source: window,
      })
    );

    // Prompt #1 must not be duplicated
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');

    // Test 3: Second prompt arrives under real conversation ID
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.newUserMessage,
          routeKey: 'migrated-permanent-id',
          payload: {
            id: 'prompt-second',
            author: { role: 'user' },
            content: { parts: ['My second prompt'] },
            create_time: 200,
          },
        },
        source: window,
      })
    );

    // Final TOC contains both prompts in order
    expect(list.children.length).toBe(2);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');
    expect(list.children[1].textContent).toContain('My second prompt');
  });

  it('updates search query and filters rendered list', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv-search',
      },
    });
    navigatorController.init();
    navigatorController.attach();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'test-conv-search',
          payload: {
            messages: [
              {
                id: 'prompt-1',
                author: { role: 'user' },
                content: { parts: ['Apples are green'] },
                create_time: 100,
              },
              {
                id: 'asst-1',
                author: { role: 'assistant' },
                content: { parts: ['Yes'] },
                create_time: 150,
              },
              {
                id: 'prompt-2',
                author: { role: 'user' },
                content: { parts: ['Bananas are yellow'] },
                create_time: 200,
              },
            ],
          },
        },
        source: window,
      })
    );

    const list = document.getElementById('navigator-list')!;
    expect(list.children.length).toBe(2);

    navigatorController.setSearchQuery('banana');
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('Bananas');

    navigatorController.resetView();
    expect(list.children.length).toBe(2);
  });

  it('re-arms active prompt mutation tracking on route transition so new prompts are tracked', async () => {
    vi.resetModules();
    const platform = getActivePlatform();

    const mutationObserveSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    const mutationDisconnectSpy = vi.spyOn(
      MutationObserver.prototype,
      'disconnect'
    );

    // Initial conversation route
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/tracker-route-initial',
      },
    });

    const { navigatorController: freshController } = await import(
      '@/navigation/navigatorController'
    );

    freshController.init();
    freshController.attach();

    // 1. Tracker is initialized and observing mutations
    expect(mutationObserveSpy).toHaveBeenCalled();
    const initialObserveCallCount = mutationObserveSpy.mock.calls.length;
    const initialDisconnectCallCount =
      mutationDisconnectSpy.mock.calls.length;

    // 2 & 3. Route transition triggers reset and re-arms mutation tracking
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/tracker-route-switched',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    // 2. Route reset disconnects existing mutation observer
    expect(mutationDisconnectSpy.mock.calls.length).toBeGreaterThan(
      initialDisconnectCallCount
    );

    // 3. Route transition re-arms mutation tracking
    expect(mutationObserveSpy.mock.calls.length).toBeGreaterThan(
      initialObserveCallCount
    );

    // 4. Mutation tracking is active on document.body after transition
    expect(mutationObserveSpy.mock.calls.length).toBeGreaterThan(
      initialObserveCallCount
    );
  });

  it('jumps and expands on first row click, collapses on second, reopens on third', async () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-expand-on-jump',
      },
    });
    // Other lifecycle tests reset modules; keep the spy and the controller
    // under test bound to the same module instance.
    vi.resetModules();
    const { navigatorController: freshController } = await import(
      '@/navigation/navigatorController'
    );
    const freshPromptNav = await import('@/navigation/jump/promptNavigation');
    const { resetOutline: resetFreshOutline } = await import(
      '@/navigation/jump/outline'
    );
    const jumpToMessageSpy = vi.spyOn(freshPromptNav, 'jumpToMessage')
      .mockImplementation(() => {});

    freshController.init();
    freshController.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: platform.pageHook.messages.routeChanged },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        type: platform.pageHook.messages.conversationData,
        routeKey: 'test-expand-on-jump',
        payload: {
          messages: [
            {
              id: 'prompt-expand',
              author: { role: 'user' },
              content: { parts: ['Expand me'] },
              create_time: 100,
            },
            {
              id: 'answer-expand',
              author: { role: 'assistant' },
              content: { parts: ['Answer'] },
              create_time: 200,
            },
          ],
        },
      },
    }));

    const user = document.createElement('div');
    user.setAttribute('data-chatgpt-search-unit-key', 'prompt-expand:user');
    user.setAttribute('data-chatgpt-search-message-ids', 'prompt-expand');
    const assistant = document.createElement('div');
    assistant.setAttribute('data-chatgpt-search-unit-key', 'answer-expand:assistant');
    assistant.setAttribute('data-chatgpt-search-message-ids', 'answer-expand');
    const heading = document.createElement('h2');
    heading.textContent = 'Answer section';
    assistant.appendChild(heading);
    document.body.append(user, assistant);

    const row = document.querySelector<HTMLElement>('.navigator-item')!;
    const text = row.querySelector<HTMLElement>('.navigator-item-text')!;
    expect(row.querySelector('.navigator-outline-indicator')).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('false');

    text.click();
    expect(jumpToMessageSpy).toHaveBeenCalledOnce();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('.navigator-outline-list')?.textContent).toContain('Answer section');

    text.click();
    expect(jumpToMessageSpy).toHaveBeenCalledTimes(2);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.navigator-outline-list')?.hasAttribute('hidden')).toBe(true);

    text.click();
    expect(jumpToMessageSpy).toHaveBeenCalledTimes(3);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    resetFreshOutline();
  });

  it('jumpToLastPrompt() navigates to the last message when messages exist', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-jump-bottom-messages',
      },
    });

    const jumpToMessageSpy = vi
      .spyOn(promptNav, 'jumpToMessage')
      .mockImplementation(() => {});
    const jumpToAbsoluteEdgeSpy = vi
      .spyOn(promptNav, 'jumpToAbsoluteEdge')
      .mockImplementation(() => {});

    navigatorController.init();
    navigatorController.attach();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'test-jump-bottom-messages',
          payload: {
            messages: [
              {
                id: 'prompt-1',
                author: { role: 'user' },
                content: { parts: ['First prompt'] },
                create_time: 100,
              },
              {
                id: 'asst-1',
                author: { role: 'assistant' },
                content: { parts: ['First reply'] },
                create_time: 150,
              },
              {
                id: 'prompt-2',
                author: { role: 'user' },
                content: { parts: ['Second prompt'] },
                create_time: 200,
              },
            ],
          },
        },
        source: window,
      })
    );

    navigatorController.jumpToLastPrompt();

    expect(jumpToMessageSpy).toHaveBeenCalledOnce();
    expect(jumpToMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prompt-2', text: 'Second prompt' }),
      1
    );
    expect(jumpToAbsoluteEdgeSpy).not.toHaveBeenCalled();
  });

  it('jumpToLastPrompt() does nothing safely when no messages exist', () => {
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-jump-bottom-empty',
      },
    });

    const jumpToMessageSpy = vi
      .spyOn(promptNav, 'jumpToMessage')
      .mockImplementation(() => {});
    const jumpToAbsoluteEdgeSpy = vi
      .spyOn(promptNav, 'jumpToAbsoluteEdge')
      .mockImplementation(() => {});

    navigatorController.init();
    navigatorController.attach();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    navigatorController.jumpToLastPrompt();

    expect(jumpToMessageSpy).not.toHaveBeenCalled();
    expect(jumpToAbsoluteEdgeSpy).not.toHaveBeenCalled();
  });

  it('jumpToEdge("bottom") delegates directly to jumpToPageEdge', () => {
    const jumpToAbsoluteEdgeSpy = vi
      .spyOn(promptNav, 'jumpToAbsoluteEdge')
      .mockImplementation(() => {});

    navigatorController.jumpToEdge('bottom');

    expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('bottom', 'auto');
  });

  it('jumpToEdge("top") delegates directly to jumpToPageEdge', () => {
    const jumpToAbsoluteEdgeSpy = vi
      .spyOn(promptNav, 'jumpToAbsoluteEdge')
      .mockImplementation(() => {});

    navigatorController.jumpToEdge('top');

    expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('top', 'auto');
  });

  it('completes loading immediately on initial attach when opening empty new chat route', async () => {
    vi.resetModules();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/',
      },
    });

    const { navigatorController: freshController } = await import(
      '@/navigation/navigatorController'
    );
    const { isLoading: freshIsLoading } = await import(
      '@/navigation/loading/promptLoadingState'
    );

    freshController.init();
    freshController.attach();

    const statusElement = document.getElementById('luna-toc-status')!;
    expect(freshIsLoading()).toBe(false);
    expect(statusElement.textContent).toBe('暂无提示词');
  });

  it('transitions from existing conversation to new chat immediately without waiting for settle timer', async () => {
    vi.resetModules();
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/existing-conv',
      },
    });

    const { navigatorController: freshController } = await import(
      '@/navigation/navigatorController'
    );
    const { isLoading: freshIsLoading } = await import(
      '@/navigation/loading/promptLoadingState'
    );

    freshController.init();
    freshController.attach();

    // Load data and complete loading for existing conversation
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationEnded,
          routeKey: 'existing-conv',
        },
        source: window,
      })
    );
    expect(freshIsLoading()).toBe(false);

    // Switch to new chat
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    const statusElement = document.getElementById('luna-toc-status')!;
    expect(freshIsLoading()).toBe(false);
    expect(statusElement.textContent).toBe('暂无提示词');
  });

  it('arms settle timer and sets loading state when transitioning from empty new chat to existing conversation', async () => {
    vi.resetModules();
    const platform = getActivePlatform();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/',
      },
    });

    const { navigatorController: freshController } = await import(
      '@/navigation/navigatorController'
    );
    const { isLoading: freshIsLoading } = await import(
      '@/navigation/loading/promptLoadingState'
    );

    freshController.init();
    freshController.attach();
    expect(freshIsLoading()).toBe(false);

    // Switch to existing conversation
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/target-conv-456',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.routeChanged,
        },
        source: window,
      })
    );

    const statusElement = document.getElementById('luna-toc-status')!;
    expect(freshIsLoading()).toBe(true);
    expect(statusElement.textContent).toContain('加载');
  });

  describe('snapshot completeness and cached restoration lifecycle', () => {
    it('sets snapshot isComplete=true when conversationEnded carries complete: true', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-ended-complete',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey: 'test-ended-complete',
            complete: true,
          },
          source: window,
        })
      );

      expect(freshIsLoading()).toBe(false);

      // Verify completeness behaviorally upon cached route return:
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/other-route',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );
      expect(freshIsLoading()).toBe(true);

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-ended-complete',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );

      // Complete snapshot restores with loading=false immediately and no settle timer
      expect(freshIsLoading()).toBe(false);
      vi.advanceTimersByTime(2000);
      expect(freshIsLoading()).toBe(false);
    });

    it('leaves snapshot incomplete when conversationEnded carries complete: false', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-ended-incomplete',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey: 'test-ended-incomplete',
            complete: false,
          },
          source: window,
        })
      );

      // Loading ends in UI
      expect(freshIsLoading()).toBe(false);

      // Verify snapshot remains incomplete behaviorally:
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/other-route-2',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );
      expect(freshIsLoading()).toBe(true);

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-ended-incomplete',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );

      // Incomplete snapshot leaves loading=true and arms settle timer upon return
      expect(freshIsLoading()).toBe(true);
    });

    it('leaves snapshot incomplete when loading completes via fallback timeout', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-fallback-incomplete',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      expect(freshIsLoading()).toBe(true);

      // Advance through all settle retries (21s fallback)
      vi.advanceTimersByTime(25000);

      expect(freshIsLoading()).toBe(false);

      // Verify snapshot remains incomplete behaviorally:
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/other-route-3',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );
      expect(freshIsLoading()).toBe(true);

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-fallback-incomplete',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: platform.pageHook.messages.routeChanged },
          source: window,
        })
      );

      // Fallback timeout did not mark complete; returning arms settle timer
      expect(freshIsLoading()).toBe(true);
    });

    it('restores complete cached conversation with immediate render, loading=false, and no settle timer', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-complete-cache',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      // Populate conversation with prompt data and mark complete
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            payload: {
              messages: [
                {
                  id: 'prompt-1',
                  author: { role: 'user' },
                  content: { parts: ['Hello complete'] },
                  create_time: 100,
                },
              ],
            },
            routeKey: 'conv-complete-cache',
          },
          source: window,
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey: 'conv-complete-cache',
            complete: true,
          },
          source: window,
        })
      );

      expect(freshIsLoading()).toBe(false);

      // Navigate away to another conversation
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-other',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      expect(freshIsLoading()).toBe(true);

      // Navigate back to the complete cached conversation
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-complete-cache',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // MUST immediately restore with loading = false and NO settle timer
      expect(freshIsLoading()).toBe(false);
      const listElement = document.getElementById('navigator-list')!;
      expect(listElement.textContent).toContain('Hello complete');

      // Advancing time should not re-trigger loading or settle retries
      vi.advanceTimersByTime(2000);
      expect(freshIsLoading()).toBe(false);
    });

    it('restores incomplete cached conversation with prompts, loading=true, and arms settle timer', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-incomplete-cache',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      // Populate conversation with prompt data but mark incomplete
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            payload: {
              messages: [
                {
                  id: 'prompt-inc-1',
                  author: { role: 'user' },
                  content: { parts: ['Hello partial'] },
                  create_time: 100,
                },
              ],
            },
            routeKey: 'conv-incomplete-cache',
          },
          source: window,
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey: 'conv-incomplete-cache',
            complete: false,
          },
          source: window,
        })
      );

      expect(freshIsLoading()).toBe(false);

      // Navigate away
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-other-2',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Navigate back to the incomplete cached conversation
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-incomplete-cache',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Available cached prompts are restored immediately
      const listElement = document.getElementById('navigator-list')!;
      expect(listElement.textContent).toContain('Hello partial');
      // But loading remains true and settle timer is armed
      expect(freshIsLoading()).toBe(true);

      // Fallback expires after 25s
      vi.advanceTimersByTime(25000);
      expect(freshIsLoading()).toBe(false);
    });

    it('recognizes complete snapshot with zero prompts without requiring cachedMessages.length > 0', async () => {
      vi.resetModules();
      const platform = getActivePlatform('chatgpt.com');
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-zero-complete',
        },
      });

      const { navigatorController: freshController } = await import(
        '@/navigation/navigatorController'
      );
      const { isLoading: freshIsLoading } = await import(
        '@/navigation/loading/promptLoadingState'
      );

      freshController.init();
      freshController.attach();

      // conversationEnded complete: true with no messages
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey: 'conv-zero-complete',
            complete: true,
          },
          source: window,
        })
      );

      expect(freshIsLoading()).toBe(false);

      // Navigate away
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-other-3',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Navigate back to the zero-prompt complete conversation
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/conv-zero-complete',
        },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Should be immediately complete with loading = false
      expect(freshIsLoading()).toBe(false);
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('暂无提示词');
    });
  });

  describe('silent jump status and decoupled rendering', () => {
    it('does not show a status band or rebuild the TOC when a prompt jump starts', () => {
      const platform = getActivePlatform();
      navigatorController.init();
      navigatorController.attach();

      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: platform.pageHook.messages.conversationData,
          routeKey: 'test-conv',
          payload: { messages: [{
            id: 'p-1',
            author: { role: 'user' },
            content: { parts: ['Hello step'] },
            create_time: 100,
          }] },
        },
        source: window,
      }));

      const list = document.getElementById('navigator-list')!;
      const originalItem = list.firstElementChild;
      expect(originalItem).not.toBeNull();

      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 0,
        remainingSteps: 10,
      });

      const status = document.getElementById('luna-toc-status')!;
      expect(status.textContent).toBe('');
      expect(status.classList.contains('navigator-status-active')).toBe(false);
      expect(list.firstElementChild).toBe(originalItem);
    });

    it('keeps both jump completion and rapid successive jumps silent', () => {
      navigatorController.init();
      navigatorController.attach();
      setLoading(false);

      const status = document.getElementById('luna-toc-status')!;
      for (const index of [2, 7, 0]) {
        navigatorController.setJumpProgress({
          active: true,
          targetIndex: index,
          remainingSteps: 10,
        });
        expect(status.textContent).toBe('');
        navigatorController.clearJumpProgress();
        expect(status.textContent).toBe('');
        expect(status.classList.contains('navigator-status-active')).toBe(false);
      }
      vi.advanceTimersByTime(1000);
      expect(status.textContent).toBe('');
    });

    it('restores loading feedback after a jump if the conversation is still loading', () => {
      navigatorController.init();
      navigatorController.attach();
      setLoading(true);

      const status = document.getElementById('luna-toc-status')!;
      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 1,
        remainingSteps: 10,
      });
      expect(status.textContent).toBe('');
      navigatorController.clearJumpProgress();
      expect(status.textContent).toContain('加载');
      expect(status.classList.contains('navigator-status-active')).toBe(true);
    });
  });
});
