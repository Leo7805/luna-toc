/**
 * @vitest-environment jsdom
 * Regression tests for native browser links on ChatGPT navigation buttons.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  disposeChatGptNativeNavigationLinks,
  initializeChatGptNativeNavigationLinks,
} from '@/features/chatGptNativeNavigationLinks';

const getLink = (button: Element): HTMLAnchorElement | null =>
  button.querySelector('a[data-luna-toc-native-navigation-link]');

afterEach(() => {
  disposeChatGptNativeNavigationLinks();
  document.body.textContent = '';
});

describe('native ChatGPT sidebar destination links', () => {
  it('creates addressable links but skips disclosure, dialogs and unrelated buttons', () => {
    document.body.innerHTML = [
      '<nav id="stage-slideover-sidebar">',
      '<button id="new" data-testid="create-new-chat-button">新建聊天</button>',
      '<button id="images" aria-label="图片">图片</button>',
      '<button id="library" aria-label="Library">Library</button>',
      '<button id="plugins" aria-label="Plugins">Plugins</button>',
      '<button id="gpts" aria-label="Explore GPTs">Explore GPTs</button>',
      '<button id="search" aria-label="Search chats" aria-haspopup="dialog">Search chats</button>',
      '<button id="projects" aria-label="Projects" aria-expanded="false">Projects</button>',
      '<a href="/images"><button id="linked" aria-label="Images">Images</button></a>',
      '<button id="disabled" aria-label="Images" disabled>Images</button>',
      '</nav>',
      '<main><button id="unrelated" aria-label="New chat">New chat</button></main>',
      '<aside id="luna-toc-sidebar"><button id="owned" aria-label="Images">Images</button></aside>',
    ].join('');
    initializeChatGptNativeNavigationLinks();
    expect(getLink(document.getElementById('new')!)?.pathname).toBe('/');
    expect(getLink(document.getElementById('images')!)?.pathname).toBe('/images');
    expect(getLink(document.getElementById('library')!)?.pathname).toBe('/library');
    expect(getLink(document.getElementById('plugins')!)?.pathname).toBe('/plugins');
    expect(getLink(document.getElementById('gpts')!)?.pathname).toBe('/gpts');
    for (const id of ['search', 'projects', 'linked', 'disabled', 'unrelated', 'owned']) {
      expect(getLink(document.getElementById(id)!)).toBeNull();
    }
  });

  it('preserves ordinary host click handlers and avoids opening the link in the same tab', () => {
    document.body.innerHTML = '<nav><button aria-label="New chat" id="new">New chat</button></nav>';
    initializeChatGptNativeNavigationLinks();
    const button = document.getElementById('new')!;
    const link = getLink(button)!;
    let hostClicks = 0;
    button.addEventListener('click', () => hostClicks++);
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(true);
    expect(hostClicks).toBe(1);

    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(hostClicks).toBe(1);

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    link.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('handles asynchronously mounted navigation and remains idempotent', async () => {
    document.body.innerHTML = '<nav id="sidebar"></nav>';
    initializeChatGptNativeNavigationLinks();
    initializeChatGptNativeNavigationLinks();
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Images');
    document.getElementById('sidebar')!.append(button);
    await Promise.resolve();
    expect(button.querySelectorAll('a[data-luna-toc-native-navigation-link]')).toHaveLength(1);
    disposeChatGptNativeNavigationLinks();
    expect(getLink(button)).toBeNull();
    expect(button.style.position).toBe('');
  });
});
