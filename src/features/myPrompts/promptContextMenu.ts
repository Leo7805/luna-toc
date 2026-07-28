/**
 * Bridges My Prompts context-menu requests to the shared React menu UI.
 */
import type { ContextMenuItem } from '@/components/ui/context-menu';

export interface PromptContextMenuPosition {
  left: number;
  top: number;
}

interface PromptContextMenuRequest {
  id: number;
  position: PromptContextMenuPosition;
  items: ContextMenuItem[];
  onSelect: (itemId: string) => void;
  onClose?: () => void;
}

type PromptContextMenuListener = () => void;

let requestId = 0;
let currentRequest: PromptContextMenuRequest | null = null;
const listeners = new Set<PromptContextMenuListener>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function show(
  position: PromptContextMenuPosition,
  items: ContextMenuItem[],
  onSelect: (itemId: string) => void,
  onClose?: () => void
): void {
  close();
  currentRequest = {
    id: ++requestId,
    position,
    items,
    onSelect,
    onClose,
  };
  emitChange();
}

function close(): void {
  if (!currentRequest) return;
  const request = currentRequest;
  currentRequest = null;
  emitChange();
  request.onClose?.();
}

function select(itemId: string): void {
  const request = currentRequest;
  close();
  request?.onSelect(itemId);
}

function subscribe(listener: PromptContextMenuListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PromptContextMenuRequest | null {
  return currentRequest;
}

/**
 * Provides the state bridge shared by the legacy prompt list and React menu.
 *
 * @example
 * promptContextMenuController.show({ left: 120, top: 80 }, items, selectItem);
 */
export const promptContextMenuController = {
  show,
  close,
  select,
  subscribe,
  getSnapshot,
};
