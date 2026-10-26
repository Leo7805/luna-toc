/**
 * Manages the saved prompt library, including dialogs, list rendering,
 * sorting, import, export, and CRUD operations.
 */
import type {
  PromptsChangedListener,
  PromptStore,
  SavedPrompt,
} from './promptStore';
import { getActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';
import type { PromptUsageStore } from './promptUsageStore';
import {
  promptEditorController,
  type PromptEditorValues,
} from './promptEditor';
import { promptContextMenuController } from './promptContextMenu';

import { previewTooltip } from '@/features/tooltip';

import {
  formatPromptsAsMarkdown,
  parseMarkdownPrompts,
} from './promptSerializer';
import {
  sortMyPrompts,
  type SortMode,
} from './promptSorter';

type VoidCallback = () => void;

interface PromptLibraryDependencies {
  promptsStore: PromptStore;
  promptUsageStore: PromptUsageStore;
  insertIntoChatGPTInput: (text: string) => void;
}

interface PromptDialogOptions {
  title: string;
  message: string;
  confirm?: boolean;
  confirmText?: string;
  cancelText?: string;
}

function getRequiredElement<T extends Element>(
  root: ParentNode,
  selector: string
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required My Prompts element not found: ${selector}`);
  }
  return element;
}

let activeSort: SortMode = 'updated_desc';
let renderVersion = 0;
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
async function exportMyPrompts(): Promise<void> {
  const prompts = await getMyPrompts();
  const file = new Blob([formatPromptsAsMarkdown(prompts)], {
    type: 'text/markdown;charset=utf-8',
  });
  const downloadUrl = URL.createObjectURL(file);
  const link = document.createElement('a');

  link.href = downloadUrl;
  link.download = `luna-toc-prompts-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}


/**
 * Opens a Markdown file and appends its prompts to the current collection.
 * @param {() => void} onImport
 * @returns {void}
 */
function importMyPrompts(onImport: VoidCallback): void {
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
          title: '导入提示词',
          message: '所选 Markdown 文件中未找到有效的提示词。',
        });
        return;
      }

      const ownerId = getActiveConversationOwner();
      if (!ownerId) throw new Error('ChatGPT 账号未验证，无法导入提示词。');
      const importedAt = Date.now();
      const importedPrompts = promptsToImport.map((prompt, index) => ({
        id: `prompt-${importedAt}-${index}-${crypto.randomUUID()}`,
        ownerId,
        title: prompt.title,
        content: prompt.content,
        createdAt: importedAt,
        updatedAt: importedAt,
      }));

      await requirePromptStore().update((existingPrompts) => [...existingPrompts, ...importedPrompts]);
      onImport();
      await showPromptModal({
        title: '导入提示词',
        message: `已导入 ${importedPrompts.length} 条提示词。`,
      });
    } catch (error) {
      await showPromptModal({
        title: '导入提示词',
        message: error instanceof Error ? error.message : '无法从所选文件导入提示词。',
      });
    }
  });

  input.addEventListener('cancel', () => input.remove(), { once: true });

  document.body.appendChild(input);
  input.click();
}



/**
 * Escapes text inserted into HTML templates.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

/**
 * Shows a message or confirmation dialog using the My Prompts modal style.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {boolean} [options.confirm=false]
 * @param {string} [options.confirmText='OK']
 * @param {string} [options.cancelText='Cancel']
 * @returns {Promise<boolean>}
 */
