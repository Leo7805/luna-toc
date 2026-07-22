/**
 * Helpers for building per-prompt answer outlines from rendered ChatGPT
 * headings. This file intentionally keeps outline parsing separate from the
 * main content script UI code.
 */
import type { NavigatorMessage } from './conversationPrompts/message';
import { isPromptMarked as isMessageMarked } from './conversationPrompts/promptMark';
import { jumpToPromptIndex, lockPromptIndex } from './jump';

interface OutlineEntry {
  level: number;
  text: string;
  element: HTMLElement;
  sectionId: string;
}

interface PromptItemEntry {
  item: HTMLElement;
  outlineIndicator: HTMLSpanElement;
  outlineList: HTMLDivElement;
}

interface CreatePromptItemOptions {
  item: HTMLElement;
  index: number;
  messageId: string;
}

interface PromptNavigationAction {
  shouldBuild: boolean;
}
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const HEADING_HIGHLIGHT_CLASS = 'chat-toc-outline-heading-highlight';
const OUTLINE_BUILD_RETRY_DELAY_MS = 300;
const OUTLINE_BUILD_MAX_ATTEMPTS = 15;
const OUTLINE_JUMP_RETRY_DELAY_MS = 250;
const OUTLINE_JUMP_MAX_ATTEMPTS = 16;

const promptOutlines = new Map<number, OutlineEntry[]>();
const expandedPromptOutlines = new Set<number>();
const promptItems = new Map<number, PromptItemEntry>();
const promptMessageIds = new Map<number, string>();
let currentPromptIndex: number | null = null;
let highlightedHeadingElement: HTMLElement | null = null;
let outlineBuildVersion = 0;
let outlineJumpVersion = 0;

/**
 * Extracts the two-level heading outline from a rendered prompt answer.
 * @param {number} index Prompt index in the main ChatTOC navigator.
 * @returns {Array<{ level: number, text: string, element?: HTMLElement, sectionId?: string }>}
 */
export function getPromptOutline(index: number): OutlineEntry[] {
  const answerContainer = getAnswerContainerForPrompt(index);

  return answerContainer ? extractHeadingOutline(answerContainer) : [];
}

/**
 * Clears all outline state for the active conversation.
 */
export function resetOutline(): void {
  clearHighlightedHeading();
  outlineBuildVersion += 1;
  outlineJumpVersion += 1;
  promptOutlines.clear();
  expandedPromptOutlines.clear();
  promptMessageIds.clear();
  resetPromptItems();
  currentPromptIndex = null;
}

/**
 * Clears registered prompt row DOM without removing cached outlines.
 */
export function resetPromptItems(): void {
  promptItems.clear();
}

/**
 * Replaces the prompt index to message ID mapping for the active conversation.
 * @param {Array<{ id: string }>} messages Navigator messages in display order.
 */
export function setPromptMessages(messages: NavigatorMessage[]): void {
  promptMessageIds.clear();

  messages.forEach((message, index) => {
    if (message.id) {
      promptMessageIds.set(index, message.id);
    }
  });
}

/**
 * Creates and registers the outline-related DOM pieces for a prompt row.
 * @param {Object} params
 * @param {HTMLElement} params.item Prompt row element.
 * @param {number} params.index Prompt index in the navigator.
 * @param {string} params.messageId ChatGPT user message ID.
 * @returns {{ outlineIndicator: HTMLElement, outlineList: HTMLElement }}
 */
export function createPromptItem({
  item,
  index,
  messageId,
}: CreatePromptItemOptions): {
  outlineIndicator: HTMLSpanElement;
  outlineList: HTMLDivElement;
} {
  const outlineIndicator = document.createElement('span');
  const outlineList = document.createElement('div');

  outlineIndicator.className = 'navigator-outline-indicator';
  outlineIndicator.setAttribute('aria-hidden', 'true');

  const entry = {
    item,
    outlineIndicator,
    outlineList,
  };

  promptItems.set(index, entry);
  promptMessageIds.set(index, messageId);
  updatePromptItemState(entry, index);

  return {
    outlineIndicator,
    outlineList,
  };
}

/**
 * Handles outline state changes for a prompt row click.
 * @param {number} index Clicked prompt index.
 * @param {number | null} activeIndex Currently active prompt index.
 * @returns {{ shouldBuild: boolean }} Whether the caller should try building an outline after navigation.
 */
export function handlePromptNavigation(
  index: number,
  activeIndex: number | null
): PromptNavigationAction {
  outlineJumpVersion += 1;
  clearHighlightedHeading();

  if (index === activeIndex && promptOutlines.has(index)) {
    currentPromptIndex = index;
    togglePromptOutline(index);
    updateAllPromptItems();

    return {
      shouldBuild: false,
    };
  }

  setCurrentPrompt(index);

  return {
    shouldBuild: true,
  };
}

