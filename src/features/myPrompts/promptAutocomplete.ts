/**
 * Manages My Prompts matching, autocomplete UI, keyboard navigation, and text
 * insertion in the ChatGPT composer.
 */
import type { SavedPrompt } from './promptStore';
import { promptAutocompleteViewController } from './promptAutocompleteView';

type SortMode = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
type PromptComposer = HTMLTextAreaElement | HTMLElement;

interface AutocompleteContext {
  query: string;
  triggerStart: number;
  triggerEnd: number;
  anchorRect: DOMRect | null;
  replaceRange: Range | null;
}

interface PromptAutocompleteDependencies {
  getMyPrompts: () => Promise<SavedPrompt[]>;
  sortMyPrompts: (prompts: SavedPrompt[], sortMode: SortMode) => SavedPrompt[];
  getActiveSort: () => SortMode;
}

let selectedMenuIndex = 0;
let filteredPromptsForMenu: SavedPrompt[] = [];
let currentTextarea: PromptComposer | null = null;
let currentAutocompleteContext: AutocompleteContext | null = null;
let isProgrammaticInsert = false;
let getMyPrompts: () => Promise<SavedPrompt[]> = async () => [];
let sortMyPrompts: (
  prompts: SavedPrompt[],
  sortMode: SortMode
) => SavedPrompt[] = (prompts) => prompts;
let getActiveSort: () => SortMode = () => 'updated_desc';
const autocompleteTriggerPattern =
  /(^|[\s.,!?;:()[\]{}<>"]|'|`|~|，|。|！|？|；|：|、|（|）|【|】|《|》])((?:\/\/)|#)([^\s]*)$/;

/**
 * Connects autocomplete to the prompt library.
 * @param {Object} dependencies
 * @param {() => Promise<Array>} dependencies.getMyPrompts
 * @param {(prompts: Array, sortMode: string) => Array}
 *     dependencies.sortMyPrompts
 * @param {() => string} dependencies.getActiveSort
 */
export function initializePromptAutocomplete(
  dependencies: PromptAutocompleteDependencies
): void {
  getMyPrompts = dependencies.getMyPrompts;
  sortMyPrompts = dependencies.sortMyPrompts;
  getActiveSort = dependencies.getActiveSort;
}

/**
 * Initializes the autocomplete overlay on ChatGPT's input textarea.
 */
export function initAutocomplete(): void {
  document.addEventListener('input', (event) => {
    if (isProgrammaticInsert) {
      closeAutocompleteMenu();
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.id === 'prompt-textarea') {
      currentTextarea = target;
      handleTextareaInput(target);
    }
  });

  document.addEventListener('keydown', handleTextareaKeydown, true);

  document.addEventListener('click', (event) => {
    if (
      promptAutocompleteViewController.getSnapshot() &&
      event.target instanceof Node &&
      !isAutocompleteMenuEvent(event) &&
      event.target !== currentTextarea
    ) {
      closeAutocompleteMenu();
    }
  });
}

/**
 * Inserts text into ChatGPT's main textarea or contenteditable composer.
 * @param {string} text
 */
export function insertIntoChatGPTInput(text: string): void {
  const textarea = document.querySelector<PromptComposer>('#prompt-textarea');
  if (!textarea) return;

  isProgrammaticInsert = true;
  try {
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
      let textToInsert = text;
      const currentValue = textarea.value || '';

      if (currentValue.trim() !== '') {
        textarea.selectionStart = textarea.selectionEnd = currentValue.length;
        textToInsert = currentValue.endsWith('\n') ? text : `\n${text}`;
      }

      try {
        document.execCommand('insertText', false, textToInsert);
      } catch (error) {
        textarea.value = currentValue + textToInsert;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }
    } else {
      textarea.focus();
      let textToInsert = text;
      const currentValue = textarea.innerText || '';

      if (currentValue.trim() !== '') {
        placeCursorAtEnd(textarea);
        textToInsert = currentValue.endsWith('\n') ? text : `\n${text}`;
      }

      try {
        document.execCommand('insertText', false, textToInsert);
      } catch (error) {
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
 * Places the cursor at the end of a contenteditable element.
 * @param {HTMLElement} element
 */
function placeCursorAtEnd(element: HTMLElement): void {
  element.focus();
  if (
    typeof window.getSelection === 'undefined' ||
    typeof document.createRange === 'undefined'
  ) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Parses the composer value and updates the autocomplete menu.
 * @param {HTMLElement} textarea
 */
async function handleTextareaInput(textarea: PromptComposer): Promise<void> {
  const context = getAutocompleteContext(textarea);
  const prompts = sortMyPrompts(await getMyPrompts(), getActiveSort());
  let matches: SavedPrompt[] = [];

  if (context) {
    matches = prompts.filter(
      (prompt) =>
        prompt.title.toLowerCase().startsWith(context.query) ||
        prompt.content.toLowerCase().startsWith(context.query)
    );
  }

  if (context && matches.length > 0) {
    showAutocompleteMenu(textarea, matches, context);
  } else {
    closeAutocompleteMenu();
  }
}

/**
 * Creates the autocomplete context at the current caret position.
 * @param {HTMLElement} textarea
 * @returns {Object|null}
 */
function getAutocompleteContext(
  textarea: PromptComposer
): AutocompleteContext | null {
  if (textarea instanceof HTMLTextAreaElement) {
    const cursorOffset = textarea.selectionStart ?? textarea.value.length;
    const textBeforeCursor = textarea.value.slice(0, cursorOffset);
    const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);

    if (!triggerMatch) return null;

    return {
      query: triggerMatch[3].toLowerCase(),
      triggerStart: (triggerMatch.index ?? 0) + triggerMatch[1].length,
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

    const triggerStart = (triggerMatch.index ?? 0) + triggerMatch[1].length;
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
  } catch (error) {
    return null;
  }
}

/**
 * Resolves a DOM text range from flat offsets inside a contenteditable root.
 * @param {HTMLElement} root
 * @param {number} startOffset
 * @param {number} endOffset
 * @returns {Range|null}
 */
function createTextRangeFromOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const replaceRange = document.createRange();
  let currentOffset = 0;
  let hasStart = false;
  let node = walker.nextNode();

  while (node) {
    const textLength = node.textContent?.length ?? 0;
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
 * Falls back to the current text node when flat offsets cannot be mapped.
 * @param {Range} range
 * @returns {Range|null}
 */
function createCurrentTextNodeTriggerRange(range: Range): Range | null {
  if (range.endContainer.nodeType !== Node.TEXT_NODE) return null;

  const textBeforeCursor = (range.endContainer.textContent ?? '').slice(
    0,
    range.endOffset
  );
  const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);
  if (!triggerMatch) return null;

  const replaceRange = document.createRange();
  replaceRange.setStart(
    range.endContainer,
    (triggerMatch.index ?? 0) + triggerMatch[1].length
  );
  replaceRange.setEnd(range.endContainer, range.endOffset);
  return replaceRange;
}

/**
 * Finds a visible rectangle near the caret for positioning the menu.
 * @param {HTMLElement} textarea
 * @param {Range} range
 * @returns {DOMRect|null}
 */
function getRangeAnchorRect(
  textarea: HTMLElement,
  range: Range
): DOMRect | null {
  const caretRange = range.cloneRange();
  caretRange.collapse(false);

  const caretRect = getVisibleRangeRect(caretRange);
  if (caretRect) return caretRect;

  if (range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset > 0) {
    const characterRange = document.createRange();
    characterRange.setStart(range.endContainer, range.endOffset - 1);
    characterRange.setEnd(range.endContainer, range.endOffset);
    return getVisibleRangeRect(characterRange);
  }

  return null;
}

/**
 * Returns a visible rectangle for a DOM range.
 * @param {Range} range
 * @returns {DOMRect|null}
 */
function getVisibleRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width || rect.height)) return rect;

  const rects = range.getClientRects();
  return rects.length ? rects[rects.length - 1] : null;
}

/**
 * Displays the autocomplete menu near the current caret.
 * @param {HTMLElement} textarea
 * @param {Array} matches
 * @param {Object} context
 */
function showAutocompleteMenu(
  textarea: PromptComposer,
  matches: SavedPrompt[],
  context: AutocompleteContext
): void {
  filteredPromptsForMenu = matches;
  currentAutocompleteContext = context;
  selectedMenuIndex = Math.min(selectedMenuIndex, matches.length - 1);

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

  promptAutocompleteViewController.show(
    matches,
    selectedMenuIndex,
    {
      left,
      width: menuWidth,
      anchorTop: anchorRect.top,
      anchorBottom: anchorRect.bottom,
      viewportHeight: window.innerHeight,
    },
    selectAutocompleteItem
  );
}

/**
 * Replaces the autocomplete trigger with the selected prompt content.
 * @param {Object} prompt
 */
function selectAutocompleteItem(prompt: SavedPrompt): void {
  if (!currentTextarea || !currentAutocompleteContext) {
    return;
  }

  const textarea = currentTextarea;
  const context = currentAutocompleteContext;

  isProgrammaticInsert = true;
  try {
    if (textarea instanceof HTMLTextAreaElement) {
      const text = textarea.value;
      textarea.focus();
      textarea.value =
        text.slice(0, context.triggerStart) +
        prompt.content +
        text.slice(context.triggerEnd);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      const newCursorPosition = context.triggerStart + prompt.content.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    } else {
      textarea.focus();
      const selection = window.getSelection();
      if (selection && context.replaceRange) {
        selection.removeAllRanges();
        selection.addRange(context.replaceRange);
        document.execCommand('insertText', false, prompt.content);
      }
    }
  } finally {
    closeAutocompleteMenu();
    isProgrammaticInsert = false;
  }
}

/**
 * Handles keyboard navigation and selection in the autocomplete menu.
 * @param {KeyboardEvent} event
 */
function handleTextareaKeydown(event: KeyboardEvent): void {
  if (!promptAutocompleteViewController.getSnapshot()) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    selectedMenuIndex = (selectedMenuIndex + 1) % filteredPromptsForMenu.length;
    promptAutocompleteViewController.setSelectedIndex(selectedMenuIndex);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    selectedMenuIndex =
      (selectedMenuIndex - 1 + filteredPromptsForMenu.length) %
      filteredPromptsForMenu.length;
    promptAutocompleteViewController.setSelectedIndex(selectedMenuIndex);
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();
    const selectedPrompt = filteredPromptsForMenu[selectedMenuIndex];
    if (selectedPrompt) selectAutocompleteItem(selectedPrompt);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeAutocompleteMenu();
  }
}

/**
 * Closes and resets the autocomplete menu.
 */
function closeAutocompleteMenu(): void {
  promptAutocompleteViewController.close();
  filteredPromptsForMenu = [];
  currentAutocompleteContext = null;
  selectedMenuIndex = 0;
}

/**
 * Detects menu clicks through the open Shadow DOM event path.
 */
function isAutocompleteMenuEvent(event: MouseEvent): boolean {
  return event.composedPath().some(
    (target) =>
      target instanceof HTMLElement &&
      target.dataset.lunaTocAutocomplete === 'true'
  );
}