function showPromptModal({
  title,
  message,
  confirm = false,
  confirmText = '确定',
  cancelText = '取消',
}: PromptDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let modal = document.getElementById('chat-toc-myprompt-message-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'chat-toc-myprompt-message-modal';
      modal.className = 'myprompt-modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="myprompt-modal-content myprompt-message-modal-content">
        <h3 class="myprompt-modal-title">${escapeHtml(title)}</h3>
        <p class="myprompt-modal-message">${escapeHtml(message)}</p>
        <div class="myprompt-modal-actions">
          ${
            confirm
              ? `<button type="button" id="myprompt-message-cancel" class="myprompt-btn myprompt-btn-secondary">${escapeHtml(
                  cancelText
                )}</button>`
              : ''
          }
          <button type="button" id="myprompt-message-confirm" class="myprompt-btn myprompt-btn-primary">${escapeHtml(
            confirmText
          )}</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    const handleBackdropClick = (event: MouseEvent): void => {
      if (event.target === modal) {
        close(false);
      }
    };

    const close = (result: boolean): void => {
      modal.removeEventListener('click', handleBackdropClick);
      modal.style.display = 'none';
      resolve(result);
    };

    const confirmButton = getRequiredElement<HTMLButtonElement>(
      modal,
      '#myprompt-message-confirm'
    );
    confirmButton.addEventListener('click', () => close(true), { once: true });

    modal
      .querySelector('#myprompt-message-cancel')
      ?.addEventListener('click', () => close(false), { once: true });

    modal.addEventListener('click', handleBackdropClick);

    confirmButton.focus();
  });
}

/**
 * Creates the sorting toolbar.
 * @param {() => void} onSortChange Callback triggered when the sorting mode
 *     changes.
 * @param {() => void} onAddNew Callback triggered when the add button is
 *     clicked.
 * @returns {HTMLElement}
 */
function createSortBar(
  onSortChange: VoidCallback,
  onAddNew: VoidCallback
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'my-prompts-sort-bar';
  bar.innerHTML = `
    <div class="sort-bar-left">
      <svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="15" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="18" y2="18"></line>
      </svg>
      <select class="my-prompts-sort-select" id="myprompt-sort-select">
        <option value="updated_desc">最近修改</option>
        <option value="updated_asc">最早修改</option>
        <option value="name_asc">标题（A-Z）</option>
        <option value="name_desc">标题（Z-A）</option>
      </select>
    </div>
    <div class="my-prompts-toolbar-actions">
      <button id="myprompt-import-btn" class="myprompt-canvas-btn" type="button" aria-label="导入提示词" title="导入提示词">
        <canvas width="14" height="14" aria-hidden="true"></canvas>
      </button>
      <button id="myprompt-export-btn" class="myprompt-canvas-btn" type="button" aria-label="导出提示词" title="导出提示词">
        <canvas width="14" height="14" aria-hidden="true"></canvas>
      </button>
      <button id="myprompt-add-new-btn" type="button" aria-label="添加提示词" title="添加提示词">+</button>
    </div>
  `;

  const select = getRequiredElement<HTMLSelectElement>(
    bar,
    '#myprompt-sort-select'
  );
  select.value = activeSort;
  select.addEventListener('change', (event) => {
    activeSort = (event.currentTarget as HTMLSelectElement).value as SortMode;
    onSortChange();
  });

  const addBtn = getRequiredElement<HTMLButtonElement>(
    bar,
    '#myprompt-add-new-btn'
  );
  addBtn.addEventListener('click', () => {
    onAddNew();
  });

  getRequiredElement<HTMLButtonElement>(
    bar,
    '#myprompt-export-btn'
  ).addEventListener('click', exportMyPrompts);

  getRequiredElement<HTMLButtonElement>(
    bar,
    '#myprompt-import-btn'
  ).addEventListener('click', () => {
    importMyPrompts(onSortChange);
  });

  drawToolbarIcon(
    getRequiredElement<HTMLCanvasElement>(bar, '#myprompt-import-btn canvas'),
    'import'
  );
  drawToolbarIcon(
    getRequiredElement<HTMLCanvasElement>(bar, '#myprompt-export-btn canvas'),
    'export'
  );

  return bar;
}