/**
 * Syncs outline UI when ChatTOC's active prompt changes outside a prompt-row
 * click, such as native/chat scroll activation.
 * @param {number} index Active prompt index.
 */
export function syncActivePrompt(index: number): void {
  if (index === currentPromptIndex) return;

  outlineJumpVersion += 1;
  clearHighlightedHeading();
  setCurrentPrompt(index);
}

/**
 * Makes a prompt the current outline owner and hides unmarked outlines
 * from other prompts.
 * @param {number} index Prompt index.
 */
function setCurrentPrompt(index: number): void {
  currentPromptIndex = index;
  collapseAllExcept(index);
  updateAllPromptItems();
}

/**
 * Collapses every expanded outline except the given prompt.
 * @param {number} index Prompt index that is allowed to stay expanded.
 */
function collapseAllExcept(index: number | null): void {
  expandedPromptOutlines.forEach((expandedIndex) => {
    if (expandedIndex !== index && !isPromptMarked(expandedIndex)) {
      expandedPromptOutlines.delete(expandedIndex);
    }
  });
}

/**
 * Collapses every expanded outline without clearing cached heading data.
 */
export function collapseAll(): void {
  expandedPromptOutlines.clear();
  updateAllPromptItems();
}

/**
 * Reapplies expanded-outline rules after mark state changes.
 */
export function syncMarkState(): void {
  collapseAllExcept(currentPromptIndex);
  updateAllPromptItems();
}

/**
 * Returns whether a prompt row is currently marked.
 * @param {number} index Prompt index.
 * @returns {boolean}
 */
function isPromptMarked(index: number): boolean {
  const messageId = promptMessageIds.get(index);

  return Boolean(messageId && isMessageMarked(messageId));
}

/**
 * Lazily builds and stores an outline for a prompt, then refreshes its row UI.
 * @param {number} index Prompt index to build an outline for.
 */
export function scheduleBuild(
  index: number,
  attempts = OUTLINE_BUILD_MAX_ATTEMPTS
): void {
  const buildVersion = outlineBuildVersion + 1;

  outlineBuildVersion = buildVersion;
  runBuild(index, attempts, buildVersion);
}

/**
 * Retries outline extraction while ignoring stale async build attempts.
 * @param {number} index Prompt index to build an outline for.
 * @param {number} attempts Remaining retry attempts.
 * @param {number} buildVersion Version captured when this build started.
 */
function runBuild(index: number, attempts: number, buildVersion: number): void {
  if (buildVersion !== outlineBuildVersion || index !== currentPromptIndex) {
    return;
  }

  const outline = getPromptOutline(index);

  if (!outline.length) {
    if (attempts <= 1) return;

    setTimeout(() => {
      runBuild(index, attempts - 1, buildVersion);
    }, OUTLINE_BUILD_RETRY_DELAY_MS);
    return;
  }

  if (buildVersion !== outlineBuildVersion || index !== currentPromptIndex) {
    return;
  }

  currentPromptIndex = index;
  promptOutlines.set(index, outline);
  updatePromptItemByIndex(index);
}

/**
 * Finds the assistant answer container that follows the rendered user prompt.
 * @param {number} index Prompt index in the main ChatTOC navigator.
 * @returns {HTMLElement | null}
 */
function getAnswerContainerForPrompt(index: number): HTMLElement | null {
  const userMessage = getRenderedUserMessageForPrompt(index);
  const userTurn = userMessage?.closest('section[data-turn="user"]');
  const answerTurn = userTurn ? findNextAssistantTurn(userTurn) : null;

  return answerTurn ? getAnswerMarkdownContainer(answerTurn) : null;
}

/**
 * Finds the markdown block that actually contains answer headings. Some
 * ChatGPT turns render a short assistant preface before the final answer.
 * @param {HTMLElement} answerTurn Assistant turn section.
 * @returns {HTMLElement | null}
 */
function getAnswerMarkdownContainer(
  answerTurn: HTMLElement
): HTMLElement | null {
  const markdownContainers = Array.from(
    answerTurn.querySelectorAll<HTMLElement>(
      '[data-message-author-role="assistant"] .markdown'
    )
  );

  return (
    markdownContainers.find((container) =>
      container.querySelector(HEADING_SELECTOR)
    ) ||
    markdownContainers.at(-1) ||
    answerTurn.querySelector('[data-message-author-role="assistant"]') ||
    null
  );
}

/**
 * Finds the rendered user message for a prompt. Prefer ChatGPT's stable
 * data-message-id; when an ID exists but the DOM node is still virtualized,
 * return null so the retry loop can wait instead of extracting the wrong row.
 * @param {number} index Prompt index in the main ChatTOC navigator.
 * @returns {HTMLElement | null}
 */
