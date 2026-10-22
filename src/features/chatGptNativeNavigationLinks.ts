/**
 * Makes ChatGPT's destination-only sidebar controls act like native links,
 * and mirrors Projects immediately below Library without moving React nodes.
 */
const LINK_ATTRIBUTE = 'data-luna-toc-native-navigation-link';
const PROJECT_ATTRIBUTE = 'data-luna-toc-project-shortcut';
const NAVIGATION_AREA = [
  '#stage-slideover-sidebar', '#sidebar', '[data-testid*="sidebar"]',
  'nav', 'aside', '[role="menu"]', '[role="menubar"]',
  '[data-radix-menu-content]', '[data-radix-popper-content-wrapper]',
].join(', ');
const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="link"]';
const LIBRARY_NAMES = new Set(['library', '资料库', '文件库']);
const PROJECT_NAMES = new Set(['projects', 'project', '项目']);

const DESTINATIONS: Readonly<Record<string, string>> = {
  'new chat': '/',
  '新建聊天': '/',
  '新聊天': '/',
  '新对话': '/',
  'library': '/library',
  '资料库': '/library',
  '文件库': '/library',
  'scheduled': '/scheduled',
  'scheduled tasks': '/scheduled',
  'automations': '/scheduled',
  'tasks': '/scheduled',
  '定时任务': '/scheduled',
  '计划任务': '/scheduled',
  '任务': '/scheduled',
  'projects': '/projects',
  'project': '/projects',
  '项目': '/projects',
  'finances': '/finances',
  'finance': '/finances',
  '财务': '/finances',
  '财物': '/finances',
  '金融': '/finances',
  'maps': '/maps',
  'map': '/maps',
  '地图': '/maps',
  'images': '/images',
  'image': '/images',
  'create image': '/images',
  '图片': '/images',
  '图像': '/images',
  'gpts': '/gpts',
  'gpt': '/gpts',
  'explore gpts': '/gpts',
  '探索 gpts': '/gpts',
  '探索gpts': '/gpts',
  'sites': '/sites',
  'site': '/sites',
  '站点': '/sites',
  '网站': '/sites',
  'plugins': '/plugins',
  '插件': '/plugins',
};

let observer: MutationObserver | null = null;
const originalPositions = new Map<HTMLElement, string>();
const hiddenProjects = new Map<HTMLElement, { value: string; priority: string }>();

/** Normalizes localized labels while ignoring a trailing new-feature badge. */
function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
    .replace(/\s+/g, ' ').replace(/(?:\s+new|\s+新)$/i, '');
}

/** Reads a control's accessible name without concatenating nested tooltips. */
function readLabel(element: Element): string {
  return normalizeLabel(
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.textContent || ''
  );
}

/** Returns true only for ChatGPT navigation, not LunaTOC or chat content. */
function isNativeNavigation(element: Element): boolean {
  if (element.closest('#luna-toc-sidebar, #luna-toc-react-host, [id^="luna-toc-"], [' +
      PROJECT_ATTRIBUTE + ']')) return false;
  return element.matches('[data-testid="create-new-chat-button"]') ||
    Boolean(element.closest(NAVIGATION_AREA));
}

/** Finds a direct destination and leaves disclosure/dialog controls untouched. */
function getDestination(control: HTMLElement): string | null {
  if (!isNativeNavigation(control) ||
      control.closest('a[href], [' + LINK_ATTRIBUTE + ']') ||
      control.hasAttribute('disabled') ||
      control.getAttribute('aria-disabled') === 'true' ||
      control.hasAttribute('aria-haspopup') ||
      control.hasAttribute('aria-expanded')) return null;

  if (control.dataset.testid === 'create-new-chat-button') return '/';
  return DESTINATIONS[readLabel(control)] ?? null;
}

/** Adds a real anchor overlay while retaining the original plain-left-click. */
function enhanceControl(control: HTMLElement): void {
  if (control.querySelector('a[' + LINK_ATTRIBUTE + ']')) return;
  const destination = getDestination(control);
  if (!destination) return;

  const anchor = document.createElement('a');
  anchor.href = new URL(destination, window.location.origin).href;
  anchor.setAttribute(LINK_ATTRIBUTE, '');
  anchor.setAttribute('aria-hidden', 'true');
  anchor.tabIndex = -1;
  anchor.draggable = false;
  anchor.style.cssText =
    'position:absolute!important;inset:0!important;display:block!important;' +
    'z-index:2147483647!important;background:transparent!important;' +
    'border-radius:inherit!important;';

  anchor.addEventListener('click', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey &&
        !event.shiftKey && !event.altKey) {
      event.preventDefault();
    } else {
      event.stopPropagation();
    }
  });
  anchor.addEventListener('auxclick', (event) => event.stopPropagation());
  anchor.addEventListener('contextmenu', (event) => event.stopPropagation());

  if (getComputedStyle(control).position === 'static') {
    originalPositions.set(control, control.style.position);
    control.style.position = 'relative';
  }
  control.append(anchor);
}

/** Enhances only controls in mounted native navigation or popover content. */
function enhanceTree(root: Document | Element): void {
  if (root instanceof HTMLElement && root.matches(CONTROL_SELECTOR)) enhanceControl(root);
  root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach(enhanceControl);
}

