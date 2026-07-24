/**
 * Adapts ChatGPT DOM and scrolling state to generic virtual-search inputs.
 */
import {
  createNavigationAnchor,
  type NavigationAnchor,
} from '@/features/navigation/navigationAnchorStore';
import type { NavigationFingerprintIndex } from '@/features/navigation/fingerprint/index';
import { resolveVisiblePromptPosition } from '@/features/navigation/visiblePositionResolver';
import type {
  VirtualScrollMetrics,
  VirtualSearchObservation,
} from '@/features/navigation/virtualSearchController';
import { getRenderedAssistantEntries } from './renderedTextAdapter';

const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';
const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';

export interface ChatGptVirtualPositionOptions {
  conversationKey: string;
  prompts: ReadonlyArray<{ id: string }>;
  fingerprintIndex: NavigationFingerprintIndex;
  root?: ParentNode;
  scrollContainer?: HTMLElement | null;
}

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
 * Returns whether a mounted element intersects the active chat viewport.
 *
 * @example
 * const visible = isChatGptElementVisible(prompt, scrollContainer);
 */
export function isChatGptElementVisible(
  element: HTMLElement,
  scrollContainer: HTMLElement
): boolean {
  return isElementWithinScrollViewport(
    element,
    scrollContainer.getBoundingClientRect()
  );
}

/**
 * Returns current scroll measurements for the generic search controller.
 */
export function getChatGptScrollMetrics(
  container: HTMLElement
): VirtualScrollMetrics {
  return {
    scrollTop: container.scrollTop,
    maximumScrollTop: Math.max(
      0,
      container.scrollHeight - container.clientHeight
    ),
    viewportWidth: container.clientWidth || window.innerWidth,
    viewportHeight: container.clientHeight || window.innerHeight,
  };
}

/**
 * Resolves mounted Assistant responses and converts their element positions
 * into prompt-specific in-memory navigation anchors.
 *
 * @example
 * const observation = await observeChatGptVirtualPosition({
 *   conversationKey,
 *   prompts,
 *   fingerprintIndex,
 * });
 */
export async function observeChatGptVirtualPosition({
  conversationKey,
  prompts,
  fingerprintIndex,
  root = document,
  scrollContainer = getChatGptScrollContainer(root),
}: ChatGptVirtualPositionOptions): Promise<VirtualSearchObservation> {
  if (!scrollContainer) {
    return {
      position: { status: 'none' },
      anchors: [],
    };
  }

  const entries = getRenderedAssistantEntries(root);
  const containerRect = scrollContainer.getBoundingClientRect();
  const visibleEntries = entries.filter(({ element }) =>
    isElementWithinScrollViewport(element, containerRect)
  );
  const validFingerprintIndex = fingerprintIndex.filter(
    ({ promptIndex }) => promptIndex >= 0 && promptIndex < prompts.length
  );
  const position = await resolveVisiblePromptPosition(
    visibleEntries.map(({ block }) => block),
    validFingerprintIndex
  );

  if (position.status !== 'located') {
    return {
      position,
      anchors: [],
    };
  }

  const elementsByBlockId = new Map(
    visibleEntries.map(({ block, element }) => [block.id, element])
  );
  const anchors = position.matchedBlocks.flatMap(
    ({ blockId, promptIndex }): NavigationAnchor[] => {
      const element = elementsByBlockId.get(blockId);
      const prompt = prompts[promptIndex];

      if (!element || !prompt) return [];

      return [
        createChatGptElementNavigationAnchor({
          conversationKey,
          promptId: prompt.id,
          promptIndex,
          element,
          scrollContainer,
        }),
      ];
    }
  );

  return {
    position,
    anchors,
  };
}

/**
 * Converts one mounted Assistant element into a prompt scroll anchor.
 */
export function createChatGptElementNavigationAnchor({
  conversationKey,
  promptId,
  promptIndex,
  element,
  scrollContainer,
}: {
  conversationKey: string;
  promptId: string;
  promptIndex: number;
  element: HTMLElement;
  scrollContainer: HTMLElement;
}): NavigationAnchor {
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const anchorScrollTop =
    scrollContainer.scrollTop + elementRect.top - containerRect.top;

  return createNavigationAnchor({
    conversationKey,
    promptId,
    promptIndex,
    scrollTop: anchorScrollTop,
    scrollHeight: scrollContainer.scrollHeight,
    viewportWidth: scrollContainer.clientWidth || window.innerWidth,
    viewportHeight: scrollContainer.clientHeight || window.innerHeight,
  });
}

/**
 * Returns the closest message ID stored on an element or its turn wrapper.
 */
function getChatGptMessageId(element: HTMLElement): string | null {
  return (
    element.dataset.messageId ||
    element.closest<HTMLElement>('[data-message-id]')?.dataset.messageId ||
    null
  );
}

/**
 * Checks whether an element declares vertical scrolling.
 */
function isVerticallyScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/**
 * Returns whether an element intersects the chat container's visible viewport.
 */
function isElementWithinScrollViewport(
  element: HTMLElement,
  containerRect: DOMRect
): boolean {
  const elementRect = element.getBoundingClientRect();

  return (
    elementRect.bottom > containerRect.top &&
    elementRect.top < containerRect.bottom
  );
}