function getRenderedUserMessageForPrompt(index: number): HTMLElement | null {
  const messageId = promptMessageIds.get(index);
  const userMessages = getRenderedUserMessages();
  const userMessageById = messageId
    ? document.querySelector<HTMLElement>(
        `[data-message-author-role="user"][data-message-id="${escapeCssIdentifier(
          messageId
        )}"]`
      )
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
 * @returns {HTMLElement[]}
 */
function getRenderedUserMessages(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
  );
}

/**
 * Escapes a value for use in a CSS attribute selector.
 * @param {string} value
 * @returns {string}
 */
function escapeCssIdentifier(value: string): string {
  return CSS.escape(value);
}

/**
 * Returns the visible user message closest to the viewport center.
 * @param {HTMLElement[]} userMessages Rendered user message elements.
 * @returns {HTMLElement | null}
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
 * @param {HTMLElement} userTurn
 * @returns {HTMLElement | null}
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
 * @param {HTMLElement} answerContainer
 * @returns {Array<{ level: number, text: string, element: HTMLElement, sectionId?: string }>}
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

  return headings
    .filter((heading) => {
      const level = getHeadingLevel(heading);

      return level === baseLevel || level === childLevel;
    })
    .map((heading) => {
      const level = getHeadingLevel(heading);

      return {
        level: level === baseLevel ? 1 : 2,
        text: heading.textContent.trim(),
        element: heading,
        sectionId: heading.dataset.sectionId || '',
      };
    });
}

/**
 * Parses a heading tag name into its numeric level.
 * @param {HTMLElement} heading
 * @returns {number}
 */
function getHeadingLevel(heading: HTMLElement): number {
  return Number(heading.tagName.slice(1));
}

/**
 * Toggles whether a prompt's already-built outline is expanded.
 * @param {number} index Prompt index.
 */
function togglePromptOutline(index: number): void {
  if (expandedPromptOutlines.has(index)) {
    expandedPromptOutlines.delete(index);
  } else {
    collapseAllExcept(index);
    expandedPromptOutlines.add(index);
  }
}

/**
 * Finds a prompt row by index and reapplies outline classes/indicator state.
 * @param {number} index Prompt index.
 */
function updatePromptItemByIndex(index: number): void {
  const entry = promptItems.get(index);

  if (!entry) return;

  updatePromptItemState(entry, index);
}

/**
 * Reapplies outline UI state to every currently rendered prompt row.
 */
function updateAllPromptItems(): void {
  promptItems.forEach((entry, index) => {
    updatePromptItemState(entry, index);
  });
}

/**
 * Applies outline availability and expansion state to a prompt row.
 * @param {{ item: HTMLElement, outlineIndicator: HTMLElement, outlineList: HTMLElement }} entry Prompt row outline DOM.
 * @param {number} index Prompt index.
 */
function updatePromptItemState(entry: PromptItemEntry, index: number): void {
  const outline = promptOutlines.get(index) || [];
  const isCurrent = index === currentPromptIndex;
  const isMarkExpanded =
    expandedPromptOutlines.has(index) && isPromptMarked(index);
  const hasVisibleOutline = (isCurrent || isMarkExpanded) && outline.length > 0;
  const isExpanded = expandedPromptOutlines.has(index) && hasVisibleOutline;

  entry.item.classList.toggle('navigator-item-has-outline', hasVisibleOutline);
  entry.item.classList.toggle('navigator-item-outline-expanded', isExpanded);

  entry.outlineIndicator.dataset.expanded = String(isExpanded);
  entry.outlineIndicator.innerHTML = hasVisibleOutline
    ? getOutlineIndicatorIcon()
    : '';

  renderOutlineList(entry.outlineList, outline, isExpanded, index);
}

/**
 * Returns the shared chevron icon used by collapsed and expanded outlines.
 * CSS rotates the same SVG so both states stay visually consistent.
 * @returns {string}
 */
function getOutlineIndicatorIcon(): string {
  return `
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M4 6l4 4 4-4" />
      </svg>
    `;
}

/**
 * Renders the visible heading rows for an expanded prompt outline.
 * @param {HTMLElement} outlineList Container for rendered heading rows.
 * @param {Array<{ level: number, text: string, element?: HTMLElement, sectionId?: string }>} outline Heading entries.
 * @param {boolean} isExpanded Whether the outline should be visible.
 * @param {number} promptIndex Parent prompt index.
 */
