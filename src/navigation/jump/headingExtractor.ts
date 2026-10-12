/**
 * Extracts per-prompt answer heading outlines from rendered ChatGPT DOM elements.
 * Traverses user turn sections, locates assistant responses, and normalizes
 * Markdown headings into a two-level hierarchy.
 */
import { getActivePlatform } from '@/platforms';
import { logOutlineDiagnostic } from './outlineDiagnostics';

export interface OutlineEntry {
  level: number;
  headingLevel: number;
  text: string;
  occurrence: number;
  element: HTMLElement;
  sectionId: string;
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

function platform() {
  return getActivePlatform();
}

/**
 * Extracts the two-level heading outline from a rendered prompt answer.
 * @param {number} index Prompt index in the main ChatTOC navigator.
 * @param {string | null} [messageId] Expected prompt message ID, if known.
 * @returns {Array<OutlineEntry>} List of extracted heading descriptors.
 */
export function getPromptOutline(
  index: number,
  messageId?: string | null
): OutlineEntry[] {
  const answerContainer = getAnswerContainerForPrompt(index, messageId);
  const outline = answerContainer
    ? extractHeadingOutline(answerContainer)
    : [];

  logOutlineDiagnostic('OUTLINE_EXTRACTED', {
    promptIndex: index,
    promptMessageId: messageId || null,
    answerContainerFound: Boolean(answerContainer),
    answerContainerConnected: answerContainer?.isConnected ?? false,
    headingCount: outline.length,
    headings: outline.map(
      ({ level, headingLevel, text, occurrence, element, sectionId }) => ({
        level,
        headingLevel,
        text,
        occurrence,
        tagName: element.tagName,
        sectionId: sectionId || null,
        connected: element.isConnected,
        hidden:
          element.hidden ||
          element.closest('[hidden], [aria-hidden="true"]') !== null,
        insideCodeBlock: element.closest('pre, code') !== null,
      })
    ),
  });

  return outline;
}

/**
 * Finds the assistant answer container that follows the rendered user prompt.
 */
function getAnswerContainerForPrompt(
  index: number,
  messageId?: string | null
): HTMLElement | null {
  const userMessage = getRenderedUserMessageForPrompt(index, messageId);
  const userTurn = userMessage?.closest('section[data-turn="user"]');
  const answerTurn = userTurn ? findNextAssistantTurn(userTurn) : null;
  const answerContainer = answerTurn
    ? getAnswerMarkdownContainer(answerTurn)
    : null;

  logOutlineDiagnostic('OUTLINE_SOURCE_RESOLVED', {
    promptIndex: index,
    expectedPromptMessageId: messageId || null,
    renderedPromptMessageId:
      userMessage?.dataset.messageId || null,
    userMessageConnected: userMessage?.isConnected ?? false,
    userTurnFound: Boolean(userTurn),
    assistantTurnFound: Boolean(answerTurn),
    assistantMessageIds: answerTurn && platform().config.selectors.assistantMessage
      ? Array.from(
          answerTurn.querySelectorAll<HTMLElement>(
            platform().config.selectors.assistantMessage
          )
        ).map(({ dataset }) => dataset.messageId || null)
      : [],
    answerContainerConnected: answerContainer?.isConnected ?? false,
    answerContainerHidden:
      Boolean(answerContainer?.hidden) ||
      Boolean(
        answerContainer?.closest('[hidden], [aria-hidden="true"]')
      ),
    markdownContainerCount:
      (answerTurn && platform().config.selectors.assistantMessage)
        ? answerTurn.querySelectorAll(
            platform().config.selectors.assistantMessage
          ).length
        : 0,
    rawHeadingCount:
      answerContainer?.querySelectorAll(HEADING_SELECTOR).length ?? 0,
  });

  return answerContainer;
}

/**
 * Finds the markdown block that actually contains answer headings. Some
 * ChatGPT turns render a short assistant preface before the final answer.
 */
function getAnswerMarkdownContainer(
  answerTurn: HTMLElement
): HTMLElement | null {
  const assistantSelector = platform().config.selectors.assistantMessage;
  const markdownContainers = assistantSelector
    ? Array.from(
        answerTurn.querySelectorAll<HTMLElement>(assistantSelector)
      )
    : [];

  return (
    markdownContainers.find((container) =>
      container.querySelector(HEADING_SELECTOR)
    ) ||
    markdownContainers.at(-1) ||
    (assistantSelector
      ? answerTurn.querySelector(assistantSelector)
      : null) ||
    null
  );
}

/**
 * Finds the rendered user message for a prompt. Prefer the platform's stable
 * message ID; when an ID exists but the DOM node is still virtualized, return null
 * so the retry loop can wait instead of extracting the wrong row.
 */
function getRenderedUserMessageForPrompt(
  _index: number,
  messageId?: string | null
): HTMLElement | null {
  const userMessages = getRenderedUserMessages();
  const userSelector = platform().config.selectors.userMessage;
  const userMessageById = messageId && userSelector
    ? Array.from(
        document.querySelectorAll<HTMLElement>(userSelector)
      ).find((el) => {
        const id =
          platform().navigation.getMessageIdFromElement?.(el) ??
          (platform().config.selectors.messageId
            ? el.getAttribute(platform().config.selectors.messageId)
            : null);
        return (
          id === messageId ||
          (id !== null && id.split(',').includes(messageId))
        );
      }) ?? null
    : null;

  if (userMessageById) {
    return userMessageById;
  }

  if (messageId) {
    return null;
  }

  return getCenteredRenderedUserMessage(userMessages);
}

/**
 * Returns all currently rendered user message elements.
 */
function getRenderedUserMessages(): HTMLElement[] {
  const userSelector = platform().config.selectors.userMessage;
  if (!userSelector) return [];
  return Array.from(
    document.querySelectorAll<HTMLElement>(userSelector)
  );
}

/**
 * Returns the visible user message closest to the viewport center.
 */
function getCenteredRenderedUserMessage(
  userMessages: HTMLElement[]
): HTMLElement | null {
  if (userMessages.length === 0) return null;

  const viewportCenter = window.innerHeight / 2;

  return userMessages
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const center = rect.top + rect.height / 2;

      return {
        element,
        distance: Math.abs(center - viewportCenter),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.element;
}

/**
 * Finds the next assistant turn after a user turn.
 */
function findNextAssistantTurn(userTurn: Element): HTMLElement | null {
  let nextTurn = userTurn.parentElement?.nextElementSibling;

  while (nextTurn) {
    const section = nextTurn.matches('section[data-turn]')
      ? nextTurn
      : nextTurn.querySelector('section[data-turn]');

    if (
      section instanceof HTMLElement &&
      section.dataset.turn === 'assistant'
    ) {
      return section;
    }

    if (section instanceof HTMLElement && section.dataset.turn === 'user') {
      return null;
    }

    nextTurn = nextTurn.nextElementSibling;
  }

  return null;
}

/**
 * Extracts the highest heading level and the next level from an answer.
 */
function extractHeadingOutline(answerContainer: HTMLElement): OutlineEntry[] {
  const headings = Array.from(
    answerContainer.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
  ).filter((heading) => heading.textContent.trim().length > 0);

  if (!headings.length) return [];

  const baseLevel = Math.min(
    ...headings.map((heading) => getHeadingLevel(heading))
  );
  const childLevel = baseLevel + 1;

  const occurrenceByDescriptor = new Map<string, number>();

  return headings
    .filter((heading) => {
      const level = getHeadingLevel(heading);

      return level === baseLevel || level === childLevel;
    })
    .map((heading) => {
      const headingLevel = getHeadingLevel(heading);
      const level = headingLevel === baseLevel ? 1 : 2;
      const text = heading.textContent.trim();
      const descriptorKey = `${headingLevel}\u0000${text}`;
      const occurrence = occurrenceByDescriptor.get(descriptorKey) || 0;
      occurrenceByDescriptor.set(descriptorKey, occurrence + 1);

      return {
        level,
        headingLevel,
        text,
        occurrence,
        element: heading,
        sectionId: heading.dataset.sectionId || '',
      };
    });
}

/**
 * Parses a heading tag name into its numeric level.
 */
function getHeadingLevel(heading: HTMLElement): number {
  return Number(heading.tagName.slice(1));
}
