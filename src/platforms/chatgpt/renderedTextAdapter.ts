/**
 * Converts currently mounted ChatGPT Assistant DOM into generic text blocks.
 */
import type { RenderedTextBlock } from '@/navigation/fingerprint/matcher';
import {
  createObservedResponseSegments,
  extractRenderedTextWithinVerticalBounds,
  type ResponseSegmentFingerprint,
} from '@/navigation/fingerprint/segments';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const MARKDOWN_SELECTOR = '.markdown';

export interface ChatGptRenderedAssistantEntry {
  block: RenderedTextBlock;
  element: HTMLElement;
}

export interface ChatGptObservedSegmentOptions {
  assistantElement: HTMLElement;
  promptIndex: number;
  scrollContainer: HTMLElement;
}

/**
 * Returns mounted ChatGPT Assistant Markdown as platform-independent text.
 *
 * @example
 * const blocks = getRenderedAssistantTextBlocks(document);
 */
export function getRenderedAssistantTextBlocks(
  root: ParentNode = document
): RenderedTextBlock[] {
  return getRenderedAssistantEntries(root).map(({ block }) => block);
}

/**
 * Returns mounted Assistant text together with its owning DOM element.
 *
 * @example
 * const entries = getRenderedAssistantEntries(document);
 */
export function getRenderedAssistantEntries(
  root: ParentNode = document
): ChatGptRenderedAssistantEntry[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR)
  ).flatMap((assistantElement, index) => {
    const text = getAssistantMarkdownText(assistantElement);

    if (!text) return [];

    return [
      {
        element: assistantElement,
        block: {
          id: getAssistantBlockId(assistantElement, index),
          text,
        },
      },
    ];
  });
}

/**
 * Returns only Assistant text intersecting the current chat viewport.
 */
export function getVisibleAssistantViewportSamples(
  scrollContainer: HTMLElement,
  root: ParentNode = document
): RenderedTextBlock[] {
  const viewport = scrollContainer.getBoundingClientRect();

  return getRenderedAssistantEntries(root).flatMap(
    ({ block, element }) => {
      const contentElements = getAssistantMarkdownContainers(element);
      const intersectsViewport = contentElements.some((contentElement) => {
        const rect = contentElement.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      });

      if (!intersectsViewport) return [];

      const text = extractRenderedTextWithinVerticalBounds(
        contentElements,
        viewport.top,
        viewport.bottom
      );

      return text ? [{ id: block.id, text }] : [];
    }
  );
}

/**
 * Returns the ChatGPT message ID or a deterministic fallback for this scan.
 */
export function getAssistantBlockId(
  assistantElement: HTMLElement,
  index: number
): string {
  return (
    assistantElement.dataset.messageId ||
    assistantElement.closest<HTMLElement>('[data-message-id]')?.dataset
      .messageId ||
    `chatgpt-assistant-${index}`
  );
}

/**
 * Joins top-level Markdown blocks owned by one Assistant message.
 */
export function getAssistantMarkdownText(
  assistantElement: HTMLElement
): string {
  return getAssistantMarkdownContainers(assistantElement)
    .map((container) => container.innerText || container.textContent || '')
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Returns top-level Markdown containers owned by one Assistant message.
 */
export function getAssistantMarkdownContainers(
  assistantElement: HTMLElement
): HTMLElement[] {
  return Array.from(
    assistantElement.querySelectorAll<HTMLElement>(MARKDOWN_SELECTOR)
  ).filter((container) => {
    const owningMessage = container.closest<HTMLElement>(
      '[data-message-author-role]'
    );
    const nestedMarkdown = container.parentElement?.closest(MARKDOWN_SELECTOR);

    return owningMessage === assistantElement && !nestedMarkdown;
  });
}

/**
 * Creates observed viewport segments from ChatGPT's actual rendered layout.
 */
export function createChatGptObservedResponseSegments({
  assistantElement,
  promptIndex,
  scrollContainer,
}: ChatGptObservedSegmentOptions): Promise<ResponseSegmentFingerprint[]> {
  return createObservedResponseSegments({
    responseId: getAssistantBlockId(assistantElement, 0),
    promptIndex,
    contentElements: getAssistantMarkdownContainers(assistantElement),
    viewportWidth: scrollContainer.clientWidth || window.innerWidth,
    viewportHeight: scrollContainer.clientHeight || window.innerHeight,
  });
}