function renderOutlineList(
  outlineList: HTMLDivElement,
  outline: OutlineEntry[],
  isExpanded: boolean,
  promptIndex: number
): void {
  outlineList.className = 'navigator-outline-list';
  outlineList.hidden = !isExpanded;
  outlineList.textContent = '';

  if (!isExpanded) return;

  outline.forEach((entry) => {
    const outlineItem = document.createElement('div');

    outlineItem.className = 'navigator-outline-item';
    outlineItem.dataset.level = String(entry.level);
    outlineItem.textContent = entry.text;
    outlineItem.addEventListener('click', (event) => {
      handleOutlineItemClick(event, entry, promptIndex);
    });
    outlineList.appendChild(outlineItem);
  });
}

/**
 * Handles clicks on answer-outline rows without toggling the parent prompt.
 * @param {MouseEvent} event
 * @param {{ level: number, text: string, element?: HTMLElement, sectionId?: string }} entry
 * @param {number} promptIndex Parent prompt index.
 */
function handleOutlineItemClick(
  event: MouseEvent,
  entry: OutlineEntry,
  promptIndex: number
): void {
  event.stopPropagation();

  startOutlineEntryJump(entry, promptIndex);
}

/**
 * Starts a child-outline jump. If the answer heading is virtualized, first
 * navigates to the parent prompt, then waits for the heading to render.
 * @param {{ level: number, text: string, element?: HTMLElement, sectionId?: string }} entry
 * @param {number} promptIndex Parent prompt index.
 */
function startOutlineEntryJump(entry: OutlineEntry, promptIndex: number): void {
  const jumpVersion = outlineJumpVersion + 1;

  outlineJumpVersion = jumpVersion;
  currentPromptIndex = promptIndex;
  updateAllPromptItems();

  const heading = resolveOutlineHeading(entry);

  if (heading) {
    finishOutlineEntryJump(heading, promptIndex, jumpVersion);
    return;
  }

  jumpToPromptIndex(
    promptIndex,
    OUTLINE_JUMP_MAX_ATTEMPTS * OUTLINE_JUMP_RETRY_DELAY_MS
  );

  retryOutlineEntryJump(
    entry,
    promptIndex,
    OUTLINE_JUMP_MAX_ATTEMPTS,
    jumpVersion
  );
}

/**
 * Waits for a virtualized answer heading to appear after parent prompt navigation.
 * @param {{ level: number, text: string, element?: HTMLElement, sectionId?: string }} entry
 * @param {number} promptIndex Parent prompt index.
 * @param {number} attempts Remaining retry attempts after prompt navigation.
 * @param {number} jumpVersion Version captured when this child jump started.
 */
function retryOutlineEntryJump(
  entry: OutlineEntry,
  promptIndex: number,
  attempts: number,
  jumpVersion: number
): void {
  if (jumpVersion !== outlineJumpVersion) return;

  const heading = resolveOutlineHeading(entry);

  if (heading) {
    finishOutlineEntryJump(heading, promptIndex, jumpVersion);
    return;
  }

  if (attempts <= 1) return;

  setTimeout(() => {
    retryOutlineEntryJump(entry, promptIndex, attempts - 1, jumpVersion);
  }, OUTLINE_JUMP_RETRY_DELAY_MS);
}

/**
 * Locks the parent prompt as active, then highlights and scrolls to a heading.
 * @param {HTMLElement} heading
 * @param {number} promptIndex Parent prompt index.
 * @param {number} jumpVersion Version captured when this child jump started.
 */
function finishOutlineEntryJump(
  heading: HTMLElement,
  promptIndex: number,
  jumpVersion: number
): void {
  if (jumpVersion !== outlineJumpVersion) return;

  lockPromptIndex(promptIndex);
  highlightHeading(heading);

  heading.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

/**
 * Resolves the current DOM node for an outline heading. ChatGPT may rerender
 * answers, so prefer data-section-id over the originally captured element.
 * @param {{ element?: HTMLElement, sectionId?: string }} entry
 * @returns {HTMLElement | null}
 */
function resolveOutlineHeading(entry: OutlineEntry): HTMLElement | null {
  if (entry.sectionId) {
    return document.querySelector<HTMLElement>(
      `[data-section-id="${escapeCssIdentifier(entry.sectionId)}"]`
    );
  }

  return entry.element?.isConnected ? entry.element : null;
}

/**
 * Applies the answer-heading highlight, replacing any previous highlight.
 * @param {HTMLElement} heading
 */
function highlightHeading(heading: HTMLElement): void {
  clearHighlightedHeading();

  heading.classList.add(HEADING_HIGHLIGHT_CLASS);
  highlightedHeadingElement = heading;
}

/**
 * Removes the current answer-heading highlight.
 */
function clearHighlightedHeading(): void {
  highlightedHeadingElement?.classList.remove(HEADING_HIGHLIGHT_CLASS);
  highlightedHeadingElement = null;
}
