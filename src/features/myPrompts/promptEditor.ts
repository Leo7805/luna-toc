/**
 * Bridges imperative My Prompts actions to the React prompt editor.
 */
import type { SavedPrompt } from './promptStore';

/** Values submitted by the prompt editor form. */
export interface PromptEditorValues {
  title: string;
  content: string;
}

interface PromptEditorRequest {
  id: number;
  item: Partial<SavedPrompt> | null;
  onSubmit: (values: PromptEditorValues) => Promise<void>;
}

type PromptEditorListener = () => void;

let requestId = 0;
let currentRequest: PromptEditorRequest | null = null;
const listeners = new Set<PromptEditorListener>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function open(
  item: Partial<SavedPrompt> | null,
  onSubmit: PromptEditorRequest['onSubmit']
): void {
  currentRequest = {
    id: ++requestId,
    item,
    onSubmit,
  };
  emitChange();
}

function close(): void {
  if (!currentRequest) return;
  currentRequest = null;
  emitChange();
}

function subscribe(listener: PromptEditorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PromptEditorRequest | null {
  return currentRequest;
}

/**
 * Provides the state bridge shared by the legacy prompt library and React UI.
 *
 * @example
 * promptEditorController.open(null, async ({ title, content }) => {
 *   await savePrompt(title, content);
 * });
 */
export const promptEditorController = {
  open,
  close,
  subscribe,
  getSnapshot,
};
