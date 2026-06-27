/**
 * Manages ChatTOC My Prompts, including local storage persistence,
 * CRUD modal dialogs, Prompts list rendering, and input autocompletion.
 */
(function () {
  let activeSort = 'updated_desc';
  let autocompleteMenu = null;
  let selectedMenuIndex = 0;
  let filteredPromptsForMenu = [];
  let currentTextarea = null;
  let currentAutocompleteContext = null;
  let isProgrammaticInsert = false;
  let renderVersion = 0;
  const autocompleteTriggerPattern =
    /(^|[\s.,!?;:()[\]{}<>"]|'|`|~|，|。|！|？|；|：|、|（|）|【|】|《|》])((?:\/\/)|#)([^\s]*)$/;
  const promptsStore = window.ChatTocPromptStore.create();

  /**
   * Retrieves prompts from the prompt store.
   * @returns {Promise<Array>}
   */
  async function getMyPrompts() {
    return promptsStore.getAll();
  }

  /**
   * Persists prompts through the prompt store.
   * @param {Array} prompts
   * @returns {Promise<void>}
   */
  async function saveMyPrompts(prompts) {
    return promptsStore.saveAll(prompts);
  }

  /**
   * Registers a listener for prompt store changes.
   * @param {(prompts: Array) => void} listener
   * @returns {() => void}
   */
  function onPromptsChanged(listener) {
    return promptsStore.subscribe(listener);
  }

  /**
   * Returns a Markdown fence that does not occur in the prompt content.
   * @param {string} content
   * @returns {string}
   */
  function getMarkdownFence(content) {
    const backtickRuns = content.match(/`+/g) || [];
    const longestRun = backtickRuns.reduce(
      (length, run) => Math.max(length, run.length),
      0
    );
    return '`'.repeat(Math.max(3, longestRun + 1));
  }

  /**
   * Formats prompts as editable Markdown sections.
   * @param {Array} prompts
   * @returns {string}
   */
  function formatPromptsAsMarkdown(prompts) {
    return prompts
      .map(({ title, content }) => {
        const fence = getMarkdownFence(content);
        const closingNewline = content.endsWith('\n') ? '' : '\n';
        return `# ${title}\n\n${fence}prompt\n${content}${closingNewline}${fence}`;
      })
      .join('\n\n');
  }

  /**
   * Downloads saved prompts as an editable Markdown file.
   * @returns {Promise<void>}
   */
  async function exportMyPrompts() {
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
   * Parses prompt sections from the Markdown format created by the exporter.
   * @param {string} markdown
   * @returns {Array<{title: string, content: string}>}
   */
  function parseMarkdownPrompts(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const prompts = [];

    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith('# ')) continue;

      const title = lines[index].slice(2).trim();
      index += 1;
      while (lines[index] === '') index += 1;

      const openingFence = lines[index]?.match(/^(`{3,})prompt\s*$/);
      if (!title || !openingFence) continue;

      const fence = openingFence[1];
      const contentLines = [];
      index += 1;

      while (index < lines.length && lines[index] !== fence) {
        contentLines.push(lines[index]);
        index += 1;
      }

      if (index === lines.length) break;

      const content = contentLines.join('\n');
      if (content.trim()) {
        prompts.push({ title, content });
      }
    }

    return prompts;
  }

  /**
   * Opens a Markdown file and appends its prompts to the current collection.
   * @param {() => void} onImport
   * @returns {void}
   */
  function importMyPrompts(onImport) {
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
        onImport();
        await showPromptModal({
          title: 'Import Prompts',
          message: `Imported ${importedPrompts.length} prompt${importedPrompts.length === 1 ? '' : 's'}.`,
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
   * Sorts the prompts list based on the chosen mode.
   * @param {Array} list
   * @param {string} sortMode
   * @returns {Array}
   */
  function sortMyPrompts(list, sortMode) {
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

  /**
   * Escapes text inserted into HTML templates.
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, (char) => {
      const entities = {
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
    confirmText = 'OK',
    cancelText = 'Cancel',
  }) {
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
                ? `<button type="button" id="myprompt-message-cancel" class="myprompt-btn myprompt-btn-secondary">${escapeHtml(cancelText)}</button>`
                : ''
            }
            <button type="button" id="myprompt-message-confirm" class="myprompt-btn myprompt-btn-primary">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      modal.style.display = 'flex';

      const handleBackdropClick = (event) => {
        if (event.target === modal) {
          close(false);
        }
      };

      const close = (result) => {
        modal.removeEventListener('click', handleBackdropClick);
        modal.style.display = 'none';
        resolve(result);
      };

      modal
        .querySelector('#myprompt-message-confirm')
        .addEventListener('click', () => close(true), { once: true });

      modal
        .querySelector('#myprompt-message-cancel')
        ?.addEventListener('click', () => close(false), { once: true });

      modal.addEventListener('click', handleBackdropClick);

      modal.querySelector('#myprompt-message-confirm').focus();
    });
  }

  /**
   * Creates the sorting toolbar.
   * @param {() => void} onSortChange Callback triggered when the sorting mode changes.
   * @param {() => void} onAddNew Callback triggered when the add button is clicked.
   * @returns {HTMLElement}
   */
  function createSortBar(onSortChange, onAddNew) {
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
          <option value="updated_desc">Newest Modified</option>
          <option value="updated_asc">Oldest Modified</option>
          <option value="name_asc">Title (A-Z)</option>
          <option value="name_desc">Title (Z-A)</option>
        </select>
      </div>
      <div class="my-prompts-toolbar-actions">
        <button id="myprompt-import-btn" class="myprompt-canvas-btn" type="button" aria-label="Import prompts" title="Import prompts">
          <canvas width="14" height="14" aria-hidden="true"></canvas>
        </button>
        <button id="myprompt-export-btn" class="myprompt-canvas-btn" type="button" aria-label="Export prompts" title="Export prompts">
          <canvas width="14" height="14" aria-hidden="true"></canvas>
        </button>
        <button id="myprompt-add-new-btn" type="button" aria-label="Add prompt" title="Add prompt">+</button>
      </div>
    `;

    const select = bar.querySelector('#myprompt-sort-select');
    select.value = activeSort;
    select.addEventListener('change', (e) => {
      activeSort = e.target.value;
      onSortChange();
    });

    const addBtn = bar.querySelector('#myprompt-add-new-btn');
    addBtn.addEventListener('click', () => {
      onAddNew();
    });

    bar
      .querySelector('#myprompt-export-btn')
      .addEventListener('click', exportMyPrompts);

    bar.querySelector('#myprompt-import-btn').addEventListener('click', () => {
      importMyPrompts(onSortChange);
    });

    drawToolbarIcon(bar.querySelector('#myprompt-import-btn canvas'), 'import');
    drawToolbarIcon(bar.querySelector('#myprompt-export-btn canvas'), 'export');

    return bar;
  }

  /**
   * Draws an import or export arrow icon on a toolbar canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {'import'|'export'} direction
   */
  function drawToolbarIcon(canvas, direction) {
    const context = canvas.getContext('2d');
    if (!context) return;

    context.strokeStyle = '#2563eb';
    context.lineWidth = 1.7;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const arrowPoints = direction === 'import'
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
  function showDialog(item = null, onSave = () => {}) {
    let modal = document.getElementById('chat-toc-myprompt-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'chat-toc-myprompt-modal';
      modal.className = 'myprompt-modal-overlay';
      document.body.appendChild(modal);
    }

    const isNew = !item || !item.id;
    const titleText = isNew ? item?.title || '' : item.title;
    const contentText = item ? item.content : '';

    modal.innerHTML = `
      <div class="myprompt-modal-content">
        <h3 class="myprompt-modal-title">${isNew ? 'Create Custom Prompt' : 'Edit Custom Prompt'}</h3>
        <form id="myprompt-modal-form">
          <div class="myprompt-modal-field">
            <label for="myprompt-form-title">Title</label>
            <input type="text" id="myprompt-form-title" placeholder="e.g. Code Review Helper" value="${escapeHtml(titleText)}" required />
          </div>
          <div class="myprompt-modal-field">
            <label for="myprompt-form-content">Prompt Content</label>
            <textarea id="myprompt-form-content" placeholder="Type or paste your prompt content here..." required>${escapeHtml(contentText)}</textarea>
          </div>
          <div class="myprompt-modal-actions">
            <button type="button" id="myprompt-form-cancel" class="myprompt-btn myprompt-btn-secondary">Cancel</button>
            <button type="submit" id="myprompt-form-submit" class="myprompt-btn myprompt-btn-primary">Save</button>
          </div>
        </form>
      </div>
    `;

    modal.style.display = 'flex';
    const form = modal.querySelector('#myprompt-modal-form');
    const cancelBtn = modal.querySelector('#myprompt-form-cancel');

    // Focus the title input field
    modal.querySelector('#myprompt-form-title').focus();

    const closeModal = () => {
      modal.style.display = 'none';
    };

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = modal.querySelector('#myprompt-form-title').value.trim();
      const content = modal
        .querySelector('#myprompt-form-content')
        .value.trim();

      if (!title || !content) return;

      try {
        const prompts = await getMyPrompts();
        if (isNew) {
          const now = Date.now();
          const newPrompt = {
            id: 'prompt-' + now,
            title,
            content,
            createdAt: now,
            updatedAt: now,
          };
          prompts.push(newPrompt);
        } else {
          const index = prompts.findIndex((p) => p.id === item.id);
          if (index !== -1) {
            prompts[index].title = title;
            prompts[index].content = content;
            prompts[index].updatedAt = Date.now();
          }
        }

        await saveMyPrompts(prompts);
        closeModal();
        onSave();
      } catch (error) {
        await showPromptModal({
          title: 'Save Prompt',
          message: 'Unable to save this prompt.',
        });
      }
    });
  }

  /**
   * Helper to insert text into ChatGPT's main input textarea or contenteditable div.
   * @param {string} text
   */
  function insertIntoChatGPTInput(text) {
    const textarea = document.querySelector('#prompt-textarea');
    if (!textarea) return;

    isProgrammaticInsert = true;
    try {
      if (textarea.tagName === 'TEXTAREA') {
        textarea.focus();
        let textToInsert = text;
        const currentVal = textarea.value || '';

        if (currentVal.trim() !== '') {
          // Move cursor to the end of the text
          textarea.selectionStart = textarea.selectionEnd = currentVal.length;
          if (currentVal.endsWith('\n')) {
            textToInsert = text;
          } else {
            textToInsert = '\n' + text;
          }
        }

        // Use document.execCommand to trigger React input state updates
        try {
          document.execCommand('insertText', false, textToInsert);
        } catch (e) {
          // Fallback
          textarea.value = currentVal + textToInsert;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.selectionStart = textarea.selectionEnd =
            textarea.value.length;
        }
      } else {
        // For contenteditable div (ChatGPT's ProseMirror editor)
        textarea.focus();
        let textToInsert = text;
        const currentVal = textarea.innerText || '';

        if (currentVal.trim() !== '') {
          placeCursorAtEnd(textarea);
          if (currentVal.endsWith('\n')) {
            textToInsert = text;
          } else {
            textToInsert = '\n' + text;
          }
        }

        // Use document.execCommand to trigger React input state updates
        try {
          document.execCommand('insertText', false, textToInsert);
        } catch (e) {
          // Fallback
          const textNode = document.createTextNode(textToInsert);
          textarea.appendChild(textNode);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          placeCursorAtEnd(textarea);
        }
      }
    } finally {
      isProgrammaticInsert = false;
    }
  }

  /**
   * Helper to place the cursor at the end of a contenteditable element.
   * @param {HTMLElement} el
   */
  function placeCursorAtEnd(el) {
    el.focus();
    if (
      typeof window.getSelection !== 'undefined' &&
      typeof document.createRange !== 'undefined'
    ) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /**
   * Renders the entire prompts view inside a container.
   * @param {HTMLElement} container
   * @param {string} searchQuery
   * @param {() => void} onRefresh
   */
  async function renderMyPrompts(
    container,
    searchQuery = '',
    onRefresh = () => {}
  ) {
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

    if (currentRenderVersion !== renderVersion) {
      return;
    }

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
        ? 'No matching prompts.'
        : 'No prompts saved yet. Click + to add one, or right-click any prompt in the TOC list.';
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
        window.ChatTocPreviewTooltip.hide();
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
        window.ChatTocPreviewTooltip.hide();
        const shouldDelete = await showPromptModal({
          title: 'Delete Prompt',
          message: `Are you sure you want to delete "${item.title}"?`,
          confirm: true,
          confirmText: 'Delete',
        });

        if (shouldDelete) {
          try {
            const prompts = await getMyPrompts();
            const filtered = prompts.filter((p) => p.id !== item.id);
            await saveMyPrompts(filtered);
            onRefresh();
          } catch (error) {
            await showPromptModal({
              title: 'Delete Prompt',
              message: 'Unable to delete this prompt.',
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
        window.ChatTocPreviewTooltip.hide();
        insertIntoChatGPTInput(item.content);
      });

      row.addEventListener('mouseenter', (event) => {
        window.ChatTocPreviewTooltip.show(
          {
            title: item.title,
            content: item.content,
          },
          event,
          rowMain
        );
      });

      row.addEventListener('mouseleave', () => {
        window.ChatTocPreviewTooltip.hide();
      });

      listContainer.appendChild(row);
    });

    container.appendChild(listContainer);
  }

  /**
   * Initializes the autocomplete overlay on ChatGPT's input textarea.
   */
  function initAutocomplete() {
    document.addEventListener('input', (e) => {
      if (isProgrammaticInsert) {
        closeAutocompleteMenu();
        return;
      }
      const target = e.target;
      if (target && target.id === 'prompt-textarea') {
        currentTextarea = target;
        handleTextareaInput(target);
      }
    });

    document.addEventListener('keydown', handleTextareaKeydown, true);

    document.addEventListener('click', (e) => {
      if (
        autocompleteMenu &&
        !autocompleteMenu.contains(e.target) &&
        e.target !== currentTextarea
      ) {
        closeAutocompleteMenu();
      }
    });
  }

  /**
   * Parses the textarea/contenteditable value and triggers the autocomplete menu if necessary.
   * @param {HTMLElement} textarea
   */
  async function handleTextareaInput(textarea) {
    const context = getAutocompleteContext(textarea);

    const prompts = sortMyPrompts(await getMyPrompts(), activeSort);
    let matches = [];

    if (context) {
      matches = prompts.filter(
        (p) =>
          p.title.toLowerCase().startsWith(context.query) ||
          p.content.toLowerCase().startsWith(context.query)
      );
    }

    if (matches.length > 0) {
      showAutocompleteMenu(textarea, matches, context);
    } else {
      closeAutocompleteMenu();
    }
  }

  /**
   * Creates a complete autocomplete context from the current caret position.
   * @param {HTMLElement} textarea
   * @returns {Object | null}
   */
  function getAutocompleteContext(textarea) {
    if (textarea.tagName === 'TEXTAREA') {
      const cursorOffset = textarea.selectionStart;
      const textBeforeCursor = textarea.value.slice(0, cursorOffset);
      const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);

      if (!triggerMatch) return null;

      return {
        query: triggerMatch[3].toLowerCase(),
        triggerStart: triggerMatch.index + triggerMatch[1].length,
        triggerEnd: cursorOffset,
        anchorRect: null,
        replaceRange: null,
      };
    }

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    if (!textarea.contains(range.endContainer)) return null;

    try {
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(textarea);
      preCaretRange.setEnd(range.endContainer, range.endOffset);

      const textBeforeCursor = preCaretRange.toString();
      const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);

      if (!triggerMatch) return null;

      const triggerStart = triggerMatch.index + triggerMatch[1].length;
      const triggerEnd = textBeforeCursor.length;

      return {
        query: triggerMatch[3].toLowerCase(),
        triggerStart,
        triggerEnd,
        anchorRect: getRangeAnchorRect(textarea, range),
        replaceRange:
          createTextRangeFromOffsets(textarea, triggerStart, triggerEnd) ||
          createCurrentTextNodeTriggerRange(range),
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Resolves a DOM text range from flat text offsets inside a contenteditable root.
   * @param {HTMLElement} root
   * @param {number} startOffset
   * @param {number} endOffset
   * @returns {Range | null}
   */
  function createTextRangeFromOffsets(root, startOffset, endOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const replaceRange = document.createRange();
    let currentOffset = 0;
    let hasStart = false;
    let node = walker.nextNode();

    while (node) {
      const textLength = node.textContent.length;
      const nextOffset = currentOffset + textLength;

      if (!hasStart && startOffset <= nextOffset) {
        replaceRange.setStart(node, Math.max(0, startOffset - currentOffset));
        hasStart = true;
      }

      if (hasStart && endOffset <= nextOffset) {
        replaceRange.setEnd(node, Math.max(0, endOffset - currentOffset));
        return replaceRange;
      }

      currentOffset = nextOffset;
      node = walker.nextNode();
    }

    return null;
  }

  /**
   * Falls back to the current text node when editor-generated line breaks make
   * flat text offsets impossible to map back to DOM nodes.
   * @param {Range} range
   * @returns {Range | null}
   */
  function createCurrentTextNodeTriggerRange(range) {
    if (range.endContainer.nodeType !== Node.TEXT_NODE) return null;

    const textBeforeCursor = range.endContainer.textContent.slice(
      0,
      range.endOffset
    );
    const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);

    if (!triggerMatch) return null;

    const replaceRange = document.createRange();
    replaceRange.setStart(
      range.endContainer,
      triggerMatch.index + triggerMatch[1].length
    );
    replaceRange.setEnd(range.endContainer, range.endOffset);

    return replaceRange;
  }

  /**
   * Finds a visible rectangle near the caret for positioning the menu.
   * @param {HTMLElement} textarea
   * @param {Range} range
   * @returns {DOMRect | null}
   */
  function getRangeAnchorRect(textarea, range) {
    const caretRange = range.cloneRange();
    caretRange.collapse(false);

    const caretRect = getVisibleRangeRect(caretRange);
    if (caretRect) return caretRect;

    if (
      range.endContainer.nodeType === Node.TEXT_NODE &&
      range.endOffset > 0
    ) {
      const characterRange = document.createRange();
      characterRange.setStart(range.endContainer, range.endOffset - 1);
      characterRange.setEnd(range.endContainer, range.endOffset);

      return getVisibleRangeRect(characterRange);
    }

    return null;
  }

  /**
   * Returns the first visible rectangle for a DOM range.
   * @param {Range} range
   * @returns {DOMRect | null}
   */
  function getVisibleRangeRect(range) {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;

    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1] : null;
  }

  /**
   * Displays the autocomplete floating overlay.
   * @param {HTMLElement} textarea
   * @param {Array} matches
   * @param {Object} context
   */
  function showAutocompleteMenu(textarea, matches, context) {
    filteredPromptsForMenu = matches;
    currentAutocompleteContext = context;
    selectedMenuIndex = Math.min(selectedMenuIndex, matches.length - 1);

    if (!autocompleteMenu) {
      autocompleteMenu = document.createElement('div');
      autocompleteMenu.id = 'chat-toc-autocomplete-menu';
      document.documentElement.appendChild(autocompleteMenu);
    }

    renderAutocompleteMenuContent();

    const inputRect = textarea.getBoundingClientRect();
    const anchorRect = context.anchorRect || inputRect;
    const menuGap = 8;
    const maxMenuWidth = 420;
    const menuWidth = Math.min(
      inputRect.width,
      maxMenuWidth,
      window.innerWidth - menuGap * 2
    );
    const anchorLeft = context.anchorRect ? anchorRect.left : inputRect.left;
    const left = Math.max(
      menuGap,
      Math.min(anchorLeft, window.innerWidth - menuWidth - menuGap)
    );

    autocompleteMenu.style.display = 'block';
    autocompleteMenu.style.visibility = 'hidden';
    autocompleteMenu.style.position = 'fixed';
    autocompleteMenu.style.width = `${menuWidth}px`;

    const menuHeight = autocompleteMenu.offsetHeight;
    const preferredTop = anchorRect.top - menuHeight - menuGap;
    const fallbackTop = anchorRect.bottom + menuGap;
    const top =
      preferredTop >= menuGap
        ? preferredTop
        : Math.min(fallbackTop, window.innerHeight - menuHeight - menuGap);

    autocompleteMenu.style.left = `${left}px`;
    autocompleteMenu.style.top = `${Math.max(menuGap, top)}px`;
    autocompleteMenu.style.bottom = '';
    autocompleteMenu.style.visibility = 'visible';
  }

  /**
   * Renders the autocomplete suggestions items.
   */
  function renderAutocompleteMenuContent() {
    if (!autocompleteMenu) return;

    autocompleteMenu.innerHTML = '';
    filteredPromptsForMenu.forEach((p, index) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-menu-item';
      if (index === selectedMenuIndex) {
        item.classList.add('autocomplete-menu-item-active');
      }

      item.innerHTML = `
        <div class="autocomplete-item-title">${escapeHtml(p.title)}</div>
        <div class="autocomplete-item-preview">${escapeHtml(
          p.content.slice(0, 80)
        )}${p.content.length > 80 ? '...' : ''}</div>
      `;

      item.addEventListener('click', () => {
        selectAutocompleteItem(p);
      });

      autocompleteMenu.appendChild(item);
    });
  }

  /**
   * Inserts the selected prompt content into the input element, replacing the trigger text.
   * Handles both TEXTAREA and contenteditable containers cleanly.
   * @param {Object} p
   */
  function selectAutocompleteItem(p) {
    if (!currentTextarea || !autocompleteMenu || !currentAutocompleteContext) {
      return;
    }

    const textarea = currentTextarea;
    const context = currentAutocompleteContext;

    isProgrammaticInsert = true;
    try {
      if (textarea.tagName === 'TEXTAREA') {
        const text = textarea.value;
        textarea.focus();
        textarea.value =
          text.slice(0, context.triggerStart) +
          p.content +
          text.slice(context.triggerEnd);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const newCursorPos = context.triggerStart + p.content.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      } else {
        // For contenteditable div (ChatGPT's ProseMirror editor)
        textarea.focus();
        const selection = window.getSelection();
        if (selection && context.replaceRange) {
          selection.removeAllRanges();
          selection.addRange(context.replaceRange);
          document.execCommand('insertText', false, p.content);
        }
      }
    } finally {
      closeAutocompleteMenu();
      isProgrammaticInsert = false;
    }
  }

  /**
   * Keydown handler for ArrowUp/Down, Enter, Tab, and Escape on the autocomplete dropdown.
   * @param {KeyboardEvent} e
   */
  function handleTextareaKeydown(e) {
    if (!autocompleteMenu || autocompleteMenu.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      selectedMenuIndex =
        (selectedMenuIndex + 1) % filteredPromptsForMenu.length;
      renderAutocompleteMenuContent();
      scrollActiveAutocompleteItemIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      selectedMenuIndex =
        (selectedMenuIndex - 1 + filteredPromptsForMenu.length) %
        filteredPromptsForMenu.length;
      renderAutocompleteMenuContent();
      scrollActiveAutocompleteItemIntoView();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const selectedPrompt = filteredPromptsForMenu[selectedMenuIndex];
      if (selectedPrompt) {
        selectAutocompleteItem(selectedPrompt);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAutocompleteMenu();
    }
  }

  /**
   * Scroll active menu item into view when navigating via keyboard keys.
   */
  function scrollActiveAutocompleteItemIntoView() {
    const activeItem = autocompleteMenu.querySelector(
      '.autocomplete-menu-item-active'
    );
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Closes the autocomplete suggestions popup.
   */
  function closeAutocompleteMenu() {
    if (autocompleteMenu) {
      autocompleteMenu.style.display = 'none';
      filteredPromptsForMenu = [];
      currentAutocompleteContext = null;
      selectedMenuIndex = 0;
      delete autocompleteMenu.dataset.triggerStart;
    }
  }

  // Export module API to window scope
  window.ChatTocMyPrompts = {
    getMyPrompts,
    saveMyPrompts,
    onPromptsChanged,
    showDialog,
    renderMyPrompts,
    initAutocomplete,
    insertIntoChatGPTInput,
  };
})();
