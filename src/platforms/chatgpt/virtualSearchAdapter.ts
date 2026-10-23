/**
 * Adapts ChatGPT DOM and scrolling state to navigation inputs.
 */

// The new ChatGPT DOM renames the old per-prompt markers:
//   old: [data-message-author-role="user"]        →  new: [data-chatgpt-search-unit-key$=":user"]
//   old: [data-message-author-role="assistant"]   →  new: [data-chatgpt-search-unit-key$=":assistant"]
// The stable message id is now exposed as the `data-chatgpt-search-message-ids`
// attribute on the same element.
const USER_MESSAGE_SELECTOR =
  '[data-chatgpt-search-unit-key$=":user"]';
const ASSISTANT_MESSAGE_SELECTOR =
  '[data-chatgpt-search-unit-key$=":assistant"]';

/**
 * Checks whether an element is connected, declares vertical scrolling via computed
 * style, and has measurable scrollable overflow (scrollHeight > clientHeight).
 *
 * @param {HTMLElement | null} element
 * @returns {boolean}
 */
function isValidScrollContainer(
  element: HTMLElement | null
): boolean {
  if (!element || !element.isConnected) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  const isScrollable = overflowY === 'auto' || overflowY === 'scroll';
  return isScrollable && element.scrollHeight > element.clientHeight;
}

/**
 * Resolves the ChatGPT thread scroll container (`.thread-scroll-container`),
 * prioritizing connected, visible elements and the container that owns
 * mounted conversation messages or composer form.
 *
 * @param {ParentNode} [root=document] Root node to query within.
 * @returns {HTMLElement | null} The active thread scroll container, or null if unresolved.
 */
function findDirectThreadScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  const allContainers = Array.from(
    root.querySelectorAll<HTMLElement>('.thread-scroll-container')
  ).filter((el) => el.isConnected);

  if (allContainers.length === 0) return null;

  // Filter to visible candidates if any have measurable clientHeight
  const visibleContainers = allContainers.filter(
    (el) => el.clientHeight > 0 && !el.hasAttribute('aria-hidden')
  );
  const candidates =
    visibleContainers.length > 0 ? visibleContainers : allContainers;

  if (candidates.length === 1) return candidates[0];

  // If multiple exist (e.g. during SPA transition), prioritize the newest
  // container in document order that contains mounted messages or form
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (
      candidate.querySelector(USER_MESSAGE_SELECTOR) ||
      candidate.querySelector(ASSISTANT_MESSAGE_SELECTOR) ||
      candidate.querySelector('[data-message-author-role="user"]') ||
      candidate.querySelector('[data-message-author-role="assistant"]') ||
      candidate.querySelector('form')
    ) {
      return candidate;
    }
  }

  // Fallback to the last candidate in document order (most recently mounted)
  return candidates[candidates.length - 1];
}

/**
 * Finds the scrollable container that owns ChatGPT's mounted messages.
 *
 * @param {ParentNode} [root=document] Root node to query within.
 * @returns {HTMLElement | null} The active scroll container, or null if unresolved.
 *
 * @example
 * const container = getChatGptScrollContainer(document);
 */
export function getChatGptScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  // 1. Prefer the active ChatGPT thread scroll container if present.
  const threadContainer = findDirectThreadScrollContainer(root);
  if (threadContainer) {
    return threadContainer;
  }

  // 2. Fall back to message-ancestor lookup.
  const sampleMessage =
    root.querySelector<HTMLElement>(USER_MESSAGE_SELECTOR) ||
    root.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR) ||
    root.querySelector<HTMLElement>('[data-message-author-role="user"]') ||
    root.querySelector<HTMLElement>('[data-message-author-role="assistant"]');
  let parent = sampleMessage?.parentElement || null;

  while (parent && parent !== document.body) {
    if (isValidScrollContainer(parent)) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return null;
}

/**
 * Finds the container whose `scrollTop` maps to the chat feed's absolute
 * top/bottom. Prioritizes the active `.thread-scroll-container`, falling
 * back to the general scroll container resolver.
 *
 * @param {ParentNode} [root=document] Root node to query within.
 * @returns {HTMLElement | null} The active thread scroll container, or null if unresolved.
 *
 * @example
 * const container = getChatGptThreadScrollContainer(document);
 */
export function getChatGptThreadScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  return (
    findDirectThreadScrollContainer(root) ?? getChatGptScrollContainer(root)
  );
}

/**
 * Finds a currently mounted ChatGPT user message by its stable message ID.
 *
 * @example
 * const prompt = findRenderedChatGptPrompt('prompt-message-id');
 */
export function findRenderedChatGptPrompt(
  promptId: string,
  root: ParentNode = document
): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR)).find(
      (element) => getChatGptMessageId(element) === promptId
    ) || null
  );
}

/**
 * Text-match fallback for finding a currently mounted user message. Used
 * when the id-based `findRenderedChatGptPrompt` returns null but the
 * target prompt text is distinctive enough to identify it. Returns the
 * uniquely mounted bubble whose normalized text matches the whole prompt.
 * Prefixes are unsafe: a short historical prompt may match a different,
 * longer message from another branch.
 */
export function findRenderedChatGptPromptByText(
  promptText: string,
  root: ParentNode = document
): HTMLElement | null {
  if (!promptText) return null;
  const needle = normalizeForTextMatch(promptText);
  if (!needle) return null;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR)
  );
  const matches = candidates.filter((element) =>
    normalizeForTextMatch(element.textContent || '') === needle
  );
  // The first visible match is not necessarily the correct message in a
  // virtualized conversation; never guess when the DOM is ambiguous.
  return matches.length === 1 ? matches[0] : null;
}

function normalizeForTextMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Reads every currently-mounted user bubble and pairs it with the sidebar
 * prompt index it corresponds to. Used by the mount-expansion loop to
 * compute "how far is the target from the closest mounted bubble" in
 * sidebar-index units. Returns empty when nothing is mounted.
 */
export function readMountedWithSidebarIdx(
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode = document
): Array<{ element: HTMLElement; sidebarIdx: number; unitKey: string }> {
  const bubbles = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-chatgpt-search-unit-key$=":user"]'
    )
  );
  const idToIdx = new Map<string, number>();
  prompts.forEach((p, i) => idToIdx.set(p.id, i));
  const out: Array<{ element: HTMLElement; sidebarIdx: number; unitKey: string }> = [];
  bubbles.forEach((el) => {
    const id = el.getAttribute('data-chatgpt-search-message-ids');
    const unitKey = el.getAttribute('data-chatgpt-search-unit-key') || '';
    if (!id) return;
    const sidebarIdx = idToIdx.get(id);
    if (sidebarIdx === undefined) return;
    out.push({ element: el, sidebarIdx, unitKey });
  });
  return out;
}

/**
 * Returns the closest message ID stored on an element or its turn wrapper.
 */
export function getChatGptMessageId(element: HTMLElement): string | null {
  return (
    element.getAttribute('data-chatgpt-search-message-ids') ||
    element
      .closest<HTMLElement>('[data-chatgpt-search-message-ids]')
      ?.getAttribute('data-chatgpt-search-message-ids') ||
    null
  );
}

/**
 * Returns the platform unit key stored on a ChatGPT prompt element.
 */
export function getChatGptPromptUnitKey(element: HTMLElement): string | null {
  return element.getAttribute('data-chatgpt-search-unit-key');
}