/** Clears the verified account's prompts and their associated usage metadata. */
async function clearAllMyPrompts(onRefresh: VoidCallback): Promise<void> {
  const prompts = await getMyPrompts();
  if (!prompts.length) return;

  const shouldClear = await showPromptModal({
    title: '清空Tips',
    message: `确定永久删除当前账号的全部 ${prompts.length} 条提示词吗？`,
    confirm: true,
    confirmText: '全部清空',
  });
  if (!shouldClear) return;

  try {
    await requirePromptStore().clearAll();
    onRefresh();
  } catch (error) {
    await showPromptModal({
      title: '清空Tips',
      message: error instanceof Error ? error.message : '无法清空提示词。',
    });
  }
}

/** Copies text to the system clipboard and reports an error through the prompt modal. */
async function copyPromptText(text: string, title: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await showPromptModal({
      title,
      message: '无法复制提示词内容。',
    });
  }
}

/**
 * Draws an import or export arrow icon on a toolbar canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {'import'|'export'} direction
 */
function drawToolbarIcon(
  canvas: HTMLCanvasElement,
  direction: 'import' | 'export'
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  context.strokeStyle = '#2563eb';
  context.lineWidth = 1.7;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const arrowPoints =
    direction === 'import'
      ? { startY: 11, endY: 5, headY: 7 }
      : { startY: 3, endY: 9, headY: 7 };

  context.beginPath();
  context.moveTo(7, arrowPoints.startY);
  context.lineTo(7, arrowPoints.endY);
  context.moveTo(4.5, arrowPoints.headY);
  context.lineTo(7, arrowPoints.endY);
  context.lineTo(9.5, arrowPoints.headY);
  context.moveTo(3, direction === 'import' ? 3 : 11);
  context.lineTo(11, direction === 'import' ? 3 : 11);
  context.stroke();
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
  // Stable across editor retries so an uncertain acknowledgement cannot create duplicate IDs.
  const createId = item?.id ?? `prompt-${Date.now()}-${crypto.randomUUID()}`;
  const original = item ? { ...item } : null;
  promptEditorController.open(original, async (values) => {
    await savePromptEditorValues(original, values, createId);
    onSave();
  });
}

/**
 * Applies values from the React editor to the existing prompt collection.
 */
