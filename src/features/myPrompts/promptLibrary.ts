/**
 * Manages the saved prompt library, including dialogs, import, export,
 * and CRUD operations.
 */
import type {
  PromptsChangedListener,
  PromptStore,
  SavedPrompt,
} from './promptStore';
import type { PromptUsageStore } from './promptUsageStore';
import {
  promptEditorController,
  type PromptEditorValues,
} from './promptEditor';
import {
  formatPromptsAsMarkdown,
  parseMarkdownPrompts,
} from './promptSerializer';
import {
  showPromptModal,
} from './promptDialogController';

type VoidCallback = () => void;

interface PromptLibraryDependencies {
  promptsStore: PromptStore;
  promptUsageStore: PromptUsageStore;
  insertIntoChatGPTInput: (text: string) => void;
}

let promptsStore: PromptStore | null = null;
let promptUsageStore: PromptUsageStore | null = null;
let insertIntoChatGPTInput: (text: string) => void = () => {};

/**
 * Connects the prompt library to its storage and input dependencies.
 * @param {Object} dependencies
 * @param {Object} dependencies.promptsStore
 * @param {Object} dependencies.promptUsageStore
 * @param {(text: string) => void} dependencies.insertIntoChatGPTInput
 */
export function initializePromptLibrary(
  dependencies: PromptLibraryDependencies
): void {
  promptsStore = dependencies.promptsStore;
  promptUsageStore = dependencies.promptUsageStore;
  insertIntoChatGPTInput = dependencies.insertIntoChatGPTInput;
}

/**
 * Retrieves prompts from the prompt store.
 * @returns {Promise<Array>}
 */
export async function getMyPrompts(): Promise<SavedPrompt[]> {
  return requirePromptStore().getAll();
}

/**
 * Returns a synchronous snapshot of the prompt collection for React subscriptions.
 * @returns {SavedPrompt[]}
 */
export function getMyPromptsSnapshot(): SavedPrompt[] {
  return requirePromptStore().getSnapshot();
}

/**
 * Persists prompts through the prompt store.
 * @param {Array} prompts
 * @returns {Promise<void>}
 */
export async function saveMyPrompts(prompts: SavedPrompt[]): Promise<void> {
  return requirePromptStore().saveAll(prompts);
}

/**
 * Registers a listener for prompt store changes.
 * @param {(prompts: Array) => void} listener
 * @returns {() => void}
 */
export function onPromptsChanged(listener: PromptsChangedListener): () => void {
  return requirePromptStore().subscribe(listener);
}

function requirePromptStore(): PromptStore {
  if (!promptsStore) {
    throw new Error('Prompt library has not been initialized');
  }
  return promptsStore;
}

function requirePromptUsageStore(): PromptUsageStore {
  if (!promptUsageStore) {
    throw new Error('Prompt usage store has not been initialized');
  }
  return promptUsageStore;
}

/**
 * Downloads saved prompts as an editable Markdown file.
 * @returns {Promise<void>}
 */