/** Locates the existing Library row to copy its active ChatGPT visual style. */
function findLibraryRow(): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    'nav a, nav button, nav [role="button"], ' +
    'aside a, aside button, aside [role="button"], ' +
    '#stage-slideover-sidebar a, #stage-slideover-sidebar button, ' +
    '#sidebar a, #sidebar button, [data-testid*="sidebar"] a, ' +
    '[data-testid*="sidebar"] button'
  );
  for (const node of nodes) {
    if (!isNativeNavigation(node) || node.closest('[' + PROJECT_ATTRIBUTE + ']')) continue;
    if (LIBRARY_NAMES.has(readLabel(node))) return node;
  }
  return null;
}

/** Builds a standalone Projects anchor styled like the native Library row. */
function createProjectShortcut(library: HTMLElement): HTMLAnchorElement {
  const shortcut = document.createElement('a');
  shortcut.className = library.className;
  shortcut.href = new URL('/projects', window.location.origin).href;
  shortcut.setAttribute(PROJECT_ATTRIBUTE, '');
  const label = /资料库|文件库/.test(readLabel(library)) ? '项目' : 'Projects';
  shortcut.setAttribute('aria-label', label);
  shortcut.setAttribute('title', label);

  for (const child of Array.from(library.childNodes)) shortcut.append(child.cloneNode(true));
  shortcut.querySelectorAll('button, a, input, select').forEach((node) => node.remove());
  shortcut.querySelectorAll<HTMLElement>('[id], [data-testid], [aria-controls], [aria-expanded], [aria-current]')
    .forEach((node) => {
      for (const attribute of ['id', 'data-testid', 'aria-controls', 'aria-expanded', 'aria-current']) {
        node.removeAttribute(attribute);
      }
    });

  const icon = shortcut.querySelector('svg');
  if (icon) {
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.innerHTML =
      '<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/>';
  }

  const walker = document.createTreeWalker(shortcut, NodeFilter.SHOW_TEXT);
  let renamed = false;
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (LIBRARY_NAMES.has(normalizeLabel(textNode.textContent || ''))) {
      textNode.textContent = label;
      renamed = true;
    }
  }
  if (!renamed) {
    const text = document.createElement('span');
    text.textContent = label;
    shortcut.append(text);
  }
  return shortcut;
}

/** Hides just the redundant Projects destination inside the Explore menu. */
function hideExploreProjects(): void {
  if (!document.querySelector('a[' + PROJECT_ATTRIBUTE + ']')) return;
  const items = document.querySelectorAll<HTMLElement>(
    '[role="menu"] [role="menuitem"], [role="menu"] a, ' +
    '[data-radix-menu-content] [role="menuitem"], ' +
    '[data-testid*="explore"] [role="menuitem"]'
  );
  for (const item of items) {
    if (item.closest('[' + PROJECT_ATTRIBUTE + ']') ||
        !PROJECT_NAMES.has(readLabel(item)) || hiddenProjects.has(item)) continue;
    hiddenProjects.set(item, {
      value: item.style.getPropertyValue('display'),
      priority: item.style.getPropertyPriority('display'),
    });
    item.style.setProperty('display', 'none', 'important');
  }
}

/** Keeps one Projects shortcut immediately after Library across SPA remounts. */
function syncProjectShortcut(): void {
  const library = findLibraryRow();
  const shortcuts = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[' + PROJECT_ATTRIBUTE + ']')
  );
  const existing = shortcuts.shift();
  shortcuts.forEach((shortcut) => shortcut.remove());

  if (!library || !library.parentElement) {
    existing?.remove();
    return;
  }
  if (existing && existing.previousElementSibling === library) {
    hideExploreProjects();
    return;
  }
  existing?.remove();
  library.after(createProjectShortcut(library));
  hideExploreProjects();
}

/** Reapplies links and the Projects shortcut when ChatGPT replaces its sidebar. */
export function initializeChatGptNativeNavigationLinks(): void {
  if (observer || !document.body) return;
  observer = new MutationObserver((records) => {
    let navigationChanged = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (!node.matches(NAVIGATION_AREA) && !node.closest(NAVIGATION_AREA) &&
            !node.querySelector(NAVIGATION_AREA) &&
            !node.matches('[data-testid="create-new-chat-button"]')) continue;
        enhanceTree(node);
        navigationChanged = true;
      }
      if (record.target instanceof HTMLElement &&
          record.target.matches(CONTROL_SELECTOR) &&
          Array.from(record.removedNodes).some((node) =>
            node instanceof HTMLAnchorElement && node.hasAttribute(LINK_ATTRIBUTE))) {
        enhanceControl(record.target);
      }
      if (Array.from(record.removedNodes).some((node) => node instanceof Element)) {
        navigationChanged = true;
      }
    }
    if (navigationChanged) syncProjectShortcut();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhanceTree(document);
  syncProjectShortcut();
}

/** Removes every link and restores host styles when the feature is disposed. */
export function disposeChatGptNativeNavigationLinks(): void {
  observer?.disconnect();
  observer = null;
  document.querySelectorAll('a[' + LINK_ATTRIBUTE + '], a[' + PROJECT_ATTRIBUTE + ']')
    .forEach((link) => link.remove());
  for (const [element, position] of originalPositions) {
    if (element.style.position === 'relative') element.style.position = position;
  }
  originalPositions.clear();
  for (const [element, display] of hiddenProjects) {
    if (display.value) element.style.setProperty('display', display.value, display.priority);
    else element.style.removeProperty('display');
  }
  hiddenProjects.clear();
}
