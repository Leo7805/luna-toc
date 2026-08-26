/**
 * Hijacks HTML5 History API mutations to notify the content script of SPA
 * routing transitions. Replaces `window.history.pushState` and
 * `window.history.replaceState` so a navigation fires a `CHATGPT_ROUTE_CHANGED`
 * message immediately, with no polling.
 */
const CHATGPT_ROUTE_CHANGED = 'CHATGPT_ROUTE_CHANGED';

/**
 * Wraps `history.pushState` and `history.replaceState` so each call also posts
 * a `CHATGPT_ROUTE_CHANGED` message to the content-script world.
 */
export function installHistoryHook(): void {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  if (typeof originalPushState === 'function') {
    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      notifyRouteChanged();
    };
  }

  if (typeof originalReplaceState === 'function') {
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      notifyRouteChanged();
    };
  }
}

/**
 * Sends a message to the content script indicating that navigation occurred.
 */
function notifyRouteChanged(): void {
  window.postMessage(
    {
      type: CHATGPT_ROUTE_CHANGED,
    },
    '*'
  );
}