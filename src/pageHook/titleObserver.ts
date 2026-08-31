/**
 * Watches `document.title` for mutations and forwards every change to the
 * content-script world so the sidebar's title can stay in sync with the
 * host's conversation title. The host mutates `document.title` directly
 * when the user renames a conversation; no conversation-data request
 * fires for a rename, so the existing route / conversation-data triggers
 * cannot catch it.
 *
 * The title-changed message type is provided by the caller so the same
 * observer can serve any platform.
 *
 * The observer is set up at MAIN-world `document_start`. The `<title>`
 * element is in `<head>` and is normally present immediately, but a tiny
 * retry loop guards against the edge case where the host replaces the
 * element rather than mutating its text node. The initial title is read
 * and posted once at observer setup so a hard refresh surfaces the latest
 * value without waiting for a mutation.
 */
const RETRY_INTERVAL_MS = 50;

type TitleChangedMessageType = string;

/**
 * Starts observing `<title>` mutations and posts the initial value once.
 * Safe to call once at page-hook startup.
 */
export function installTitleObserver(messageType: TitleChangedMessageType): void {
  tryObserve(messageType);
}

function tryObserve(messageType: TitleChangedMessageType): void {
  const titleEl = document.querySelector('title');
  if (!titleEl) {
    setTimeout(() => tryObserve(messageType), RETRY_INTERVAL_MS);
    return;
  }
  try {
    let lastSent = '';
    const post = (): void => {
      const current = document.title;
      if (current === lastSent) return;
      lastSent = current;
      try {
        window.postMessage(
          { type: messageType, title: current },
          window.location.origin
        );
      } catch {
        // PostMessage failures are non-fatal.
      }
    };
    // Surface the current title at observer setup so a hard refresh also
    // picks up the latest value without waiting for a mutation.
    post();
    const observer = new MutationObserver(post);
    observer.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  } catch {
    // Observer setup failures are non-fatal.
  }
}