/**
 * ChatGPT native-prompt-button navigation. Provides the four ARIA-based
 * selectors that match ChatGPT's built-in TOC buttons, the index parser
 * used to map a button back to a prompt slot, and the IntersectionObserver
 * glue that mirrors native-TOC active state into the sidebar.
 */
import { getCurrentRouteKey } from './routing';
import type { NavigatorMessage } from '../platformInterface';

const NATIVE_PROMPT_BUTTON_SELECTORS = [
  'button[aria-label^="Prompt "]',
  'button[aria-label^="prompt "]',
  'button[aria-description^="Prompt "]',
  'button[aria-description^="prompt "]',
] as const;

export function getNativePromptButtonSelectors(): readonly string[] {
  return NATIVE_PROMPT_BUTTON_SELECTORS;
}

/**
 * Returns the 0-based prompt index encoded in a native button's
 * `aria-label` / `aria-description`. Returns -1 when the label is
 * unrecognised.
 */
export function getNativePromptIndex(button: HTMLButtonElement): number {
  const label =
    button.getAttribute('aria-label') ||
    button.getAttribute('aria-description') ||
    '';
  const match = label.match(/^prompt\s+(\d+)$/i);
  return match ? Number(match[1]) - 1 : -1;
}

/**
 * Observes visible user-message elements and invokes `callback(id)` for the
 * top-most intersection. Returns a cleanup function that disconnects the
 * observer. Default `root` is `document`.
 */
export function observeVisibleUserMessages(
  callback: (id: string) => void
): () => void {
  const userMessageSelector = '[data-message-author-role="user"]';
  const observer = new IntersectionObserver(
    (entries) => {
      const topEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!topEntry || !(topEntry.target instanceof HTMLElement)) return;
      const id = topEntry.target.dataset.messageId || null;
      if (id) callback(id);
    },
    { threshold: [0.1, 0.25, 0.5, 0.75, 1] }
  );

  document
    .querySelectorAll<HTMLElement>(userMessageSelector)
    .forEach((element) => observer.observe(element));

  return () => observer.disconnect();
}

/**
 * Resolves the jump-target DOM element for a given prompt message. Returns
 * the rendered ChatGPT user-message element matching `message.id`.
 */
export function getJumpTargetElement(message: NavigatorMessage): HTMLElement | null {
  const userMessageSelector = '[data-message-author-role="user"]';
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(userMessageSelector)
  );

  for (const element of candidates) {
    if (element.dataset.messageId === message.id) return element;
  }

  // Fall back to the current route key's element when dataset.messageId is
  // missing (legacy mounts pre-dating the message-id attribute).
  const currentId = getCurrentRouteKey();
  if (currentId && currentId === message.id) {
    return candidates[0] || null;
  }

  return null;
}