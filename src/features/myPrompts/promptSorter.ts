/**
 * Provides sorting algorithms and sort modes for saved prompts.
 */
import type { SavedPrompt } from './promptStore';

export type SortMode = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

/**
 * Sorts a list of saved prompts based on the specified sort mode.
 * Returns a new array without mutating the input array.
 * @param {Array<SavedPrompt>} list The prompt list to sort.
 * @param {SortMode} sortMode The sorting order criteria.
 * @returns {Array<SavedPrompt>} A sorted copy of the prompt list.
 * @example
 * ```ts
 * const sorted = sortMyPrompts(prompts, 'name_asc');
 * ```
 */
export function sortMyPrompts(
  list: SavedPrompt[],
  sortMode: SortMode
): SavedPrompt[] {
  const sorted = [...list];
  if (sortMode === 'updated_desc') {
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (sortMode === 'updated_asc') {
    sorted.sort((a, b) => a.updatedAt - b.updatedAt);
  } else if (sortMode === 'name_asc') {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === 'name_desc') {
    sorted.sort((a, b) => b.title.localeCompare(a.title));
  }
  return sorted;
}