async function savePromptEditorValues(
  item: Partial<SavedPrompt> | null,
  { title, content }: PromptEditorValues,
  createId: string
): Promise<void> {
  try {
    const ownerId = getActiveConversationOwner();
    if (!ownerId) throw new Error('ChatGPT 账号未验证，提示词未保存。');
    await requirePromptStore().update((prompts) => {
      const isNew = !item?.id;
      if (isNew) {
        const existing = prompts.find((prompt) => prompt.id === createId);
        if (existing) {
          if (existing.title !== title || existing.content !== content) {
            throw new Error('提示词 ID 冲突，请重新打开编辑器。');
          }
          return prompts; // Idempotent retry of the same new prompt.
        }
        const now = Date.now();
        prompts.push({
          id: createId,
          ownerId,
          title,
          content,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const existingPrompt = prompts.find((prompt) => prompt.id === item.id);
        if (!existingPrompt) throw new Error('提示词已不存在，请重新打开编辑器。');
        existingPrompt.title = title;
        existingPrompt.content = content;
        existingPrompt.updatedAt = Date.now();
      }
      return prompts;
    });
  } catch (error) {
    await showPromptModal({
      title: '保存提示词',
      message: error instanceof Error ? error.message : '无法保存此提示词，请检查扩展状态后重试。',
    });
    throw error;
  }
}

/**
 * Renders the entire prompts view inside a container.
 * @param {HTMLElement} container
 * @param {string} searchQuery
 * @param {() => void} onRefresh
 */
export async function renderMyPrompts(
  container: HTMLElement,
  searchQuery = '',
  onRefresh: VoidCallback = () => {}
): Promise<void> {
  const currentRenderVersion = ++renderVersion;

  const toolbarContainer = document.getElementById(
    'myprompts-toolbar-container'
  );
  if (toolbarContainer) {
    toolbarContainer.innerHTML = '';
    const sortBar = createSortBar(onRefresh, () => {
      showDialog(null, onRefresh);
    });
    toolbarContainer.appendChild(sortBar);
  }

  let list = await getMyPrompts();
  const savedPromptCount = list.length;

  if (currentRenderVersion !== renderVersion) {
    return;
  }

  container.oncontextmenu = (event) => {
    const target = event.target;
    if (
      !savedPromptCount ||
      !(target instanceof Element) ||
      target.closest('.my-prompts-item-row')
    ) {
      return;
    }

    event.preventDefault();
    previewTooltip.hide();
    promptContextMenuController.show(
      { left: event.clientX, top: event.clientY },
      [
        {
          id: 'clear-all',
          label: '清空Tips',
          icon: 'trash',
          variant: 'destructive',
        },
      ],
      (itemId) => {
        if (itemId === 'clear-all') void clearAllMyPrompts(onRefresh);
      }
    );
  };

  container.innerHTML = '';

  const query = searchQuery.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query)
    );
  }

  list = sortMyPrompts(list, activeSort);

  if (list.length === 0) {
    const emptyHint = document.createElement('p');
    emptyHint.className = 'navigator-hint';
    emptyHint.textContent = query
      ? '没有匹配的提示词。'
      : '尚未保存提示词。点击 + 添加，或右键点击目录中的提示词进行保存。';
    container.appendChild(emptyHint);
    return;
  }

  const listContainer = document.createElement('div');
  listContainer.className = 'my-prompts-items-container';

  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'navigator-item my-prompts-item-row';
    row.dataset.promptId = item.id;

    const rowMain = document.createElement('div');
    rowMain.className = 'navigator-item-main';

    const rowText = document.createElement('span');
    rowText.className = 'navigator-item-text my-prompts-item-title';
    rowText.textContent = item.title;

    const actions = document.createElement('div');
    actions.className = 'my-prompts-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'myprompt-action-btn edit-myprompt-btn';
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      previewTooltip.hide();
      showDialog(item, onRefresh);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'myprompt-action-btn delete-myprompt-btn';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
    `;
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      previewTooltip.hide();
      const shouldDelete = await showPromptModal({
        title: '删除提示词',
        message: `确定删除「${item.title}」吗？`,
        confirm: true,
        confirmText: '删除',
      });

      if (shouldDelete) {
        try {
          await requirePromptStore().update((prompts) => {
            return prompts.filter((p) => p.id !== item.id);
          });
          void requirePromptUsageStore().remove(item.id).catch(() => {
            console.warn('[LunaTOC] Prompt deleted; usage cleanup will retry on next startup');
          });
          onRefresh();
        } catch (error) {
          await showPromptModal({
            title: '删除提示词',
            message: '无法删除此提示词。',
          });
        }
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    rowMain.appendChild(rowText);
    rowMain.appendChild(actions);
    row.appendChild(rowMain);

    row.addEventListener('click', () => {
      previewTooltip.hide();
      insertIntoChatGPTInput(item.content);
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      previewTooltip.hide();
      row.classList.add('my-prompts-item-context-active');
      promptContextMenuController.show(
        { left: event.clientX, top: event.clientY },
        [
          { id: 'copy-prompt', label: '复制提示词', icon: 'copy' },
          {
            id: 'clear-all',
            label: '清空Tips',
            icon: 'trash',
            variant: 'destructive',
          },
        ],
        (itemId) => {
          if (itemId === 'clear-all') {
            void clearAllMyPrompts(onRefresh);
          } else if (itemId === 'copy-prompt') {
            void copyPromptText(item.content, '复制提示词');
          }
        },
        () => row.classList.remove('my-prompts-item-context-active')
      );
    });

    row.addEventListener('mouseenter', (event) => {
      previewTooltip.show(
        {
          title: item.title,
          content: item.content,
        },
        event,
        rowMain
      );
    });

    row.addEventListener('mouseleave', () => {
      previewTooltip.hide();
    });

    listContainer.appendChild(row);
  });

  container.appendChild(listContainer);
}
