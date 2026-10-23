/**
 * Edge scrolling utilities for the LunaTOC sidebar list containers.
 */

export type ConversationEdge = 'top' | 'bottom';

/**
 * Scrolls the active My Prompts list (or TOC list fallback) to one of its absolute edges.
 *
 * @param {ConversationEdge} edge Target conversation edge ('top' | 'bottom').
 * @param {ScrollBehavior} [behavior='smooth'] Scrolling animation behavior.
 */
export function scrollNavigatorListToEdge(
  edge: ConversationEdge,
  behavior: ScrollBehavior = 'smooth'
): void {
  const list =
    document.getElementById('myprompts-list') ??
    document.getElementById('navigator-list');
  if (!list) return;
  list.scrollTo({
    top: edge === 'top' ? 0 : list.scrollHeight,
    behavior,
  });
}
