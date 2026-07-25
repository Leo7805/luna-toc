/**
 * Manages My Prompts matching, autocomplete UI, keyboard navigation, and text
 * insertion in the ChatGPT composer.
 */
import type { SavedPrompt } from './promptStore';
import { promptAutocompleteViewController } from './promptAutocompleteView';
import type { PromptUsageMap } from './promptUsageStore';

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
  getPromptUsage: () => Promise<PromptUsageMap>;
  recordPromptUse: (promptId: string) => Promise<void>;
}

let selectedMenuIndex = 0;
let filteredPromptsForMenu: SavedPrompt[] = [];
let currentTextarea: PromptComposer | null = null;
let currentAutocompleteContext: AutocompleteContext | null = null;
let isProgrammaticInsert = false;
let getMyPrompts: () => Promise<SavedPrompt[]> = async () => [];
let getPromptUsage: () => Promise<PromptUsageMap> = async () => ({});
let recordPromptUse: (promptId: string) => Promise<void> = async () => {};
let autocompleteRequestVersion = 0;
const autocompleteTriggerPattern =
  /(^|[\s.,!?;:()[\]{}<>"]|'|`|~|，|。|！|？|；|：|、|（|）|【|】|《|》])((?:\/\/)|#)([^\s]*)$/;

/**
 * Connects autocomplete to the prompt library.
 * @param {Object} dependencies
 * @param {() => Promise<Array>} dependencies.getMyPrompts
 * @param {() => Promise<Object>} dependencies.getPromptUsage
 * @param {(promptId: string) => Promise<void>} dependencies.recordPromptUse
 */
export function initializePromptAutocomplete(
  dependencies: PromptAutocompleteDependencies
): void {
  getMyPrompts = dependencies.getMyPrompts;
  getPromptUsage = dependencies.getPromptUsage;
  recordPromptUse = dependencies.recordPromptUse;
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
  const requestVersion = ++autocompleteRequestVersion;
  const context = getAutocompleteContext(textarea);
  if (!context) {
    closeAutocompleteMenu();
    return;
  }

  const [prompts, usage] = await Promise.all([
    getMyPrompts(),
    getPromptUsage(),
  ]);
  if (requestVersion !== autocompleteRequestVersion) return;

  const matches = getRankedAutocompletePrompts(prompts, usage, context.query);
  if (matches.length > 0) {
    showAutocompleteMenu(textarea, matches, context);
  } else {
    closeAutocompleteMenu();
  }
}

/**
 * Filters by title and ranks equal matches by usage and title.
 */
function getRankedAutocompletePrompts(
  prompts: SavedPrompt[],
  usage: PromptUsageMap,
  query: string
): SavedPrompt[] {
  const normalizedQuery = query.toLocaleLowerCase();

  return prompts
    .map((prompt) => ({
      prompt,
      matchRank: getTitleMatchRank(prompt.title, normalizedQuery),
    }))
    .filter(
      (candidate): candidate is { prompt: SavedPrompt; matchRank: number } =>
        candidate.matchRank !== null
    )
    .sort((left, right) => {
      if (left.matchRank !== right.matchRank) {
        return left.matchRank - right.matchRank;
      }

      const leftUsage = usage[left.prompt.id];
      const rightUsage = usage[right.prompt.id];
      const countDifference =
        (rightUsage?.usageCount ?? 0) - (leftUsage?.usageCount ?? 0);
      if (countDifference !== 0) return countDifference;

      const recencyDifference =
        (rightUsage?.lastUsedAt ?? 0) - (leftUsage?.lastUsedAt ?? 0);
      if (recencyDifference !== 0) return recencyDifference;

      return left.prompt.title.localeCompare(right.prompt.title, undefined, {
        sensitivity: 'base',
      });
    })
    .map(({ prompt }) => prompt);
}

/**
 * Ranks exact, word-prefix, and substring title matches in that order.
 */
function getTitleMatchRank(title: string, query: string): number | null {
  if (!query) return 0;

  const normalizedTitle = title.toLocaleLowerCase();
  if (normalizedTitle === query) return 0;

  const words = normalizedTitle.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some((word) => word.startsWith(query))) return 1;
  return normalizedTitle.includes(query) ? 2 : null;
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
    const currentLineContext = getCurrentLineAutocompleteContext(
      textarea,
      range
    );
    if (currentLineContext) {
      return {
        ...currentLineContext,
        anchorRect: getRangeAnchorRect(textarea, range),
      };
    }

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
 * Resolves an autocomplete trigger from the caret's current DOM line.
 * ChatGPT represents Enter-created lines as separate paragraph elements rather
 * than newline characters, and the caret may be anchored to either the
 * paragraph or one of its text nodes.
 */
function getCurrentLineAutocompleteContext(
  root: HTMLElement,
  range: Range
): Omit<AutocompleteContext, 'anchorRect'> | null {
  let lineNode: Node = range.endContainer;
  if (lineNode === root) {
    lineNode = root.childNodes.item(range.endOffset - 1);
    if (!lineNode) return null;
  }

  while (lineNode.parentNode && lineNode.parentNode !== root) {
    lineNode = lineNode.parentNode;
  }
  if (lineNode === root || lineNode.parentNode !== root) return null;

  const lineRange = range.cloneRange();
  lineRange.selectNodeContents(lineNode);
  lineRange.setEnd(range.endContainer, range.endOffset);

  const textBeforeCursor = lineRange.toString();
  const triggerMatch = textBeforeCursor.match(autocompleteTriggerPattern);
  if (!triggerMatch) return null;

  const triggerStart = (triggerMatch.index ?? 0) + triggerMatch[1].length;
  const triggerEnd = textBeforeCursor.length;
  const lineElement =
    lineNode instanceof HTMLElement ? lineNode : lineNode.parentElement;
  if (!lineElement) return null;

  const replaceRange = createTextRangeFromOffsets(
    lineElement,
    triggerStart,
    triggerEnd
  );
  if (!replaceRange) return null;

  return {
    query: triggerMatch[3].toLowerCase(),
    triggerStart,
    triggerEnd,
    replaceRange,
  };
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
    selectAutocompleteItem,
    (nextIndex) => {
      selectedMenuIndex = nextIndex;
    }
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
    void recordPromptUse(prompt.id).catch(() => undefined);
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
  autocompleteRequestVersion += 1;
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
