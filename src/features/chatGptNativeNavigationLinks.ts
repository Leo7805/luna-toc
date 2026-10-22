/**
 * Restores native link context menus on ChatGPT sidebar destination buttons.
 * Controls that open dialogs or toggle disclosure panels are not navigation links.
 */
const SIDEBAR_SELECTOR = '#stage-slideover-sidebar, #sidebar, [data-testid="sidebar"], nav, aside';
const OWN_LINK_ATTRIBUTE = 'data-luna-toc-native-navigation-link';
const ROUTES: Readonly<Record<string, string>> = {
  'new chat': '/',
  '新建聊天': '/',
  '新聊天': '/',
  '新对话': '/',
  'images': '/images',
  '图片': '/images',
  '图像': '/images',
  'library': '/library',
  '资料库': '/library',
  '文件库': '/library',
  'gpts': '/gpts',
  'explore gpts': '/gpts',
  '探索 gpts': '/gpts',
  '插件': '/plugins',
  'plugins': '/plugins',
};

let observer: MutationObserver | null = null;
const enhancedButtons = new Map<HTMLButtonElement, string>();

/** Resolves only known, directly addressable ChatGPT sidebar destinations. */
function getDestination(button: HTMLButtonElement): string | null {
  if (button.disabled || button.closest('a[href]') ||
      button.hasAttribute('aria-haspopup') || button.hasAttribute('aria-expanded') ||
      button.closest('#luna-toc-sidebar, #luna-toc-react-host, [id^="luna-toc-"]')) {
    return null;
  }
  const isNewChat = button.dataset.testid === 'create-new-chat-button';
  if (!isNewChat && !button.closest(SIDEBAR_SELECTOR)) return null;
  if (isNewChat) return '/';

  const label = (
    button.getAttribute('aria-label') ||
    button.getAttribute('title') ||
    button.textContent || ''
  ).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return ROUTES[label] ?? null;
}

/** Adds a transparent anchor without replacing React-owned sidebar buttons. */
function enhanceButton(button: HTMLButtonElement): void {
  if (button.hasAttribute('disabled') || button.querySelector('[' + OWN_LINK_ATTRIBUTE + ']')) return;
  const destination = getDestination(button);
  if (!destination) return;

  // Keep native button behavior for a normal click and keyboard activation.
  // The anchor handles context menus and modified/middle clicks natively.
  const link = document.createElement('a');
  link.href = new URL(destination, window.location.origin).href;
  link.setAttribute(OWN_LINK_ATTRIBUTE, '');
  link.setAttribute('aria-hidden', 'true');
  link.tabIndex = -1;
  link.draggable = false;
  link.style.cssText = 'position:absolute!important;inset:0!important;display:block!important;z-index:2147483647!important;background:transparent!important;border-radius:inherit!important;';
  link.addEventListener('click', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey &&
        !event.shiftKey && !event.altKey) {
      event.preventDefault();
    } else {
      event.stopPropagation();
    }
  });
  link.addEventListener('auxclick', (event) => event.stopPropagation());
  link.addEventListener('contextmenu', (event) => event.stopPropagation());

  if (getComputedStyle(button).position === 'static') {
    enhancedButtons.set(button, button.style.position);
    button.style.position = 'relative';
  }
  button.append(link);
}

/** Inspects newly mounted sidebar navigation without polling or scanning each chat update. */
function enhanceTree(root: Element | Document): void {
  if (root instanceof HTMLButtonElement) enhanceButton(root);
  root.querySelectorAll<HTMLButtonElement>('button').forEach(enhanceButton);
}

/** Observes ChatGPT SPA sidebar replacements and restores native link actions. */
export function initializeChatGptNativeNavigationLinks(): void {
  if (observer || !document.body) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) enhanceTree(node);
      }
      if (record.target instanceof HTMLButtonElement &&
          Array.from(record.removedNodes).some((node) =>
            node instanceof HTMLAnchorElement && node.hasAttribute(OWN_LINK_ATTRIBUTE))) {
        enhanceButton(record.target);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhanceTree(document);
}

/** Disconnects the host observer and removes links installed by this feature. */
export function disposeChatGptNativeNavigationLinks(): void {
  observer?.disconnect();
  observer = null;
  document.querySelectorAll<HTMLAnchorElement>('a[' + OWN_LINK_ATTRIBUTE + ']').forEach((link) => link.remove());
  for (const [button, originalPosition] of enhancedButtons) {
    if (button.style.position === 'relative') button.style.position = originalPosition;
  }
  enhancedButtons.clear();
}
