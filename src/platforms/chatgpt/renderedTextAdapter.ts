/**
 * Converts currently mounted ChatGPT Assistant DOM into generic text blocks.
 */
import type { RenderedTextBlock } from '@/features/navigation/fingerprint/matcher';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const MARKDOWN_SELECTOR = '.markdown';

/**
 * Returns mounted ChatGPT Assistant Markdown as platform-independent text.
 *
 * @example
 * const blocks = getRenderedAssistantTextBlocks(document);
 */
export function getRenderedAssistantTextBlocks(
  root: ParentNode = document
): RenderedTextBlock[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR)
  ).flatMap((assistantElement, index) => {
    const text = getAssistantMarkdownText(assistantElement);

    if (!text) return [];

    return [
      {
        id: getAssistantBlockId(assistantElement, index),
        text,
      },
    ];
  });
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
  const markdownContainers = Array.from(
    assistantElement.querySelectorAll<HTMLElement>(MARKDOWN_SELECTOR)
  ).filter((container) => {
    const owningMessage = container.closest<HTMLElement>(
      '[data-message-author-role]'
    );
    const nestedMarkdown = container.parentElement?.closest(MARKDOWN_SELECTOR);

    return owningMessage === assistantElement && !nestedMarkdown;
  });

  return markdownContainers
    .map((container) => container.innerText || container.textContent || '')
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n');
}
