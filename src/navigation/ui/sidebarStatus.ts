/**
 * Manages the sidebar status banner state, transitions, count pluralization,
 * jumping text formatting, and linger timeouts.
 *
 * Visual rendering is owned by React (`SidebarStatus.tsx`), which subscribes
 * to this module's snapshot via `useSyncExternalStore`.
 */
import { APP_CONFIG } from '@/config/config';

/**
 * How long the completed-status text lingers before retracting. Shared by
 * the loading-complete and jump-complete transitions. Sourced from
 * `APP_CONFIG.ui.sidebar.statusLingerMs`.
 */
const STATUS_LINGER_MS = APP_CONFIG.ui.sidebar.statusLingerMs;

export type SidebarStatusState =
  | 'idle'
  | 'loading'
  | 'jumping'
  | 'complete'
  | 'empty'
  | 'failed';

export interface SidebarStatusSnapshot {
  readonly state: SidebarStatusState;
  readonly text: string;
}

let currentStatusMode: SidebarStatusState = 'idle';
let statusLingerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Last text rendered while in `jumping` mode. Reused as the lingering
 * text after a jump finishes so the user sees the final target instead of
 * an empty band.
 */
let lastJumpingText = '';

let statusSnapshot: SidebarStatusSnapshot = {
  state: 'idle',
  text: '',
};

const statusListeners = new Set<() => void>();

/**
 * Formats a prompt count with the correct singular/plural form for the
 * sidebar status band. Always produces "0 prompts" / "1 prompt" /
 * "N prompts".
 *
 * @param {number} count
 * @returns {string}
 */
function pluralizePrompts(count: number): string {
  return count === 1 ? '1 prompt' : `${count} prompts`;
}

/**
 * Returns the immutable current status snapshot for React subscribers.
 *
 * @returns {SidebarStatusSnapshot}
 */
export function getStatusSnapshot(): SidebarStatusSnapshot {
  return statusSnapshot;
}

/**
 * Subscribes a listener to status state updates.
 *
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe callback.
 */
export function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Notifies all active store subscribers of a snapshot change.
 */
function notifyStatusListeners(): void {
  statusListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error in sidebar status listener:', error);
    }
  });
}

/**
 * Updates the small status line state and dispatches external store updates.
 * Owns six mutually exclusive states:
 *
 *   - `jumping`: a jump is in progress; band shows the destination
 *     with the animated dots and lives until the jump ends.
 *   - `loading`: prompts are still arriving (initial page load or
 *     backfill). Shown immediately as "Loading…". Not gated on count —
 *     loading the *first* prompt of an empty chat also falls here, so
 *     the user never sees a "No prompts yet" → "Loading…" flicker.
 *   - `complete`: a load (or jump) just finished. Shows the count
 *     briefly, then retracts to `idle` after `STATUS_LINGER_MS`.
 *   - `empty`: definitively empty chat (loading done, zero prompts).
 *     Shows "No prompts" *persistently* — no linger timer, no retract,
 *     because the empty state is the stable visual until the user
 *     starts typing.
 *   - `failed`: jump target could not be resolved; lingers then retracts.
 *   - `idle`: nothing to convey. Hidden, no reserved space.
 *
 * Safe to call on every render — short-circuits when neither the mode nor
 * the rendered text changes.
 *
 * @param {Object} options
 * @param {SidebarStatusState} options.state The visible state to render.
 * @param {Object | null} [options.jump] Current jump progress, used for `jumping` text.
 * @param {number} [options.promptCount=0] Total prompts accumulated so far.
 */
export function setSidebarStatus(options: {
  state: SidebarStatusState;
  jump?: {
    active: boolean;
    targetIndex: number;
    currentProgressIndex?: number | null;
    remainingSteps?: number;
  } | null;
  promptCount?: number;
}): void {
  const { state, jump, promptCount = 0 } = options;

  let text: string;

  switch (state) {
    case 'jumping':
      if (jump) {
        const targetLabel = `To #${jump.targetIndex + 1}`;
        const progressSuffix =
          typeof jump.currentProgressIndex === 'number' &&
          jump.currentProgressIndex >= 0
            ? ` · Now #${jump.currentProgressIndex + 1}`
            : '';
        text = `${targetLabel}${progressSuffix}`;
      } else {
        text = 'Jumping';
      }
      lastJumpingText = text;
      break;
    case 'loading':
      text = promptCount > 0 ? `Loading... (${promptCount} so far)` : 'Loading…';
      break;
    case 'empty':
      text = 'No prompts';
      break;
    case 'failed':
      text = 'Jump failed';
      break;
    case 'complete':
      text =
        currentStatusMode === 'jumping'
          ? lastJumpingText
          : pluralizePrompts(promptCount);
      break;
    case 'idle':
    default:
      text = '';
  }

  if (state === statusSnapshot.state && text === statusSnapshot.text) {
    return;
  }

  currentStatusMode = state;
  statusSnapshot = { state, text };

  if (statusLingerTimer !== null) {
    clearTimeout(statusLingerTimer);
    statusLingerTimer = null;
  }

  if (state === 'complete' || state === 'failed') {
    statusLingerTimer = window.setTimeout(() => {
      currentStatusMode = 'idle';
      statusSnapshot = { state: 'idle', text: '' };
      statusLingerTimer = null;
      notifyStatusListeners();
    }, STATUS_LINGER_MS);
  }

  notifyStatusListeners();
}

/**
 * Resets status store state and clears any pending linger timers for testing.
 */
export function resetStatusForTesting(): void {
  if (statusLingerTimer !== null) {
    clearTimeout(statusLingerTimer);
    statusLingerTimer = null;
  }
  currentStatusMode = 'idle';
  lastJumpingText = '';
  statusSnapshot = { state: 'idle', text: '' };
}
