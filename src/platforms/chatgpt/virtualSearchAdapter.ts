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
 * Finds the scrollable container that owns ChatGPT's mounted messages.
 *
 * @example
 * const container = getChatGptScrollContainer(document);
 */
export function getChatGptScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  const sampleMessage =
    root.querySelector<HTMLElement>(USER_MESSAGE_SELECTOR) ||
    root.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR);
  let parent = sampleMessage?.parentElement || null;

  while (parent && parent !== document.body) {
    if (isVerticallyScrollable(parent)) return parent;
    parent = parent.parentElement;
  }

  const selectorFallback =
    root.querySelector<HTMLElement>('main div.overflow-y-auto') ||
    root.querySelector<HTMLElement>('[class*="react-scroll-to-bottom"]') ||
    root.querySelector<HTMLElement>('main [class*="react-scroll-to-bottom"]');

  if (selectorFallback) return selectorFallback;

  const main = root.querySelector<HTMLElement>('main');
  if (!main) return null;

  return (
    Array.from(main.querySelectorAll<HTMLElement>('div')).find(
      isVerticallyScrollable
    ) || null
  );
}

/**
 * Finds the container whose `scrollTop` maps to the chat feed's absolute
 * top/bottom. On ChatGPT this is the `.thread-scroll-container` thread
 * element, not an inner overflow wrapper.
 *
 * @example
 * const container = getChatGptThreadScrollContainer(document);
 */
export function getChatGptThreadScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  return root.querySelector<HTMLElement>('.thread-scroll-container');
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
 * first mounted bubble whose textContent starts with `promptText` (after
 * whitespace normalization).
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
  for (const element of candidates) {
    if (
      normalizeForTextMatch(element.textContent || '').startsWith(needle)
    ) {
      return element;
    }
  }
  return null;
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

/**
 * Checks whether an element declares vertical scrolling.
 */
function isVerticallyScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}
