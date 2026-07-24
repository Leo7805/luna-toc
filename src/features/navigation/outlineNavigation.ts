/**
 * Navigates from a visible LunaTOC child-outline item to its ChatGPT heading.
 */
import {
  jumpToPromptIndex,
  lockPromptIndex,
} from './promptNavigation';

export interface OutlineNavigationEntry {
  element?: HTMLElement;
  sectionId?: string;
}

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
  promptIndex: number
): void {
  const jumpVersion = outlineJumpVersion + 1;
  outlineJumpVersion = jumpVersion;

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

/** Cancels pending child-outline navigation and clears its heading highlight. */
export function cancelOutlineNavigation(): void {
  outlineJumpVersion += 1;
  clearHighlightedHeading();
}

function retryOutlineEntryJump(
  entry: OutlineNavigationEntry,
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

function resolveOutlineHeading(
  entry: OutlineNavigationEntry
): HTMLElement | null {
  if (entry.sectionId) {
    return document.querySelector<HTMLElement>(
      `[data-section-id="${escapeCssIdentifier(entry.sectionId)}"]`
    );
  }

  return entry.element?.isConnected ? entry.element : null;
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

function escapeCssIdentifier(value: string): string {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
