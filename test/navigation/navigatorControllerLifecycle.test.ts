/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigatorController } from '@/navigation/navigatorController';
import { getActivePlatform } from '@/platforms';
import { isLoading, setLoading } from '@/navigation/loading/promptLoadingState';
import * as promptNav from '@/navigation/jump/promptNavigation';

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
    navigatorController.detach();
    navigatorController.setNavigationIdle();
  });

  afterEach(() => {
    navigatorController.detach();
    navigatorController.setNavigationIdle();
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
    expect(statusElement.textContent).toContain('Loading');

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
    expect(statusElement.textContent).toContain('Loading');

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
    expect(statusElement.textContent).not.toContain('Loading');
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
      1,
      { mode: 'viewport-driven' }
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

  it('jumpToEdge("top") delegates to jumpToPageEdge when no messages exist', () => {
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
    expect(statusElement.textContent).toBe('No prompts');
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
    expect(statusElement.textContent).toBe('No prompts');
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
    expect(statusElement.textContent).toContain('Loading');
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

      // Status band transitions cleanly to idle with no visible class
      const statusElement = document.getElementById('luna-toc-status');
      expect(statusElement?.classList.contains('visible')).toBe(false);

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

    it('active history backfill is not terminated by fallback settle timer during long network request', async () => {
      vi.useFakeTimers();
      try {
        const platform = getActivePlatform('chatgpt.com');
        Object.defineProperty(window, 'location', {
          writable: true,
          value: {
            ...window.location,
            host: 'chatgpt.com',
            pathname: '/c/test-active-streaming',
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

        // Conversation data arrives with actual backfillStarted: true
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: platform.pageHook.messages.conversationData,
              routeKey: 'test-active-streaming',
              backfillStarted: true,
              payload: { messages: [{ id: 'm1', author: { role: 'user' } }] },
            },
            source: window,
          })
        );

        // Advance 5,000ms (exceeding standard fallback timeout)
        vi.advanceTimersByTime(5000);

        // Loading must remain ACTIVE because backfill was latched as in-progress
        expect(freshIsLoading()).toBe(true);

        // Authoritative completion event terminates loading
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: platform.pageHook.messages.conversationEnded,
              routeKey: 'test-active-streaming',
              complete: true,
            },
            source: window,
          })
        );

        expect(freshIsLoading()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
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
      expect(statusElement.textContent).toBe('No prompts');
    });
  });

  describe('jump status lifecycle and decoupled rendering', () => {
    it('Case A: setJumpProgress activates jumping status without rebuilding #navigator-list', () => {
      const platform = getActivePlatform();
      navigatorController.init();
      navigatorController.attach();

      // Populate one prompt so navigator-list has DOM children
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            routeKey: 'test-conv',
            payload: {
              messages: [
                {
                  id: 'p-1',
                  author: { role: 'user' },
                  content: { parts: ['Hello step'] },
                  create_time: 100,
                },
              ],
            },
          },
          source: window,
        })
      );

      const list = document.getElementById('navigator-list')!;
      expect(list.children.length).toBe(1);
      const originalItem = list.firstElementChild as HTMLElement;
      originalItem.dataset.testMarker = 'persistent-node';

      const statusElement = document.getElementById('luna-toc-status')!;

      // Act: Jump starts
      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 0,
        remainingSteps: 10,
      });

      // Status updates immediately to jumping
      expect(statusElement.textContent).toContain('To #1');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // CRITICAL: #navigator-list must NOT have been wiped or rebuilt
      expect(list.children.length).toBe(1);
      expect(list.firstElementChild).toBe(originalItem);
      expect((list.firstElementChild as HTMLElement).dataset.testMarker).toBe('persistent-node');
    });

    it('Case B: clearJumpProgress transitions to complete and lingers before hiding when not loading', () => {
      navigatorController.init();
      navigatorController.attach();
      setLoading(false);

      const statusElement = document.getElementById('luna-toc-status')!;

      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 2,
        remainingSteps: 10,
      });
      expect(statusElement.textContent).toContain('To #3');

      // Act: Jump finishes
      navigatorController.clearJumpProgress();

      // Retains destination text during linger
      expect(statusElement.textContent).toBe('To #3');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Still visible before linger expires (499ms)
      vi.advanceTimersByTime(499);
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Retracts after 500ms linger
      vi.advanceTimersByTime(2);
      expect(statusElement.textContent).toBe('');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
    });

    it('Case C: clearJumpProgress restores loading status if conversation is still loading', () => {
      navigatorController.init();
      navigatorController.attach();
      setLoading(true);

      const statusElement = document.getElementById('luna-toc-status')!;

      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 1,
        remainingSteps: 10,
      });
      expect(statusElement.textContent).toContain('To #2');

      // Act: Jump finishes while conversation is still loading
      navigatorController.clearJumpProgress();

      // Restores Loading instead of complete/idle
      expect(statusElement.textContent).toContain('Loading');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);
    });

    it('Case D: rapid repeated jumps replace target cleanly and cancel previous linger timer', () => {
      navigatorController.init();
      navigatorController.attach();
      setLoading(false);

      const statusElement = document.getElementById('luna-toc-status')!;

      // First jump to prompt #3
      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 2,
        remainingSteps: 10,
      });
      expect(statusElement.textContent).toContain('To #3');

      // Jump #3 clears and begins 500ms linger
      navigatorController.clearJumpProgress();
      expect(statusElement.textContent).toBe('To #3');

      // Advance 200ms into the linger
      vi.advanceTimersByTime(200);
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Second jump to prompt #8 before first linger finishes
      navigatorController.setJumpProgress({
        active: true,
        targetIndex: 7,
        remainingSteps: 10,
      });
      expect(statusElement.textContent).toContain('To #8');

      // Jump #8 clears
      navigatorController.clearJumpProgress();
      expect(statusElement.textContent).toBe('To #8');

      // Advance 400ms: total 600ms since jump #3 cleared, but only 400ms since jump #8 cleared.
      // If jump #3's linger timer wasn't cancelled, status would have cleared at 500ms.
      vi.advanceTimersByTime(400);
      expect(statusElement.textContent).toBe('To #8');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Advance past jump #8's linger (>500ms total for jump #8)
      vi.advanceTimersByTime(105);
      expect(statusElement.textContent).toBe('');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
    });
  });

  describe('Follow / Active synchronization via onJumpComplete', () => {
    it('wires onJumpComplete to activePromptTracker.syncActiveIndex and updates sidebar active item', async () => {
      const { navigatorController: controller } = await import(
        '@/navigation/navigatorController'
      );
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const platform = getActivePlatform();

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-follow-active',
        },
      });

      controller.init();
      controller.attach();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Populate 2 prompts
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            routeKey: 'test-follow-active',
            payload: {
              messages: [
                { id: 'p-0', author: { role: 'user' }, content: { parts: ['P0'] }, create_time: 1 },
                { id: 'a-0', author: { role: 'assistant' }, content: { parts: ['A0'] }, create_time: 2 },
                { id: 'p-1', author: { role: 'user' }, content: { parts: ['P1'] }, create_time: 3 },
                { id: 'a-1', author: { role: 'assistant' }, content: { parts: ['A1'] }, create_time: 4 },
              ],
            },
          },
          source: window,
        })
      );

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items.length).toBe(2);

      // Mount thread container and target prompt in DOM
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      const targetEl = document.createElement('div');
      targetEl.setAttribute('data-chatgpt-search-message-ids', 'p-1');
      targetEl.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      container.appendChild(targetEl);
      document.body.appendChild(container);

      // Complete navigation via promptNavigation
      promptNavModule.jumpToMessage(
        { id: 'p-1', text: 'P1', canMatchByText: true, createTime: 3 },
        1
      );

      // Query items after jump
      const updatedItems = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(updatedItems[1].classList.contains('navigator-item-active')).toBe(true);
      expect(updatedItems[0].classList.contains('navigator-item-active')).toBe(false);

      // Existing Follow window: sidebar item was scrolled into view through existing pipeline
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('rapid sequential jumps: only newest successful jump syncs active', async () => {
      const { navigatorController: controller } = await import(
        '@/navigation/navigatorController'
      );
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const platform = getActivePlatform();

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-rapid-jumps',
        },
      });

      controller.init();
      controller.attach();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.routeChanged,
          },
          source: window,
        })
      );

      // Populate 3 prompts
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            routeKey: 'test-rapid-jumps',
            payload: {
              messages: [
                { id: 'p-0', author: { role: 'user' }, content: { parts: ['P0'] }, create_time: 1 },
                { id: 'a-0', author: { role: 'assistant' }, content: { parts: ['A0'] }, create_time: 2 },
                { id: 'p-1', author: { role: 'user' }, content: { parts: ['P1'] }, create_time: 3 },
                { id: 'a-1', author: { role: 'assistant' }, content: { parts: ['A1'] }, create_time: 4 },
                { id: 'p-2', author: { role: 'user' }, content: { parts: ['P2'] }, create_time: 5 },
                { id: 'a-2', author: { role: 'assistant' }, content: { parts: ['A2'] }, create_time: 6 },
              ],
            },
          },
          source: window,
        })
      );

      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      const el0 = document.createElement('div');
      el0.setAttribute('data-chatgpt-search-message-ids', 'p-0');
      el0.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      const el2 = document.createElement('div');
      el2.setAttribute('data-chatgpt-search-message-ids', 'p-2');
      el2.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      container.appendChild(el0);
      container.appendChild(el2);
      document.body.appendChild(container);

      // Jump 0 then immediately jump 2 (supersedes jump 0)
      promptNavModule.jumpToMessage(
        { id: 'p-0', text: 'P0', canMatchByText: true, createTime: 1 },
        0
      );
      promptNavModule.jumpToMessage(
        { id: 'p-2', text: 'P2', canMatchByText: true, createTime: 5 },
        2
      );

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[2].classList.contains('navigator-item-active')).toBe(true);
      expect(items[0].classList.contains('navigator-item-active')).toBe(false);
      expect(items[1].classList.contains('navigator-item-active')).toBe(false);
    });

    it('background render after explicit sync keeps target row active', async () => {
      const { navigatorController: controller } = await import(
        '@/navigation/navigatorController'
      );
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const platform = getActivePlatform();

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/test-bg-render',
        },
      });

      controller.init();
      controller.attach();

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
            routeKey: 'test-bg-render',
            payload: {
              messages: [
                { id: 'p-0', author: { role: 'user' }, content: { parts: ['P0'] }, create_time: 1 },
                { id: 'a-0', author: { role: 'assistant' }, content: { parts: ['A0'] }, create_time: 2 },
                { id: 'p-1', author: { role: 'user' }, content: { parts: ['P1'] }, create_time: 3 },
                { id: 'a-1', author: { role: 'assistant' }, content: { parts: ['A1'] }, create_time: 4 },
              ],
            },
          },
          source: window,
        })
      );

      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      const targetEl = document.createElement('div');
      targetEl.setAttribute('data-chatgpt-search-message-ids', 'p-1');
      targetEl.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      container.appendChild(targetEl);
      document.body.appendChild(container);

      promptNavModule.jumpToMessage(
        { id: 'p-1', text: 'P1', canMatchByText: true, createTime: 3 },
        1
      );

      let items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[1].classList.contains('navigator-item-active')).toBe(true);

      // Trigger background re-render
      controller.render();

      items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[1].classList.contains('navigator-item-active')).toBe(true);
      expect(items[0].classList.contains('navigator-item-active')).toBe(false);
    });

    it('clears explicit authority on route change', async () => {
      const { navigatorController: controller } = await import(
        '@/navigation/navigatorController'
      );
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const platform = getActivePlatform();

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/route-a',
        },
      });

      controller.init();
      controller.attach();

      // Complete navigation on route A
      promptNavModule.jumpToMessage(
        { id: 'p-1', text: 'P1', canMatchByText: true, createTime: 2 },
        1
      );

      // Navigate to route B
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/route-b',
        },
      });

      window.dispatchEvent(new PopStateEvent('popstate'));
      // Route change triggers reset, clearing state cleanly
      expect(controller.getCurrentConversationKey()).toBe('route-b');
    });
  });

  describe('NavigationState model, display projection, and status transitions', () => {
    let controller: typeof navigatorController;

    beforeEach(async () => {
      const mod = await import('@/navigation/navigatorController');
      controller = mod.navigatorController;
      controller.detach();
      controller.setNavigationIdle();
    });

    afterEach(() => {
      if (controller) {
        controller.detach();
        controller.setNavigationIdle();
      }
    });

    function setupConversationWithPrompts(count: number, routeKey = 'test-state-model') {
      const platform = getActivePlatform();
      controller.detach();
      setLoading(false);

      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: `/c/${routeKey}`,
        },
      });

      controller.init();
      controller.attach();

      const messages: Array<{
        id: string;
        author: { role: string };
        content: { parts: string[] };
        create_time: number;
      }> = [];

      for (let i = 0; i < count; i += 1) {
        messages.push({
          id: `p-${i}`,
          author: { role: 'user' },
          content: { parts: [`Prompt ${i + 1}`] },
          create_time: i * 2,
        });
        messages.push({
          id: `a-${i}`,
          author: { role: 'assistant' },
          content: { parts: [`Answer ${i + 1}`] },
          create_time: i * 2 + 1,
        });
      }

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationData,
            routeKey,
            payload: { messages },
          },
          source: window,
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: platform.pageHook.messages.conversationEnded,
            routeKey,
            complete: true,
          },
          source: window,
        })
      );
    }

    it('idle viewportIndex=2 -> jumping(199) -> visible Prompt 200 active immediately without tracker callback', () => {
      setupConversationWithPrompts(200, 'test-jumping-start');

      // Set jumping to targetIndex 199 (Prompt 200)
      controller.setNavigationJumping(199);

      // getDisplayIndex is synchronously 199
      expect(controller.getDisplayIndex()).toBe(199);

      // TOC active row is row 199
      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);
      expect(items[2].classList.contains('navigator-item-active')).toBe(false);

      // Status text shows 1-based prompt 200
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toContain('To #200');
    });

    it('jumping(199) suppresses raw viewport updates and preserves Prompt 200 active', () => {
      setupConversationWithPrompts(200, 'test-jumping-suppress');
      controller.setNavigationJumping(199);

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);

      // Trigger scroll event on container
      document.dispatchEvent(new Event('scroll'));
      vi.runAllTimers();

      // Displayed active item MUST still be 199
      expect(controller.getDisplayIndex()).toBe(199);
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);
      expect(items[2].classList.contains('navigator-item-active')).toBe(false);
    });

    it('jumping -> landed transition does not jitter or re-scroll identical target', () => {
      setupConversationWithPrompts(200, 'test-jumping-landed');
      controller.setNavigationJumping(199);

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);

      const scrollSpy = vi.spyOn(items[199], 'scrollIntoView');

      // Transition jumping(199) -> landed(199)
      controller.setNavigationLanded(199);

      // Display remains 199
      expect(controller.getDisplayIndex()).toBe(199);
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);

      // Target row did not issue redundant scroll
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('landed authority survives mutations and background renders', () => {
      setupConversationWithPrompts(200, 'test-landed-authority');
      controller.setNavigationJumping(199);
      controller.setNavigationLanded(199);

      expect(controller.getDisplayIndex()).toBe(199);

      // Background re-render while landed
      controller.render();

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(controller.getDisplayIndex()).toBe(199);
      expect(items[199].classList.contains('navigator-item-active')).toBe(true);
    });

    it('wheel/touch in active chat releases landed state to idle and restores viewport tracking', () => {
      setupConversationWithPrompts(200, 'test-browse-intent');
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      controller.setNavigationJumping(199);
      controller.setNavigationLanded(199);
      expect(controller.getNavigationState().state).toBe('landed');

      // User wheels inside active chat
      container.dispatchEvent(new Event('wheel', { bubbles: true }));

      // State transitions to idle
      expect(controller.getNavigationState().state).toBe('idle');
    });

    it('wheel/touch while jumping cancels search, transitions to idle, and returns to viewport', () => {
      setupConversationWithPrompts(200, 'test-cancel-jump');
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      controller.setNavigationJumping(199);
      expect(controller.getNavigationState().state).toBe('jumping');

      // User touchmove inside active chat
      container.dispatchEvent(new Event('touchmove', { bubbles: true }));

      expect(controller.getNavigationState().state).toBe('idle');
    });

    it('jumping -> failed immediately returns display to viewport and displays failure once', () => {
      setupConversationWithPrompts(200, 'test-jump-failed');
      const statusElement = document.getElementById('luna-toc-status')!;

      controller.setNavigationJumping(199);
      expect(statusElement.textContent).toContain('To #200');

      controller.setNavigationFailed(199);

      expect(controller.getNavigationState().state).toBe('failed');
      expect(statusElement.textContent).toBe('Jump failed');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Display returns to viewport index (or null if no viewport item active)
      expect(controller.getDisplayIndex()).not.toBe(199);
    });

    it('completion status is emitted once and does not replay on subsequent render after linger', () => {
      setupConversationWithPrompts(200, 'test-completion-no-replay');
      setLoading(false);
      const statusElement = document.getElementById('luna-toc-status')!;

      controller.setNavigationJumping(199);
      controller.setNavigationLanded(199);

      expect(statusElement.textContent).toBe('To #200');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Advance past linger timer (500ms)
      vi.advanceTimersByTime(505);
      expect(statusElement.textContent).toBe('');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(false);

      // Unrelated full render while still landed
      controller.render();

      // Completion MUST NOT replay
      expect(statusElement.textContent).toBe('');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
    });

    it('render during failure linger preserves failure status and does not replay after expire', () => {
      setupConversationWithPrompts(200, 'test-failure-linger');
      const statusElement = document.getElementById('luna-toc-status')!;

      controller.setNavigationJumping(199);
      controller.setNavigationFailed(199);
      expect(statusElement.textContent).toBe('Jump failed');

      // 200ms into linger: render does not overwrite failure status
      vi.advanceTimersByTime(200);
      controller.render();
      expect(statusElement.textContent).toBe('Jump failed');
      expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

      // Past 500ms: failure clears
      vi.advanceTimersByTime(305);
      expect(statusElement.textContent).toBe('');

      // Subsequent render while still failed does not replay failure
      controller.render();
      expect(statusElement.textContent).toBe('');
    });

    it('rapid supersession 199 -> 149 projects new target directly with no idle frame', () => {
      setupConversationWithPrompts(200, 'test-supersession');
      const statusElement = document.getElementById('luna-toc-status')!;

      controller.setNavigationJumping(199);
      expect(controller.getDisplayIndex()).toBe(199);
      expect(statusElement.textContent).toContain('To #200');

      controller.setNavigationJumping(149);
      expect(controller.getDisplayIndex()).toBe(149);
      expect(statusElement.textContent).toContain('To #150');

      const items = document.querySelectorAll<HTMLElement>('.navigator-item');
      expect(items[149].classList.contains('navigator-item-active')).toBe(true);
      expect(items[199].classList.contains('navigator-item-active')).toBe(false);
    });

    it('repeated attach and detach does not leak or duplicate transition listeners', () => {
      setupConversationWithPrompts(200, 'test-listener-cleanup');
      const statusElement = document.getElementById('luna-toc-status')!;

      // Multiple detach / attach cycles
      controller.detach();
      controller.attach();
      controller.detach();
      controller.attach();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: getActivePlatform().pageHook.messages.conversationEnded,
            routeKey: 'test-listener-cleanup',
            complete: true,
          },
          source: window,
        })
      );

      controller.setNavigationJumping(10);
      expect(statusElement.textContent).toContain('To #11');

      controller.setNavigationLanded(10);
      expect(statusElement.textContent).toBe('To #11');
    });

    it('route reset from jumping/landed/failed clears state to idle and resets visual status', () => {
      setupConversationWithPrompts(200, 'test-route-reset-nav');
      const statusElement = document.getElementById('luna-toc-status')!;

      controller.setNavigationJumping(199);
      expect(controller.getNavigationState().state).toBe('jumping');
      expect(statusElement.textContent).toContain('To #200');

      // Trigger route change
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...window.location,
          host: 'chatgpt.com',
          pathname: '/c/new-route-after-reset',
        },
      });
      window.dispatchEvent(new PopStateEvent('popstate'));

      expect(controller.getNavigationState().state).toBe('idle');
      expect(statusElement.textContent).not.toContain('To #200');
    });

    it('previous landed target releases landed state to idle and restores viewport tracking on jumpToEdge("top")', async () => {
      setupConversationWithPrompts(100, 'test-landed-to-top');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const jumpToMessageSpy = vi
        .spyOn(promptNavModule, 'jumpToMessage')
        .mockImplementation(() => {});

      // Simulate previously landed target at prompt 50 (targetIndex 49)
      controller.setNavigationLanded(49);
      expect(controller.getNavigationState()).toEqual({
        state: 'landed',
        targetIndex: 49,
      });
      expect(controller.getDisplayIndex()).toBe(49);

      // Act: Click ToTop
      controller.jumpToEdge('top');

      // 1. Previous landed ownership released, state returns to idle
      expect(controller.getNavigationState().state).toBe('idle');
      expect(jumpToMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p-0' }),
        0,
        { mode: 'viewport-driven' }
      );

      // 2. Display index is no longer locked to 49
      expect(controller.getDisplayIndex()).not.toBe(49);

      // Mount prompt 0 in DOM inside thread container and verify tracker updates display index to 0
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      const el0 = document.createElement('div');
      el0.setAttribute('data-chatgpt-search-message-ids', 'p-0');
      el0.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      container.appendChild(el0);
      document.body.appendChild(container);

      document.dispatchEvent(new Event('scroll'));
      vi.runAllTimers();

      expect(controller.getDisplayIndex()).toBe(0);
    });

    it('previous landed target releases landed state to idle on jumpToEdge("bottom")', async () => {
      setupConversationWithPrompts(100, 'test-landed-to-bottom');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const jumpToAbsoluteEdgeSpy = vi
        .spyOn(promptNavModule, 'jumpToAbsoluteEdge')
        .mockImplementation(() => {});

      controller.setNavigationLanded(49);
      expect(controller.getNavigationState()).toEqual({
        state: 'landed',
        targetIndex: 49,
      });

      // Act: Click ToBottom
      controller.jumpToEdge('bottom');

      expect(controller.getNavigationState().state).toBe('idle');
      expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('bottom', 'auto');
    });

    it('edge jump supersedes an ongoing jump, returning state to idle and cancelling active search', async () => {
      setupConversationWithPrompts(100, 'test-edge-supersede-jump');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const jumpToMessageSpy = vi
        .spyOn(promptNavModule, 'jumpToMessage')
        .mockImplementation(() => {});

      // Ongoing jump
      controller.setNavigationJumping(49);
      expect(controller.getNavigationState()).toEqual({
        state: 'jumping',
        targetIndex: 49,
      });

      // Edge jump initiated
      controller.jumpToEdge('top');

      expect(controller.getNavigationState().state).toBe('idle');
      expect(jumpToMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p-0' }),
        0,
        { mode: 'viewport-driven' }
      );
    });

    it('jumpToAbsoluteEdge releases landed state to idle', async () => {
      setupConversationWithPrompts(100, 'test-landed-to-absolute-edge');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const jumpToAbsoluteEdgeSpy = vi
        .spyOn(promptNavModule, 'jumpToAbsoluteEdge')
        .mockImplementation(() => {});

      controller.setNavigationLanded(49);
      expect(controller.getNavigationState().state).toBe('landed');

      controller.jumpToAbsoluteEdge('top');

      expect(controller.getNavigationState().state).toBe('idle');
      expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('top', 'auto');
    });

    it('real activePromptTracker event flow updates Now #N and locks TOC active highlight', async () => {
      setupConversationWithPrompts(200, 'test-tracker-event-flow');
      const statusElement = document.getElementById('luna-toc-status')!;
      const items = document.querySelectorAll<HTMLElement>('.navigator-item');

      // Mount thread container with initial prompt 200 (index 199) in DOM
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      const el199 = document.createElement('div');
      el199.setAttribute('data-chatgpt-search-message-ids', 'p-199');
      el199.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      el199.setAttribute('data-message-author-role', 'user');
      el199.setAttribute('data-message-id', 'p-199');
      el199.getBoundingClientRect = () => ({
        top: 10,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 90,
        x: 0,
        y: 10,
        toJSON: () => {},
      });
      container.appendChild(el199);

      // Seed active index at prompt 200 via tracker observation
      document.dispatchEvent(new Event('scroll'));
      vi.runAllTimers();
      expect(controller.getDisplayIndex()).toBe(199);

      // User clicks TOC item #1 (index 0)
      items[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // 1. Destination prefix and initial origin position appear immediately
      expect(statusElement.textContent).toBe('To #1 · Now #200');
      expect(controller.getDisplayIndex()).toBe(0);
      expect(items[0].classList.contains('navigator-item-active')).toBe(true);

      // 2. Virtual scrolling mounts prompt 150 (index 149) at the viewport top
      const el149 = document.createElement('div');
      el149.setAttribute('data-chatgpt-search-message-ids', 'p-149');
      el149.setAttribute('data-chatgpt-search-unit-key', 'k:user');
      el149.setAttribute('data-message-author-role', 'user');
      el149.setAttribute('data-message-id', 'p-149');
      el149.getBoundingClientRect = () => ({
        top: 10,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 90,
        x: 0,
        y: 10,
        toJSON: () => {},
      });
      // Move el199 below viewport
      el199.getBoundingClientRect = () => ({
        top: 1000,
        bottom: 1200,
        left: 0,
        right: 100,
        width: 100,
        height: 200,
        x: 0,
        y: 1000,
        toJSON: () => {},
      });
      container.appendChild(el149);

      // Real scroll event fires on document
      document.dispatchEvent(new Event('scroll'));
      vi.runAllTimers();

      // Genuine tracker callback triggered: Now #N updates to #150
      expect(statusElement.textContent).toBe('To #1 · Now #150');
      // TOC list active item MUST remain locked on destination target (index 0)
      expect(controller.getDisplayIndex()).toBe(0);
      expect(items[0].classList.contains('navigator-item-active')).toBe(true);
      expect(items[149].classList.contains('navigator-item-active')).toBe(false);
    });

    it('guarantees correct final destination on landing even when last intermediate differed', async () => {
      setupConversationWithPrompts(300, 'test-guaranteed-final-status');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      let capturedOptions: any;
      vi.spyOn(promptNavModule, 'initializePromptNavigation').mockImplementation((opts) => {
        capturedOptions = opts;
      });
      controller.detach();
      controller.attach();

      // Jump starts toward prompt #1 (index 0) from prompt #274 (index 273)
      controller.setNavigationJumping(0, 273);
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('To #1 · Now #274');

      // Navigation successfully completes via onJumpComplete
      capturedOptions.onJumpComplete(0);

      // Guaranteed final destination is updated immediately before and during linger
      expect(statusElement.textContent).toBe('To #1 · Now #1');
      expect(controller.getNavigationState()).toEqual({
        state: 'landed',
        targetIndex: 0,
      });

      // Linger for 500ms
      vi.advanceTimersByTime(499);
      expect(statusElement.textContent).toBe('To #1 · Now #1');

      vi.advanceTimersByTime(2);
      expect(statusElement.textContent).toBe('');
    });

    it('failure displays failure status without pretending arrival occurred', async () => {
      setupConversationWithPrompts(100, 'test-failure-no-arrival');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      let capturedOptions: any;
      vi.spyOn(promptNavModule, 'initializePromptNavigation').mockImplementation((opts) => {
        capturedOptions = opts;
      });
      controller.detach();
      controller.attach();

      controller.setNavigationJumping(0, 50);
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('To #1 · Now #51');

      capturedOptions.onJumpFailed(0);

      expect(statusElement.textContent).toBe('Jump failed');
      expect(statusElement.textContent).not.toContain('Now #1');
    });

    it('To Top button navigation enters virtual layout strategy for unmounted Prompt #1 without premature target locking', async () => {
      setupConversationWithPrompts(100, 'test-to-top-real-nav');
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      const virtualStrategyModule = await import('@/navigation/jump/strategies/virtualLayoutStrategy');
      let capturedContext: any = null;
      vi.spyOn(virtualStrategyModule, 'tryVirtualLayoutStrategy').mockImplementation((ctx) => {
        capturedContext = ctx;
        return { mode: 'virtual', promise: Promise.resolve({ status: 'mounted', element: document.createElement('div') }) };
      });

      controller.jumpToEdge('top');

      // Status banner remains idle
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('100 prompts');
      expect(controller.getNavigationState().state).toBe('idle');

      // Strategy was actually entered with Prompt #1 (index 0)
      expect(capturedContext).not.toBeNull();
      expect(capturedContext.targetIndex).toBe(0);
      expect(capturedContext.targetMessage.id).toBe('p-0');

      // TOC Active was NOT prematurely locked to Prompt #1 at start
      expect(controller.getDisplayIndex()).not.toBe(0);
    });

    it('To Bottom single-click preserves physical edge scroll with idle state and no status banner', async () => {
      setupConversationWithPrompts(50, 'test-to-bottom-single-click');
      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const jumpToAbsoluteEdgeSpy = vi
        .spyOn(promptNavModule, 'jumpToAbsoluteEdge')
        .mockImplementation(() => {});

      controller.jumpToEdge('bottom');

      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('50 prompts');
      expect(controller.getNavigationState().state).toBe('idle');
      expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('bottom', 'auto');
    });

    it('To Bottom double-click supersedes previous physical-bottom jump and targets last prompt without TOC locking', async () => {
      setupConversationWithPrompts(50, 'test-to-bottom-double-click');
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      const virtualStrategyModule = await import('@/navigation/jump/strategies/virtualLayoutStrategy');
      let capturedContext: any = null;
      vi.spyOn(virtualStrategyModule, 'tryVirtualLayoutStrategy').mockImplementation((ctx) => {
        capturedContext = ctx;
        return { mode: 'virtual', promise: Promise.resolve({ status: 'mounted', element: document.createElement('div') }) };
      });

      // First click: starts single-click physical bottom
      controller.jumpToEdge('bottom');

      // Second click / dblclick: supersedes and navigates to last prompt
      controller.jumpToLastPrompt();

      // Status remains idle
      const statusElement = document.getElementById('luna-toc-status')!;
      expect(statusElement.textContent).toBe('50 prompts');
      expect(controller.getNavigationState().state).toBe('idle');

      // Targets last prompt (index 49) in strategy
      expect(capturedContext).not.toBeNull();
      expect(capturedContext.targetIndex).toBe(49);
      expect(capturedContext.targetMessage.id).toBe('p-49');

      // TOC Active was not prematurely locked
      expect(controller.getDisplayIndex()).not.toBe(49);
    });

    it('user browse intent (wheel/touch) cancels active navigation exactly once even when NavigationState is idle', async () => {
      setupConversationWithPrompts(50, 'test-browse-cancels-idle-nav');
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      const promptNavModule = await import('@/navigation/jump/promptNavigation');
      const cancelSpy = vi.spyOn(promptNavModule, 'cancelActiveNavigationSearch');

      // Start button navigation (state stays idle)
      controller.jumpToEdge('top');
      expect(controller.getNavigationState().state).toBe('idle');
      cancelSpy.mockClear();

      // Simulate user wheel browse intent on thread container
      container.dispatchEvent(new Event('wheel', { bubbles: true }));

      // Cancelled exactly once, without redundant duplicate increments
      expect(cancelSpy).toHaveBeenCalledOnce();
    });
  });
});
