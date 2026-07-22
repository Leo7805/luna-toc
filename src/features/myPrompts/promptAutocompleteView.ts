/**
 * Bridges ChatGPT composer autocomplete behavior to the React suggestion view.
 */
import type { SavedPrompt } from './promptStore';

/** Viewport coordinates used to position the autocomplete menu. */
export interface PromptAutocompletePosition {
  left: number;
  width: number;
  anchorTop: number;
  anchorBottom: number;
  viewportHeight: number;
}

interface PromptAutocompleteViewState {
  id: number;
  prompts: SavedPrompt[];
  selectedIndex: number;
  position: PromptAutocompletePosition;
  onSelect: (prompt: SavedPrompt) => void;
}

type PromptAutocompleteViewListener = () => void;

let viewId = 0;
let currentState: PromptAutocompleteViewState | null = null;
const listeners = new Set<PromptAutocompleteViewListener>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function show(
  prompts: SavedPrompt[],
  selectedIndex: number,
  position: PromptAutocompletePosition,
  onSelect: PromptAutocompleteViewState['onSelect']
): void {
  currentState = {
    id: ++viewId,
    prompts,
    selectedIndex,
    position,
    onSelect,
  };
  emitChange();
}

function close(): void {
  if (!currentState) return;
  currentState = null;
  emitChange();
}

function setSelectedIndex(selectedIndex: number): void {
  if (!currentState || currentState.selectedIndex === selectedIndex) return;
  currentState = { ...currentState, selectedIndex };
  emitChange();
}

function select(index: number): void {
  const prompt = currentState?.prompts[index];
  if (prompt) currentState?.onSelect(prompt);
}

function subscribe(listener: PromptAutocompleteViewListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PromptAutocompleteViewState | null {
  return currentState;
}

/**
 * Provides the shared state used by composer logic and the React menu.
 *
 * @example
 * promptAutocompleteViewController.close();
 */
export const promptAutocompleteViewController = {
  show,
  close,
  setSelectedIndex,
  select,
  subscribe,
  getSnapshot,
};
