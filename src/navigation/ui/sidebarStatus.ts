/**
 * Manages the sidebar status banner between the sidebar header and prompt list.
 * Controls visual status states, count pluralization, jumping dots animation,
 * and linger timeouts.
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

let currentStatusMode: SidebarStatusState = 'idle';
let statusLingerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Last text rendered while in `jumping` mode. Reused as the lingering
 * text after a jump finishes so the user sees the final target instead of
 * an empty band.
 */
let lastJumpingText = '';

/**
 * Formats a prompt count with the correct singular/plural form for the
 * sidebar status band. Always produces "0 prompts" / "1 prompt" /
 * "N prompts".
 * @param {number} count
 * @returns {string}
 */
function pluralizePrompts(count: number): string {
  return count === 1 ? '1 prompt' : `${count} prompts`;
}

/**
 * Updates the small status line that lives between the sidebar header and
 * the prompt list. Owns five mutually exclusive states:
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
 *   - `idle`: nothing to convey. Hidden, no reserved space.
 *
 * Safe to call on every render — the helper short-circuits when neither
 * the mode nor the rendered text changes.
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
  const element = document.getElementById('luna-toc-status');
  if (!element) return;

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
      // Bare "Loading…" covers the `promptCount === 0` case (e.g. an
      // empty chat whose page hook never posted DATA). Once at least
      // one prompt has landed, appending "(N so far)" gives backfill
      // progress for long conversations.
      text = promptCount > 0 ? `Loading... (${promptCount} so far)` : 'Loading…';
      break;
    case 'empty':
      // Definitively empty chat: persistent, no linger timer.
      text = 'No prompts';
      break;
    case 'failed':
      // A jump could not resolve its target (e.g. the prompt is too far
      // to mount). Show briefly, then retract like `complete`.
      text = 'Jump failed';
      break;
    case 'complete':
      // Linger on the last jump text when transitioning out of a
      // jump so the user sees the destination they were scrolled to,
      // not a count that may have shifted by the time the band retracts.
      text =
        currentStatusMode === 'jumping'
          ? lastJumpingText
          : pluralizePrompts(promptCount);
      break;
    case 'idle':
    default:
      text = '';
  }

  if (state === currentStatusMode && element.textContent === text) {
    return;
  }

  currentStatusMode = state;

  if (state === 'jumping') {
    // The CSS `.jumping-dots .dot` keyframe animation owns the motion.
    // Build the DOM once on entry; subsequent calls during the same
    // jump hit the early-return above (textContent matches the prefix)
    // and leave the dots structure intact.
    const existingDots = element.querySelector('.jumping-dots');
    if (existingDots && element.firstChild && element.firstChild !== existingDots) {
      element.firstChild.textContent = text;
    } else {
      element.replaceChildren(
        document.createTextNode(text),
        buildJumpingDotsElement()
      );
    }
    element.classList.add('navigator-status-active');
    if (statusLingerTimer !== null) {
      clearTimeout(statusLingerTimer);
      statusLingerTimer = null;
    }
    return;
  }

  element.textContent = text;
  element.classList.toggle('navigator-status-active', state !== 'idle');

  if (statusLingerTimer !== null) {
    clearTimeout(statusLingerTimer);
    statusLingerTimer = null;
  }
  if (state === 'complete' || state === 'failed') {
    statusLingerTimer = window.setTimeout(() => {
      currentStatusMode = 'idle';
      element.textContent = '';
      element.classList.remove('navigator-status-active');
      statusLingerTimer = null;
    }, STATUS_LINGER_MS);
  }
}

/**
 * Builds the three-dot span cluster that the CSS keyframe animation drives.
 * Returned element: <span class="jumping-dots"><span class="dot"></span>...
 */
function buildJumpingDotsElement(): HTMLSpanElement {
  const container = document.createElement('span');
  container.className = 'jumping-dots';
  container.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    container.appendChild(dot);
  }
  return container;
}
