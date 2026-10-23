/**
 * Bridges My Prompts message and confirmation dialog requests to the React dialog UI.
 */

/**
 * Options used to open the prompt message or confirmation dialog.
 */
export interface PromptDialogOptions {
  title: string;
  message: string;
  confirm?: boolean;
  confirmText?: string;
  cancelText?: string;
}

export interface PromptDialogRequest extends PromptDialogOptions {
  id: number;
  resolve: (value: boolean) => void;
}

type PromptDialogListener = () => void;

let requestId = 0;
let currentRequest: PromptDialogRequest | null = null;
const listeners = new Set<PromptDialogListener>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Shows an informational message or confirmation dialog using React.
 * Resolves to `true` when confirmed, or `false` when cancelled or dismissed.
 *
 * @param {PromptDialogOptions} options Dialog configuration options.
 * @returns {Promise<boolean>} Promise resolving with the user's choice.
 *
 * @example
 * const confirmed = await showPromptModal({
 *   title: 'Delete Prompt',
 *   message: 'Are you sure you want to delete this prompt?',
 *   confirm: true,
 *   confirmText: 'Delete',
 * });
 */
export function showPromptModal(options: PromptDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // If a request is already active, safely resolve it with false so no pending promises hang.
    if (currentRequest) {
      currentRequest.resolve(false);
    }

    currentRequest = {
      ...options,
      id: ++requestId,
      resolve,
    };
    emitChange();
  });
}

/**
 * Closes the active prompt dialog and resolves its pending promise.
 *
 * @param {boolean} [result=false] The resolution value for the pending promise.
 */
export function closePromptModal(result = false): void {
  if (!currentRequest) return;
  const request = currentRequest;
  currentRequest = null;
  emitChange();
  request.resolve(result);
}

/**
 * Returns the current dialog request snapshot for state subscribers.
 *
 * @returns {PromptDialogRequest | null} The active request or null.
 */
export function getPromptModalSnapshot(): PromptDialogRequest | null {
  return currentRequest;
}

/**
 * Subscribes to changes in prompt dialog requests.
 *
 * @param {PromptDialogListener} listener Callback fired on request changes.
 * @returns {() => void} Unsubscribe function.
 */
export function subscribePromptModal(listener: PromptDialogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resets the prompt modal controller, resolving any pending request with false.
 * Useful for test isolation and teardown.
 */
export function resetPromptModal(): void {
  if (currentRequest) {
    const request = currentRequest;
    currentRequest = null;
    emitChange();
    request.resolve(false);
  }
}

export const promptDialogController = {
  showPromptModal,
  closePromptModal,
  getSnapshot: getPromptModalSnapshot,
  subscribe: subscribePromptModal,
  reset: resetPromptModal,
};
