/**
 * Navigates from a visible LunaTOC child-outline item to its ChatGPT heading.
 */
import { jumpToPromptIndex, lockPromptIndex } from './promptNavigation';
import { logOutlineDiagnostic } from './outlineDiagnostics';

export interface OutlineNavigationEntry {
  element?: HTMLElement;
  sectionId?: string;
  text?: string;
}

/** Resolves the current DOM node for a cached Outline heading descriptor. */
export type OutlineHeadingResolver = () => HTMLElement | null;

const HEADING_HIGHLIGHT_CLASS = 'chat-toc-outline-heading-highlight';
const OUTLINE_JUMP_RETRY_DELAY_MS = 250;
const OUTLINE_JUMP_MAX_ATTEMPTS = 16;

let highlightedHeadingElement: HTMLElement | null = null;
let outlineJumpVersion = 0;

/**
 * Navigates to an already displayed outline entry, restoring its parent
 * prompt first when ChatGPT has virtualized the heading.
 */
export function jumpToOutlineEntry(
  entry: OutlineNavigationEntry,
  promptIndex: number,
  resolveCurrentHeading: OutlineHeadingResolver
): void {
  const jumpVersion = outlineJumpVersion + 1;
  outlineJumpVersion = jumpVersion;

  logOutlineDiagnostic('OUTLINE_JUMP_STARTED', {
    promptIndex,
    text: entry.text || null,
    sectionId: entry.sectionId || null,
    cachedElementConnected: entry.element?.isConnected ?? false,
    jumpVersion,
  });
  const heading = resolveOutlineHeading(entry, resolveCurrentHeading);
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
    jumpVersion,
    resolveCurrentHeading
  );
}

/** Cancels pending child-outline navigation and clears its heading highlight. */
export function cancelOutlineNavigation(): void {
  outlineJumpVersion += 1;
  clearHighlightedHeading();
}

function retryOutlineEntryJump(
  entry: OutlineNavigationEntry,
  promptIndex: number,
  attempts: number,
  jumpVersion: number,
  resolveCurrentHeading: OutlineHeadingResolver
): void {
  if (jumpVersion !== outlineJumpVersion) return;

  const heading = resolveOutlineHeading(entry, resolveCurrentHeading);
  if (heading) {
    finishOutlineEntryJump(heading, promptIndex, jumpVersion);
    return;
  }
  if (attempts <= 1) {
    logOutlineDiagnostic('OUTLINE_JUMP_EXHAUSTED', {
      promptIndex,
      text: entry.text || null,
      sectionId: entry.sectionId || null,
      cachedElementConnected: entry.element?.isConnected ?? false,
      jumpVersion,
    });
    return;
  }

  setTimeout(() => {
    retryOutlineEntryJump(
      entry,
      promptIndex,
      attempts - 1,
      jumpVersion,
      resolveCurrentHeading
    );
  }, OUTLINE_JUMP_RETRY_DELAY_MS);
}

function finishOutlineEntryJump(
  heading: HTMLElement,
  promptIndex: number,
  jumpVersion: number
): void {
  if (jumpVersion !== outlineJumpVersion) return;

  logOutlineDiagnostic('OUTLINE_JUMP_RESOLVED', {
    promptIndex,
    headingText: heading.textContent?.trim() || null,
    sectionId: heading.dataset.sectionId || null,
    headingConnected: heading.isConnected,
    jumpVersion,
  });
  lockPromptIndex(promptIndex);
  highlightHeading(heading);
  heading.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

function resolveOutlineHeading(
  entry: OutlineNavigationEntry,
  resolveCurrentHeading: OutlineHeadingResolver
): HTMLElement | null {
  return entry.element?.isConnected ? entry.element : resolveCurrentHeading();
}

function highlightHeading(heading: HTMLElement): void {
  clearHighlightedHeading();
  heading.classList.add(HEADING_HIGHLIGHT_CLASS);
  highlightedHeadingElement = heading;
}

function clearHighlightedHeading(): void {
  highlightedHeadingElement?.classList.remove(HEADING_HIGHLIGHT_CLASS);
  highlightedHeadingElement = null;
}
