/**
 * DOM mutation quiescence waiter for navigation load synchronization.
 */

/**
 * Result of awaiting DOM quiescence:
 * - true: DOM mutations occurred and settled into quiescence for debounceMs.
 * - false: timeoutMs elapsed without qualifying DOM changes.
 * - 'cancelled': navigation was aborted before or during observation.
 */
export type DomChangeWaitResult = boolean | 'cancelled';

/**
 * Standard timing configuration for host DOM pagination and load settling.
 */
export const DOM_SETTLE_CONFIG = {
  settleMs: 1500,
  debounceMs: 10,
} as const;

/**
 * One-shot MutationObserver wait: resolves true once DOM mutations have settled
 * into quiescence for debounceMs within timeoutMs, false on total timeout, or
 * 'cancelled' if navigation is aborted.
 *
 * Debounced so per-node callbacks fired by React during batch mounts or prepend
 * cycles coalesce into a single completion signal.
 *
 * @param root Parent node to observe (e.g. document.body).
 * @param isCancelled Predicate returning true if navigation was cancelled.
 * @param timeoutMs Maximum duration in milliseconds before resolving false (default: 1500ms).
 * @param debounceMs Duration in milliseconds of mutation silence required to resolve true (default: 10ms).
 * @returns Promise resolving to true on quiescence, false on timeout, or 'cancelled'.
 */
export function waitForDomChange(
  root: ParentNode,
  isCancelled: () => boolean,
  timeoutMs: number = DOM_SETTLE_CONFIG.settleMs,
  debounceMs: number = DOM_SETTLE_CONFIG.debounceMs
): Promise<DomChangeWaitResult> {
  return new Promise<DomChangeWaitResult>(function (resolve) {
    let settled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function finish(result: DomChangeWaitResult): void {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      resolve(result);
    }

    if (isCancelled()) {
      resolve('cancelled');
      return;
    }

    const observer = new MutationObserver(function () {
      if (isCancelled()) {
        finish('cancelled');
        return;
      }
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (isCancelled()) {
          finish('cancelled');
          return;
        }
        finish(true);
      }, debounceMs);
    });

    try {
      observer.observe(root, { childList: true, subtree: true });
    } catch {
      resolve(false);
      return;
    }

    timeoutTimer = setTimeout(function () {
      if (settled) return;
      finish(false);
    }, timeoutMs);
  });
}
