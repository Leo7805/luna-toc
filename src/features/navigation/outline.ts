/**
 * Helpers for building per-prompt answer outlines from rendered ChatGPT
 * headings. This file intentionally keeps outline parsing separate from the
 * main content script UI code.
 */
import type { NavigatorMessage } from '../conversationPrompts/message';
import { isPromptMarked as isMessageMarked } from '../conversationPrompts/promptMark';
import {
  cancelOutlineNavigation,
  jumpToOutlineEntry,
} from './outlineNavigation';
import { logOutlineDiagnostic } from './outlineDiagnostics';

interface OutlineEntry {
  level: number;
  headingLevel: number;
  text: string;
  occurrence: number;
  element: HTMLElement;
  sectionId: string;
}

interface CachedPromptOutline {
  promptMessageId: string;
  entries: OutlineEntry[];
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
const OUTLINE_BUILD_RETRY_DELAY_MS = 300;
const OUTLINE_BUILD_MAX_ATTEMPTS = 15;

const promptOutlines = new Map<number, CachedPromptOutline>();
const expandedPromptOutlines = new Set<number>();
const promptItems = new Map<number, PromptItemEntry>();
const promptMessageIds = new Map<number, string>();
let currentPromptIndex: number | null = null;
let outlineBuildVersion = 0;

/**
 * Extracts the two-level heading outline from a rendered prompt answer.
 * @param {number} index Prompt index in the main ChatTOC navigator.
 * @returns {Array<{ level: number, text: string, element?: HTMLElement, sectionId?: string }>}
 */
export function getPromptOutline(index: number): OutlineEntry[] {
  const answerContainer = getAnswerContainerForPrompt(index);
  const outline = answerContainer
    ? extractHeadingOutline(answerContainer)
    : [];

  logOutlineDiagnostic('OUTLINE_EXTRACTED', {
    promptIndex: index,
    promptMessageId: promptMessageIds.get(index) || null,
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
 * Clears all outline state for the active conversation.
 */
export function resetOutline(): void {
  cancelOutlineNavigation();
  outlineBuildVersion += 1;
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
  const nextPromptMessageIds = new Map<number, string>();
  messages.forEach((message, index) => {
    if (message.id) nextPromptMessageIds.set(index, message.id);
  });

  promptOutlines.forEach((cachedOutline, index) => {
    if (cachedOutline.promptMessageId !== nextPromptMessageIds.get(index)) {
      invalidatePromptOutline(index, 'message-id-changed');
    }
  });

  promptMessageIds.clear();
  nextPromptMessageIds.forEach((messageId, index) => {
    promptMessageIds.set(index, messageId);
  });
}

/**
 * How long the completed-status text lingers before retracting. Shared by
 * the loading-complete and jump-complete transitions.
 */
const STATUS_LINGER_MS = 2000;

type SidebarStatusMode = 'idle' | 'loading' | 'jumping' | 'complete';
let currentStatusMode: SidebarStatusMode = 'idle';
let statusLingerTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Last text rendered while in `jumping` mode. Reused as the lingering
 * text after a jump finishes so the user sees the final target instead of
 * an empty band.
 */
let lastJumpingText = '';

/**
 * Updates the small status line that lives between the sidebar header and
 * the prompt list. Owns the appear / linger / retract lifecycle:
 *
 *   - `jumping` / `loading`: shown immediately.
 *   - `complete` (just-finished loading or just-finished jump): shown, then
 *     retracted after `STATUS_LINGER_MS`.
 *   - `idle` (no operation in flight, no linger pending): hidden, no
 *     reserved space.
 *
 * Safe to call on every render — the helper short-circuits when neither
 * the mode nor the rendered text changes, and it never resets the linger
 * timer once it is running.
 *
 * @param {object | null} jump Current jump progress, or null when idle.
 * @param {boolean} loading True while prompts are still arriving.
 * @param {number} promptCount Total prompts accumulated so far.
 */
export function setSidebarStatus(
  jump: { active: boolean; targetIndex: number; remainingSteps: number } | null,
  loading: boolean,
  promptCount: number
): void {
  const element = document.getElementById('luna-toc-status');
  if (!element) return;

  let targetMode: SidebarStatusMode;
  let text: string;

  if (jump && jump.active) {
    targetMode = 'jumping';
    text = `Jumping to prompt #${jump.targetIndex + 1}`;
    lastJumpingText = text;
  } else if (loading) {
    targetMode = 'loading';
    text = `Loading... (${promptCount} so far)`;
  } else if (currentStatusMode === 'loading') {
    targetMode = 'complete';
    text = `${promptCount} prompts`;
  } else if (currentStatusMode === 'jumping') {
    targetMode = 'complete';
    text = lastJumpingText;
  } else if (currentStatusMode === 'complete') {
    // The linger timer is in flight; keep the band visible and do not
    // reset the timer.
    targetMode = 'complete';
    text = `${promptCount} prompts`;
  } else {
    targetMode = 'idle';
    text = '';
  }

  if (targetMode === currentStatusMode && element.textContent === text) {
    return;
  }

  currentStatusMode = targetMode;

  if (targetMode === 'jumping') {
    // The CSS `.jumping-dots .dot` keyframe animation owns the motion.
    // Build the DOM once on entry; subsequent calls during the same jump
    // hit the early-return above (textContent matches the prefix) and leave
    // the dots structure intact.
    element.replaceChildren(
      document.createTextNode(text),
      buildJumpingDotsElement()
    );
    element.classList.add('navigator-status-active');
    if (statusLingerTimer !== null) {
      clearTimeout(statusLingerTimer);
      statusLingerTimer = null;
    }
    return;
  }

  element.textContent = text;
  element.classList.toggle('navigator-status-active', targetMode !== 'idle');

  if (statusLingerTimer !== null) {
    clearTimeout(statusLingerTimer);
    statusLingerTimer = null;
  }
  if (targetMode === 'complete') {
    statusLingerTimer = window.setTimeout(() => {
      currentStatusMode = 'idle';
      element.textContent = '';
      element.classList.remove('navigator-status-active');
      statusLingerTimer = null;
    }, STATUS_LINGER_MS);
  }
}

/**
 * Builds the three-dot span cluster that the CSS keyframe animation drives.
 * Returned element: <span class="jumping-dots"><span class="dot"></span>...
 */
function buildJumpingDotsElement(): HTMLSpanElement {
  const container = document.createElement('span');
  container.className = 'jumping-dots';
  container.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    container.appendChild(dot);
  }
  return container;
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
  cancelOutlineNavigation();

  const cachedOutline =
    index === activeIndex ? getReusablePromptOutline(index) : null;
  if (cachedOutline) {
    logOutlineDiagnostic('OUTLINE_CACHE_REUSED', {
      promptIndex: index,
      promptMessageId: promptMessageIds.get(index) || null,
      headingCount: cachedOutline.entries.length,
      headings: cachedOutline.entries.map(
        ({ text, occurrence, element, sectionId }) => ({
          text,
          occurrence,
          sectionId: sectionId || null,
          connected: element.isConnected,
        })
      ),
    });
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

  cancelOutlineNavigation();
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

  logOutlineDiagnostic('OUTLINE_BUILD_SCHEDULED', {
    promptIndex: index,
    promptMessageId: promptMessageIds.get(index) || null,
    attempts,
    buildVersion,
  });
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

  const promptMessageId = promptMessageIds.get(index);
  if (!promptMessageId) return;

  currentPromptIndex = index;
  promptOutlines.set(index, {
    promptMessageId,
    entries: outline,
  });
  updatePromptItemByIndex(index);
}

/**
 * Returns a cache only when it still belongs to the current Prompt and its
 * headings can be verified against the current Assistant DOM.
 */
function getReusablePromptOutline(index: number): CachedPromptOutline | null {
  const cachedOutline = promptOutlines.get(index);
  const promptMessageId = promptMessageIds.get(index);
  if (!cachedOutline || !promptMessageId) return null;

  if (cachedOutline.promptMessageId !== promptMessageId) {
    invalidatePromptOutline(index, 'message-id-mismatch');
    return null;
  }

  if (cachedOutline.entries.every(({ element }) => element.isConnected)) {
    return cachedOutline;
  }

  const refreshedEntries = getPromptOutline(index);
  if (refreshedEntries.length === 0) {
    invalidatePromptOutline(index, 'disconnected-heading');
    return null;
  }

  const refreshedOutline = {
    promptMessageId,
    entries: refreshedEntries,
  };
  promptOutlines.set(index, refreshedOutline);
  return refreshedOutline;
}

/**
 * Removes one stale Outline and its expanded state.
 */
function invalidatePromptOutline(index: number, reason: string): void {
  if (!promptOutlines.delete(index)) return;

  expandedPromptOutlines.delete(index);
  logOutlineDiagnostic('OUTLINE_CACHE_INVALIDATED', {
    promptIndex: index,
    promptMessageId: promptMessageIds.get(index) || null,
    reason,
  });
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
  const answerContainer = answerTurn
    ? getAnswerMarkdownContainer(answerTurn)
    : null;

  logOutlineDiagnostic('OUTLINE_SOURCE_RESOLVED', {
    promptIndex: index,
    expectedPromptMessageId: promptMessageIds.get(index) || null,
    renderedPromptMessageId:
      userMessage?.dataset.messageId || null,
    userMessageConnected: userMessage?.isConnected ?? false,
    userTurnFound: Boolean(userTurn),
    assistantTurnFound: Boolean(answerTurn),
    assistantMessageIds: answerTurn
      ? Array.from(
          answerTurn.querySelectorAll<HTMLElement>(
            '[data-message-author-role="assistant"][data-message-id]'
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
      answerTurn?.querySelectorAll(
        '[data-message-author-role="assistant"] .markdown'
      ).length ?? 0,
    rawHeadingCount:
      answerContainer?.querySelectorAll(HEADING_SELECTOR).length ?? 0,
  });

  return answerContainer;
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
  const outline = promptOutlines.get(index)?.entries || [];
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

  currentPromptIndex = promptIndex;
  updateAllPromptItems();
  jumpToOutlineEntry(entry, promptIndex, () =>
    resolveCurrentOutlineHeading(promptIndex, entry)
  );
}

/**
 * Re-extracts the current Assistant and resolves one cached heading descriptor.
 */
function resolveCurrentOutlineHeading(
  promptIndex: number,
  targetEntry: OutlineEntry
): HTMLElement | null {
  const currentEntry = getPromptOutline(promptIndex).find(
    ({ headingLevel, text, occurrence }) =>
      headingLevel === targetEntry.headingLevel &&
      text === targetEntry.text &&
      occurrence === targetEntry.occurrence
  );

  return currentEntry?.element || null;
}
