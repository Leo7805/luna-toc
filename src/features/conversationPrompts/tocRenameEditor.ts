/** Bridges the TOC rename dialog to imperative navigation actions. */
interface RenameRequest {
  id: number;
  value: string;
  onSubmit: (value: string) => Promise<void>;
}
let id = 0;
let request: RenameRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void { listeners.forEach((listener) => listener()); }

/** Opens a rename dialog for an existing ChatGPT message. */
function open(value: string, onSubmit: RenameRequest['onSubmit']): void {
  request = { id: ++id, value, onSubmit };
  emit();
}

/** Closes the dialog without modifying the original message. */
function close(): void {
  if (!request) return;
  request = null;
  emit();
}

export const tocRenameEditorController = {
  open,
  close,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): RenameRequest | null { return request; },
};
