/**
 * Manages marked ChatTOC prompts, including per-conversation persistence and
 * mark button UI state.
 */
const STORAGE_PREFIX = 'chatToc:marks:';

interface PromptMarkOptions {
  conversationKey: string;
  onMarkChanged?: () => void;
}

interface MarkButtonOptions {
  item: HTMLElement;
  messageId: string;
}

let conversationKey: string | null = null;
let markedPromptIds = new Set<string>();
let onMarkChanged: () => void = () => {};

/**
 * Loads marked prompts for the active conversation.
 * @param {Object} options
 * @param {string} options.conversationKey
 */
export function initializePromptMark(options: PromptMarkOptions): void {
  conversationKey = options.conversationKey;
  onMarkChanged = options.onMarkChanged ?? onMarkChanged;
  markedPromptIds = load();
}

/**
 * Returns whether a message is currently marked.
 * @param {string} messageId
 * @returns {boolean}
 */
export function isPromptMarked(messageId: string): boolean {
  return markedPromptIds.has(messageId);
}

/**
 * Creates the mark button for one navigator row and wires its click handler.
 * @param {Object} params
 * @param {HTMLElement} params.item Navigator row element.
 * @param {string} params.messageId ChatGPT message ID.
 * @returns {HTMLButtonElement}
 */
export function createPromptMarkButton({
  item,
  messageId,
}: MarkButtonOptions): HTMLButtonElement {
  const markButton = document.createElement('button');

  markButton.className = 'navigator-mark-btn';
  markButton.type = 'button';
  markButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    `;

  applyState(item, markButton, isPromptMarked(messageId));

  markButton.addEventListener('click', (event) => {
    event.stopPropagation();

    const nextMarked = toggle(messageId);

    applyState(item, markButton, nextMarked);
    onMarkChanged();
    markButton.blur();
  });

  return markButton;
}

/**
 * Toggles one prompt's mark state.
 * @param {string} messageId
 * @returns {boolean} true when the prompt is marked after toggling.
 */
function toggle(messageId: string): boolean {
  if (!messageId) return false;

  if (markedPromptIds.has(messageId)) {
    markedPromptIds.delete(messageId);
  } else {
    markedPromptIds.add(messageId);
  }

  save();
  return markedPromptIds.has(messageId);
}

/**
 * Applies mark state to a navigator row and its mark button.
 * @param {HTMLElement} item
 * @param {HTMLButtonElement} markButton
 * @param {boolean} isMarked
 */
function applyState(
  item: HTMLElement,
  markButton: HTMLButtonElement,
  isMarked: boolean
): void {
  item.classList.toggle('navigator-item-marked', isMarked);
  markButton.classList.toggle('navigator-mark-btn-active', isMarked);
  markButton.setAttribute('aria-pressed', String(isMarked));
  markButton.setAttribute(
    'aria-label',
    isMarked ? 'Unmark prompt' : 'Mark prompt'
  );
}

/**
 * Loads marked prompt IDs from sessionStorage.
 * @returns {Set<string>}
 */
function load(): Set<string> {
  try {
    const rawValue = sessionStorage.getItem(getStorageKey());
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];

    return new Set(
      Array.isArray(parsedValue)
        ? parsedValue.filter(
            (value): value is string => typeof value === 'string'
          )
        : []
    );
  } catch {
    return new Set();
  }
}

/**
 * Persists marked prompt IDs to sessionStorage.
 */
function save(): void {
  try {
    sessionStorage.setItem(
      getStorageKey(),
      JSON.stringify([...markedPromptIds])
    );
  } catch {}
}

/**
 * Returns the sessionStorage key for the active conversation.
 * @returns {string}
 */
function getStorageKey(): string {
  return `${STORAGE_PREFIX}${conversationKey}`;
}
