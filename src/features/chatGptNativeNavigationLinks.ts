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
let nativeProjectIcon: Element | null = null;

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

/** Finds Library by its actual href first, then by its localized navigation label. */
function findLibraryRow(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    'a[href], button, [role="button"], [role="link"]'
  );
  for (const candidate of candidates) {
    if (!isNativeNavigation(candidate) ||
        candidate.closest('[' + PROJECT_ATTRIBUTE + ']')) continue;
    if (candidate instanceof HTMLAnchorElement) {
      try {
        const target = new URL(candidate.href);
        if (target.origin === window.location.origin &&
            target.pathname.replace(/\/$/, '') === '/library') return candidate;
      } catch {
        // Non-URL anchors can still be matched by their accessible label.
      }
    }
    if (LIBRARY_NAMES.has(readLabel(candidate))) return candidate;
  }
  return null;
}

/** Copies the actual Projects icon only from an existing ChatGPT menu item. */
function captureNativeProjectIcon(): void {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[role="menuitem"], [role="menu"] a, [role="menu"] button, ' +
    'nav a, nav button, aside a, aside button'
  );
  for (const candidate of candidates) {
    if (!isNativeNavigation(candidate) ||
        candidate.closest('[' + PROJECT_ATTRIBUTE + ']') ||
        !PROJECT_NAMES.has(readLabel(candidate))) continue;
    const icon = candidate.querySelector('svg, img');
    if (icon) {
      nativeProjectIcon = icon.cloneNode(true) as Element;
      return;
    }
  }
}

/**
 * Mirrors the native icon when ChatGPT renders one. Until then, leave an
 * empty icon slot rather than substituting a different folder symbol.
 */
function syncNativeProjectIcon(shortcut: HTMLAnchorElement): boolean {
  const slot = shortcut.querySelector<HTMLElement>('[data-luna-toc-project-icon-slot]');
  if (!slot || !nativeProjectIcon) return false;
  const markup = nativeProjectIcon.outerHTML;
  if (slot.dataset.nativeProjectIcon === markup) return true;
  slot.replaceChildren(nativeProjectIcon.cloneNode(true));
  slot.dataset.nativeProjectIcon = markup;
  return true;
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

  const oldIcon = shortcut.querySelector('svg, img');
  const slot = document.createElement('span');
  slot.setAttribute('data-luna-toc-project-icon-slot', '');
  slot.setAttribute('aria-hidden', 'true');
  slot.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
    'width:20px;height:20px;flex-shrink:0;';
  if (oldIcon) {
    slot.className = oldIcon.getAttribute('class') || '';
    oldIcon.replaceWith(slot);
  } else {
    shortcut.prepend(slot);
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

/** Restores Explore as a fallback whenever the independent link is absent. */
function restoreExploreProjects(): void {
  for (const [item, display] of hiddenProjects) {
    if (display.value) item.style.setProperty('display', display.value, display.priority);
    else item.style.removeProperty('display');
  }
  hiddenProjects.clear();
}

/** Hides only redundant Explore items when a working native-icon link exists. */
function hideExploreProjects(): void {
  const shortcut = document.querySelector<HTMLAnchorElement>(
    'a[' + PROJECT_ATTRIBUTE + ']'
  );
  if (!shortcut?.isConnected || !syncNativeProjectIcon(shortcut)) {
    restoreExploreProjects();
    return;
  }
  for (const item of hiddenProjects.keys()) {
    if (!item.isConnected) hiddenProjects.delete(item);
  }
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

/** Recreates one Projects link after Library and never leaves both routes hidden. */
function syncProjectShortcut(): void {
  captureNativeProjectIcon();
  const library = findLibraryRow();
  const shortcuts = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[' + PROJECT_ATTRIBUTE + ']')
  );
  const existing = shortcuts.shift();
  shortcuts.forEach((shortcut) => shortcut.remove());

  if (!library || !library.parentElement) {
    existing?.remove();
    restoreExploreProjects();
    return;
  }
  if (existing && existing.previousElementSibling === library) {
    hideExploreProjects();
    return;
  }
  existing?.remove();
  const shortcut = createProjectShortcut(library);
  library.after(shortcut);
  hideExploreProjects();
}

/** Reapplies links and the Projects shortcut when ChatGPT replaces its sidebar. */
export function initializeChatGptNativeNavigationLinks(): void {
  if (observer || !document.body) return;
  observer = new MutationObserver((records) => {
    let navigationChanged = false;
    for (const record of records) {
      const target = record.target instanceof Element
        ? record.target
        : record.target.parentElement;
      const inNavigation = Boolean(
        target && (isNativeNavigation(target) || target.matches(NAVIGATION_AREA))
      );
      if (record.type !== 'childList') {
        if (inNavigation) navigationChanged = true;
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) {
          if (inNavigation) navigationChanged = true;
          continue;
        }
        if (!inNavigation && !node.matches(NAVIGATION_AREA) &&
            !node.querySelector(NAVIGATION_AREA) &&
            !node.matches('[data-testid="create-new-chat-button"]')) continue;
        enhanceTree(node);
        navigationChanged = true;
      }
      if (target instanceof HTMLElement && target.matches(CONTROL_SELECTOR) &&
          Array.from(record.removedNodes).some((node) =>
            node instanceof HTMLAnchorElement && node.hasAttribute(LINK_ATTRIBUTE))) {
        enhanceControl(target);
      }
      if (inNavigation || Array.from(record.removedNodes).some((node) =>
        node instanceof Element &&
        (node.matches(NAVIGATION_AREA) || Boolean(node.querySelector(NAVIGATION_AREA))))) {
        navigationChanged = true;
      }
    }
    if (navigationChanged) syncProjectShortcut();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'aria-label', 'title'],
  });
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
  restoreExploreProjects();
  nativeProjectIcon = null;
}
