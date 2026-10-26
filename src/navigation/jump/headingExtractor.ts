/**
 * Extracts per-prompt answer heading outlines from rendered ChatGPT DOM elements.
 * Resolves user messages, locates following assistant responses in DOM order,
 * and normalizes the first three existing Markdown heading levels.
 */
import { getActivePlatform } from '@/platforms';
import { logOutlineDiagnostic } from './outlineDiagnostics';
import { parseUnrenderedBoldMarkdown } from '@/platforms/chatgpt/markdownBoldRepair';

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
 * Extracts up to three present heading levels from a rendered prompt answer.
 * @param {number} index Prompt index in the main LunaTOC navigator.
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
  const answerContainer = userMessage
    ? findNextAssistantMessage(userMessage)
    : null;

  logOutlineDiagnostic('OUTLINE_SOURCE_RESOLVED', {
    promptIndex: index,
    expectedPromptMessageId: messageId || null,
    renderedPromptMessageId:
      (userMessage &&
        platform().navigation.getMessageIdFromElement?.(userMessage)) ??
      (platform().config.selectors.messageId && userMessage
        ? userMessage.getAttribute(platform().config.selectors.messageId)
        : null) ??
      userMessage?.dataset.messageId ??
      null,
    userMessageConnected: userMessage?.isConnected ?? false,
    assistantTurnFound: Boolean(answerContainer),
    answerContainerConnected: answerContainer?.isConnected ?? false,
    answerContainerHidden:
      Boolean(answerContainer?.hidden) ||
      Boolean(
        answerContainer?.closest('[hidden], [aria-hidden="true"]')
      ),
    rawHeadingCount:
      answerContainer?.querySelectorAll(HEADING_SELECTOR).length ?? 0,
  });

  return answerContainer;
}

/**
 * Finds the next mounted assistant message element following a user message.
 */
export function findNextAssistantMessage(
  userMessage: HTMLElement
): HTMLElement | null {
  const userSelector = platform().config.selectors.userMessage;
  const assistantSelector = platform().config.selectors.assistantMessage;
  if (!userSelector || !assistantSelector) return null;

  const messages = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${userSelector}, ${assistantSelector}`
    )
  );
  const userIndex = messages.indexOf(userMessage);
  if (userIndex === -1) return null;

  for (let i = userIndex + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.matches(assistantSelector)) {
      return message;
    }
    if (message.matches(userSelector)) {
      return null;
    }
  }

  return null;
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
 * Checks whether a heading element is for accessibility / screen readers only.
 */
function isAccessibilityHeading(heading: HTMLElement): boolean {
  if (heading.closest('.sr-only, [hidden], [aria-hidden="true"], [inert], pre, code')) {
    return true;
  }
  const style = window.getComputedStyle(heading);
  return style.display === 'none' || style.visibility === 'hidden' ||
    style.visibility === 'collapse';
}

/**
 * Extracts up to three existing levels, skipping absent heading ranks.
 */
function extractHeadingOutline(answerContainer: HTMLElement): OutlineEntry[] {
  const headings = Array.from(
    answerContainer.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
  ).filter(
    (heading) =>
      heading.textContent.trim().length > 0 &&
      !isAccessibilityHeading(heading)
  );

  if (!headings.length) return [];

  // H2/H4/H6 is a valid three-level outline even though H3 and H5 are absent.
  // Keep document order, compact indentation, and stable native heading tags.
  const presentLevels = [...new Set(headings.map(getHeadingLevel))]
    .sort((a, b) => a - b)
    .slice(0, 3);
  const normalizedLevels = new Map(
    presentLevels.map((headingLevel, index) => [headingLevel, index + 1])
  );
  const occurrenceByDescriptor = new Map<string, number>();

  return headings
    .filter((heading) => normalizedLevels.has(getHeadingLevel(heading)))
    .map((heading) => {
      const headingLevel = getHeadingLevel(heading);
      const level = normalizedLevels.get(headingLevel)!;
      const rawText = heading.textContent.trim();
      const text = parseUnrenderedBoldMarkdown(rawText)
        ?.map((segment) => segment.text).join('') ?? rawText;
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