export async function exportMyPrompts(): Promise<void> {
  const prompts = await getMyPrompts();
  const file = new Blob([formatPromptsAsMarkdown(prompts)], {
    type: 'text/markdown;charset=utf-8',
  });
  const downloadUrl = URL.createObjectURL(file);
  const link = document.createElement('a');

  link.href = downloadUrl;
  link.download = `chat-toc-prompts-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

/**
 * Opens a Markdown file and appends its prompts to the current collection.
 * @param {() => void} [onImport]
 * @returns {void}
 */
export function importMyPrompts(onImport?: VoidCallback): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,text/markdown,text/plain';
  input.hidden = true;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    try {
      const promptsToImport = parseMarkdownPrompts(await file.text());
      if (!promptsToImport.length) {
        await showPromptModal({
          title: 'Import Prompts',
          message: 'No valid prompts found in the selected Markdown file.',
        });
        return;
      }

      const existingPrompts = await getMyPrompts();
      const importedAt = Date.now();
      const importedPrompts = promptsToImport.map((prompt, index) => ({
        id: `prompt-${importedAt}-${index}`,
        title: prompt.title,
        content: prompt.content,
        createdAt: importedAt,
        updatedAt: importedAt,
      }));

      await saveMyPrompts([...existingPrompts, ...importedPrompts]);
      onImport?.();
      await showPromptModal({
        title: 'Import Prompts',
        message: `Imported ${importedPrompts.length} prompt${
          importedPrompts.length === 1 ? '' : 's'
        }.`,
      });
    } catch (error) {
      await showPromptModal({
        title: 'Import Prompts',
        message: 'Unable to import prompts from the selected file.',
      });
    }
  });

  input.addEventListener('cancel', () => input.remove(), { once: true });

  document.body.appendChild(input);
  input.click();
}

/**
 * Clears all saved prompts and their associated usage metadata.
 * @param {() => void} [onRefresh]
 */
export async function clearAllMyPrompts(onRefresh?: VoidCallback): Promise<void> {
  const prompts = await getMyPrompts();
  if (!prompts.length) return;

  const shouldClear = await showPromptModal({
    title: 'Clear all My Prompts',
    message: `Are you sure you want to permanently delete all ${prompts.length} prompts?`,
    confirm: true,
    confirmText: 'Clear all',
  });
  if (!shouldClear) return;

  try {
    await saveMyPrompts([]);
    await requirePromptUsageStore().clear();
    onRefresh?.();
  } catch (error) {
    await showPromptModal({
      title: 'Clear all My Prompts',
      message: 'Unable to clear your prompts.',
    });
  }
}

/**
 * Copies text to the system clipboard and reports an error through the prompt modal.
 * @param {string} text
 * @param {string} title
 */
export async function copyPromptText(text: string, title: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await showPromptModal({
      title,
      message: 'Unable to copy the prompt text.',
    });
  }
}

/**
 * Deletes a single prompt after confirmation and cleans up its usage metadata.
 * @param {SavedPrompt} item
 * @param {() => void} [onRefresh]
 */
export async function deletePrompt(
  item: SavedPrompt,
  onRefresh?: VoidCallback
): Promise<void> {
  const shouldDelete = await showPromptModal({
    title: 'Delete Prompt',
    message: `Are you sure you want to delete "${item.title}"?`,
    confirm: true,
    confirmText: 'Delete',
  });

  if (!shouldDelete) return;

  try {
    const prompts = await getMyPrompts();
    const filtered = prompts.filter((p) => p.id !== item.id);
    await saveMyPrompts(filtered);
    void requirePromptUsageStore().remove(item.id).catch(() => undefined);
    onRefresh?.();
  } catch (error) {
    await showPromptModal({
      title: 'Delete Prompt',
      message: 'Unable to delete this prompt.',
    });
  }
}

/**
 * Inserts prompt content into the active ChatGPT input.
 * @param {string} text
 */
export function insertPrompt(text: string): void {
  insertIntoChatGPTInput(text);
}

/**
 * Opens the Create/Edit dialog for a prompt item.
 * @param {Object|null} item The item to edit, or null to create a new one.
 * @param {() => void} onSave Callback triggered when a save succeeds.
 */
export function showDialog(
  item: Partial<SavedPrompt> | null = null,
  onSave: VoidCallback = () => {}
): void {
  promptEditorController.open(item, async (values) => {
    await savePromptEditorValues(item, values);
    onSave();
  });
}

/**
 * Applies values from the React editor to the existing prompt collection.
 */
async function savePromptEditorValues(
  item: Partial<SavedPrompt> | null,
  { title, content }: PromptEditorValues
): Promise<void> {
  try {
    const prompts = await getMyPrompts();
    const isNew = !item?.id;

    if (isNew) {
      const now = Date.now();
      prompts.push({
        id: `prompt-${now}`,
        title,
        content,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const existingPrompt = prompts.find((prompt) => prompt.id === item.id);
      if (existingPrompt) {
        existingPrompt.title = title;
        existingPrompt.content = content;
        existingPrompt.updatedAt = Date.now();
      }
    }

    await saveMyPrompts(prompts);
  } catch (error) {
    await showPromptModal({
      title: 'Save Prompt',
      message: 'Unable to save this prompt.',
    });
    throw error;
  }
}

/**
 * Legacy compatibility stub. MyPrompts UI rendering is now managed
 * declaratively by MyPromptsView via React portal.
 * @param {HTMLElement} [_container]
 * @param {string} [_searchQuery]
 * @param {() => void} [_onRefresh]
 */
export async function renderMyPrompts(
  _container?: HTMLElement,
  _searchQuery = '',
  _onRefresh: VoidCallback = () => {}
): Promise<void> {
  // Legacy stub: rendering is now managed declaratively by MyPromptsView
}
