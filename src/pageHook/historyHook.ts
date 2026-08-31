/**
 * Hijacks HTML5 History API mutations to notify the content script of SPA
 * routing transitions. Replaces `window.history.pushState` and
 * `window.history.replaceState` so a navigation fires a `CHATGPT_ROUTE_CHANGED`
 * message immediately, with no polling.
 *
 * The route-changed message type is provided by the caller so the same
 * hook can serve any platform.
 */
type RouteChangedMessageType = string;

/**
 * Wraps `history.pushState` and `history.replaceState` so each call also posts
 * a route-changed message to the content-script world.
 */
export function installHistoryHook(messageType: RouteChangedMessageType): void {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  if (typeof originalPushState === 'function') {
    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      notifyRouteChanged(messageType);
    };
  }

  if (typeof originalReplaceState === 'function') {
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      notifyRouteChanged(messageType);
    };
  }
}

/**
 * Sends a message to the content script indicating that navigation occurred.
 */
function notifyRouteChanged(messageType: RouteChangedMessageType): void {
  window.postMessage(
    {
      type: messageType,
    },
    '*'
  );
}