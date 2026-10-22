/**
 * Manages the sidebar status banner between the sidebar header and prompt list.
 * Controls visual status states, count pluralization, silent jumping,
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
  | 'failed'
  | 'stale';

let currentStatusMode: SidebarStatusState = 'idle';
let statusLingerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Formats a prompt count with the correct singular/plural form for the
 * sidebar status band. Always produces "0 prompts" / "1 prompt" /
 * "N prompts".
 * @param {number} count
 * @returns {string}
 */
function pluralizePrompts(count: number): string {
  return count === 1 ? '1 条提示词' : `${count} 条提示词`;
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
  jump?: { active: boolean; targetIndex: number; remainingSteps: number } | null;
  promptCount?: number;
}): void {
  const { state, promptCount = 0 } = options;
  const element = document.getElementById('luna-toc-status');
  if (!element) return;

  // Keep the jump state for virtual navigation, but do not flash an animated
  // progress band or a completion count on every TOC click.
  if (state === 'jumping' || (state === 'complete' && currentStatusMode === 'jumping')) {
    if (statusLingerTimer !== null) {
      clearTimeout(statusLingerTimer);
      statusLingerTimer = null;
    }
    currentStatusMode = state === 'jumping' ? 'jumping' : 'idle';
    element.replaceChildren();
    element.classList.remove('navigator-status-active');
    return;
  }

  let text: string;

  switch (state) {
    case 'loading':
      // Bare "Loading…" covers the `promptCount === 0` case (e.g. an
      // empty chat whose page hook never posted DATA). Once at least
      // one prompt has landed, appending "(N so far)" gives backfill
      // progress for long conversations.
      text = promptCount > 0 ? `加载中...（已加载 ${promptCount} 条）` : '加载中…';
      break;
    case 'empty':
      // Definitively empty chat: persistent, no linger timer.
      text = '暂无提示词';
      break;
    case 'stale':
      text = '目录缓存未验证，请重新打开目录刷新';
      break;
    case 'failed':
      // A jump could not resolve its target (e.g. the prompt is too far
      // to mount). Show briefly, then retract like `complete`.
      text = '跳转失败';
      break;
    case 'complete':
      text = pluralizePrompts(promptCount);
      break;
    case 'idle':
    default:
      text = '';
  }

  if (state === currentStatusMode && element.textContent === text) {
    return;
  }

  currentStatusMode = state;

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
