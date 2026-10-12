/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigatorController } from '@/navigation/navigatorController';
import { getActivePlatform } from '@/platforms';
import { isLoading } from '@/navigation/loading/promptLoadingState';

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

    // Message must be preserved in migrated conversation
    expect(list.children.length).toBe(1);
    expect(list.children[0].textContent).toContain('My first prompt in new chat');
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
});
