/**
 * Coordinates building per-prompt answer outlines from rendered ChatGPT
 * headings, manages accordion UI state, and dispatches outline navigation.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { isPromptMarked as isMessageMarked } from '@/features/conversationPrompts/promptMark';
import {
  cancelOutlineNavigation,
  jumpToOutlineEntry,
} from './outlineNavigation';
import { logOutlineDiagnostic } from './outlineDiagnostics';
import {
  getPromptOutline as extractPromptOutline,
  type OutlineEntry,
} from './headingExtractor';
import * as outlineCache from './outlineCache';

export type { OutlineEntry };

interface PromptItemEntry {
  item: HTMLElement;
  outlineIndicator: HTMLButtonElement;
  outlineList: HTMLDivElement;
}

interface CreatePromptItemOptions {
  item: HTMLElement;
  index: number;
  messageId: string;
  onToggle?: () => void;
}

interface PromptNavigationAction {
  shouldBuild: boolean;
}

const OUTLINE_BUILD_RETRY_DELAY_MS = 300;
const OUTLINE_BUILD_MAX_ATTEMPTS = 40;

const expandedPromptOutlines = new Set<number>();
const promptItems = new Map<number, PromptItemEntry>();
let currentPromptIndex: number | null = null;
let pendingOutlineIndex: number | null = null;
let outlineBuildVersion = 0;

/**
 * Extracts the two-level heading outline from a rendered prompt answer.
 * @param {number} index Prompt index in the main LunaTOC navigator.
 * @returns {Array<OutlineEntry>}
 */
export function getPromptOutline(index: number): OutlineEntry[] {
  return extractPromptOutline(index, outlineCache.getPromptMessageId(index));
}

/**
 * Clears all outline state for the active conversation.
 */
export function resetOutline(): void {
  cancelOutlineNavigation();
  outlineBuildVersion += 1;
  outlineCache.clearOutlineCache();
  expandedPromptOutlines.clear();
  resetPromptItems();
  currentPromptIndex = null;
  pendingOutlineIndex = null;
}

/**
 * Clears registered prompt row DOM without removing cached outlines.
 */
export function resetPromptItems(): void {
  promptItems.clear();
}

/**
 * Replaces the prompt index to message ID mapping for the active conversation.
 * @param {Array<NavigatorMessage>} messages Navigator messages in display order.
 */
export function setPromptMessages(messages: NavigatorMessage[]): void {
  outlineCache.setPromptMessages(messages).forEach(handleInvalidatedOutline);
}

function handleInvalidatedOutline(index: number): void {
  expandedPromptOutlines.delete(index);
  updatePromptItemByIndex(index);
}

/**
 * Creates and registers the outline-related DOM pieces for a prompt row.
 * @param {CreatePromptItemOptions} params
 * @returns {{ outlineIndicator: HTMLElement, outlineList: HTMLElement }}
 */
export function createPromptItem({
  item,
  index,
  onToggle,
}: CreatePromptItemOptions): {
  outlineIndicator: HTMLButtonElement;
  outlineList: HTMLDivElement;
} {
  const outlineIndicator = document.createElement('button');
  const outlineList = document.createElement('div');

  outlineIndicator.type = 'button';
  outlineIndicator.className = 'navigator-outline-indicator';
  outlineIndicator.innerHTML = getOutlineIndicatorIcon();
  outlineIndicator.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle?.();
  });

  const entry = {
    item,
    outlineIndicator,
    outlineList,
  };

  promptItems.set(index, entry);
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
 * @returns {PromptNavigationAction} Whether caller should try building outline after navigation.
 */
