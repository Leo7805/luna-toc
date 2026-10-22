/**
 * @vitest-environment jsdom
 * Navigation link and Projects shortcut regression tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  disposeChatGptNativeNavigationLinks,
  initializeChatGptNativeNavigationLinks,
} from '@/features/chatGptNativeNavigationLinks';

const overlay = (element: Element): HTMLAnchorElement | null =>
  element.querySelector('a[data-luna-toc-native-navigation-link]');
const projectShortcut = (): HTMLAnchorElement | null =>
  document.querySelector('a[data-luna-toc-project-shortcut]');

afterEach(() => {
  disposeChatGptNativeNavigationLinks();
  document.body.textContent = '';
});

describe('ChatGPT native sidebar navigation links', () => {
  it('covers localized sidebar buttons and Explore menu items using real routes', () => {
    const names: [string, string][] = [
      ['定时任务', '/scheduled'], ['财物', '/finances'], ['地图', '/maps'],
      ['图像', '/images'], ['GPT', '/gpts'], ['站点', '/sites'],
      ['Plugins', '/plugins'], ['New chat', '/'],
    ];
    document.body.innerHTML =
      '<nav id="stage-slideover-sidebar">' +
      names.map(([name], i) => '<button id="destination-' + i + '" aria-label="' + name + '"></button>').join('') +
      '</nav><div role="menu"><div role="menuitem" id="projects" aria-label="项目">项目</div>' +
      '<div role="menuitem" id="finance" aria-label="Finances">Finances</div></div>';
    initializeChatGptNativeNavigationLinks();
    names.forEach(([, path], i) => {
      expect(overlay(document.getElementById('destination-' + i)!)?.pathname).toBe(path);
    });
    expect(overlay(document.getElementById('finance')!)?.pathname).toBe('/finances');
    expect(overlay(document.getElementById('projects')!)?.pathname).toBe('/projects');
  });

  it('does not add anchors to existing links, dialogs, disabled or unrelated controls', () => {
    document.body.innerHTML = [
      '<nav><a href="/images"><button id="linked" aria-label="Images">Images</button></a>',
      '<button id="search" aria-label="Search chats" aria-haspopup="dialog"></button>',
      '<button id="expand" aria-label="Projects" aria-expanded="false"></button>',
      '<button id="disabled" aria-label="Maps" disabled></button></nav>',
      '<main><button id="unrelated" aria-label="Maps"></button></main>',
      '<aside id="luna-toc-sidebar"><button id="owned" aria-label="Maps"></button></aside>',
    ].join('');
    initializeChatGptNativeNavigationLinks();
    for (const id of ['linked', 'search', 'expand', 'disabled', 'unrelated', 'owned']) {
      expect(overlay(document.getElementById(id)!)).toBeNull();
    }
  });

  it('keeps plain left clicks, but leaves modified clicks and context menus to the browser', () => {
    document.body.innerHTML = '<nav><button id="image" aria-label="Images">Images</button></nav>';
    initializeChatGptNativeNavigationLinks();
    const control = document.getElementById('image')!;
    const anchor = overlay(control)!;
    let clicks = 0;
    control.addEventListener('click', () => clicks++);
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(true);
    expect(clicks).toBe(1);

    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    anchor.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(clicks).toBe(1);

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('uses the real Explore icon, places Projects below Library, and restores the original if Library disappears', async () => {
    document.body.innerHTML =
      '<nav id="stage-slideover-sidebar">' +
      '<a id="library" href="/library" class="native-nav-item"><svg><path d="M0 0"/></svg><span>资料库</span></a>' +
      '<a id="other" href="/recent">最近</a></nav>' +
      '<div role="menu"><a role="menuitem" id="explore-project" href="/projects">' +
      '<svg viewBox="0 0 24 24"><path d="M3 7 L12 2 L21 7"/></svg><span>项目</span></a>' +
      '<a role="menuitem" id="explore-sites" href="/sites">站点</a></div>';
    initializeChatGptNativeNavigationLinks();
    const projects = projectShortcut()!;
    expect(projects.href).toContain('/projects');
    expect(projects.previousElementSibling).toBe(document.getElementById('library'));
    expect(projects.nextElementSibling).toBe(document.getElementById('other'));
    expect(projects.textContent).toBe('项目');
    expect(projects.className).toBe('native-nav-item');
    expect(projects.querySelector('svg path')?.getAttribute('d')).toBe('M3 7 L12 2 L21 7');
    expect(document.getElementById('explore-project')?.style.display).toBe('none');
    expect(document.getElementById('explore-sites')?.style.display).toBe('');

    document.getElementById('library')!.remove();
    await Promise.resolve();
    expect(projectShortcut()).toBeNull();
    expect(document.getElementById('explore-project')?.style.display).toBe('');

    const replacement = document.createElement('a');
    replacement.href = '/library';
    replacement.textContent = '资料库';
    document.getElementById('stage-slideover-sidebar')!.prepend(replacement);
    await Promise.resolve();
    expect(projectShortcut()?.previousElementSibling).toBe(replacement);
    expect(projectShortcut()?.querySelector('svg path')?.getAttribute('d'))
      .toBe('M3 7 L12 2 L21 7');
    expect(document.getElementById('explore-project')?.style.display).toBe('none');

    disposeChatGptNativeNavigationLinks();
    expect(projectShortcut()).toBeNull();
    expect(document.getElementById('explore-project')?.style.display).toBe('');
  });

  it('keeps Explore Projects available until the genuine icon is present', async () => {
    document.body.innerHTML =
      '<nav id="sidebar"><a href="/library" aria-label="Library">Library</a></nav>' +
      '<div role="menu"><a role="menuitem" id="explore-project">Projects</a></div>';
    initializeChatGptNativeNavigationLinks();
    expect(projectShortcut()).not.toBeNull();
    expect(projectShortcut()?.querySelector('svg')).toBeNull();
    expect(document.getElementById('explore-project')?.style.display).toBe('');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.innerHTML = '<path d="M5 10 L20 10"/>';
    document.getElementById('explore-project')!.prepend(icon);
    await Promise.resolve();
    expect(projectShortcut()?.querySelector('svg path')?.getAttribute('d'))
      .toBe('M5 10 L20 10');
    expect(document.getElementById('explore-project')?.style.display).toBe('none');
  });

  it('rebuilds the Projects shortcut after a sidebar remount', async () => {
    document.body.innerHTML =
      '<nav id="stage-slideover-sidebar"><a href="/library">Library</a></nav>';
    initializeChatGptNativeNavigationLinks();
    expect(projectShortcut()).not.toBeNull();

    const newNavigation = document.createElement('nav');
    newNavigation.id = 'stage-slideover-sidebar';
    newNavigation.innerHTML = '<a href="/library">Library</a>';
    document.getElementById('stage-slideover-sidebar')!.replaceWith(newNavigation);
    await Promise.resolve();
    expect(document.querySelectorAll('a[data-luna-toc-project-shortcut]')).toHaveLength(1);
    expect(projectShortcut()?.previousElementSibling).toBe(newNavigation.firstElementChild);
  });

  it('links late-mounted popovers without duplicating overlays', async () => {
    document.body.innerHTML = '<nav id="sidebar"></nav>';
    initializeChatGptNativeNavigationLinks();
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.textContent = '站点';
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.append(item);
    document.body.append(menu);
    await Promise.resolve();
    expect(overlay(item)?.pathname).toBe('/sites');
    expect(item.querySelectorAll('a[data-luna-toc-native-navigation-link]')).toHaveLength(1);
  });
});