export function handlePromptNavigation(
  index: number,
  _activeIndex: number | null
): PromptNavigationAction {
  cancelOutlineNavigation();

  const cachedOutline = outlineCache.getReusablePromptOutline(index, () =>
    getPromptOutline(index)
  );

  if (cachedOutline) {
    logOutlineDiagnostic('OUTLINE_CACHE_REUSED', {
      promptIndex: index,
      promptMessageId: outlineCache.getPromptMessageId(index),
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
    pendingOutlineIndex = null;
    currentPromptIndex = index;
    togglePromptOutline(index);
    updateAllPromptItems();

    return {
      shouldBuild: false,
    };
  }

  // First click requests expansion even before the answer has been mounted.
  // A second click while still loading collapses it and cancels the build.
  const shouldBuild = !expandedPromptOutlines.has(index);
  setCurrentPrompt(index);
  if (shouldBuild) {
    pendingOutlineIndex = index;
    expandedPromptOutlines.add(index);
  } else {
    if (pendingOutlineIndex === index) pendingOutlineIndex = null;
    expandedPromptOutlines.delete(index);
    outlineBuildVersion += 1;
  }
  updatePromptItemByIndex(index);

  return { shouldBuild };
}

/**
 * Syncs outline UI when LunaTOC's active prompt changes outside a prompt-row
 * click, such as native/chat scroll activation.
 * @param {number} index Active prompt index.
 */
export function syncActivePrompt(index: number): void {
  if (index === currentPromptIndex) return;
  // A virtualized answer is being mounted for an explicit triangle click.
  // Intermediate active-prompt updates must not collapse the requested outline.
  if (pendingOutlineIndex !== null && index !== pendingOutlineIndex) return;

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
 * @param {number | null} index Prompt index allowed to stay expanded.
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
  const messageId = outlineCache.getPromptMessageId(index);

  return Boolean(messageId && isMessageMarked(messageId));
}

/**
 * Lazily builds and stores an outline for a prompt, then refreshes its row UI.
 * @param {number} index Prompt index to build an outline for.
 * @param {number} [attempts] Remaining build attempts.
 */
export function scheduleBuild(
  index: number,
  attempts = OUTLINE_BUILD_MAX_ATTEMPTS
): void {
  const buildVersion = outlineBuildVersion + 1;

  logOutlineDiagnostic('OUTLINE_BUILD_SCHEDULED', {
    promptIndex: index,
    promptMessageId: outlineCache.getPromptMessageId(index),
    attempts,
    buildVersion,
  });
  outlineBuildVersion = buildVersion;
  runBuild(index, attempts, buildVersion);
}

/**
 * Retries outline extraction while ignoring stale async build attempts.
 */
function runBuild(index: number, attempts: number, buildVersion: number): void {
  if (buildVersion !== outlineBuildVersion || index !== currentPromptIndex) {
    return;
  }

  const outline = getPromptOutline(index);

  if (!outline.length) {
    if (attempts <= 1) {
      if (pendingOutlineIndex === index) {
        pendingOutlineIndex = null;
        expandedPromptOutlines.delete(index);
        updatePromptItemByIndex(index);
      }
      return;
    }

    setTimeout(() => {
      runBuild(index, attempts - 1, buildVersion);
    }, OUTLINE_BUILD_RETRY_DELAY_MS);
    return;
  }

  if (buildVersion !== outlineBuildVersion || index !== currentPromptIndex) {
    return;
  }

  const cached = outlineCache.cachePromptOutline(index, outline);
  if (!cached) return;

  if (pendingOutlineIndex === index) pendingOutlineIndex = null;
  currentPromptIndex = index;
  updatePromptItemByIndex(index);
}

/**
 * Toggles whether a prompt's already-built outline is expanded.
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
 */
function updatePromptItemState(entry: PromptItemEntry, index: number): void {
  const outline = outlineCache.getCachedEntries(index);
  const isCurrent = index === currentPromptIndex;
  const isMarkExpanded =
    expandedPromptOutlines.has(index) && isPromptMarked(index);
  const hasVisibleOutline = (isCurrent || isMarkExpanded) && outline.length > 0;
  const isExpanded = expandedPromptOutlines.has(index) && hasVisibleOutline;

  entry.item.classList.toggle('navigator-item-has-outline', hasVisibleOutline);
  entry.item.classList.toggle('navigator-item-outline-expanded', isExpanded);

  entry.outlineIndicator.dataset.expanded = String(isExpanded);
  entry.outlineIndicator.setAttribute('aria-expanded', String(isExpanded));
  entry.outlineIndicator.setAttribute(
    'aria-label',
    isExpanded ? '收起回答标题' : '展开回答标题'
  );

  renderOutlineList(entry.outlineList, outline, isExpanded, index);
}

/**
 * Returns the shared chevron icon used by collapsed and expanded outlines.
 * CSS rotates the same SVG so both states stay visually consistent.
 */
function getOutlineIndicatorIcon(): string {
  return `
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M3 5h10L8 11Z" />
      </svg>
    `;
}

/**
 * Renders the visible heading rows for an expanded prompt outline.
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
 */
function handleOutlineItemClick(
  event: MouseEvent,
  entry: OutlineEntry,
  promptIndex: number
): void {
  event.stopPropagation();

  if (currentPromptIndex !== promptIndex) {
    currentPromptIndex = promptIndex;
    collapseAllExcept(promptIndex);
    updateAllPromptItems();
  }
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
