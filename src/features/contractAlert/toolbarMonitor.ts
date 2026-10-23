/**
 * Always-on content-script compatibility monitor. It reuses contract drift
 * reports and provides a passive last-resort hook/DOM health check.
 */
import { APP_CONFIG } from '@/config/config';
import { missingChatGptDomMarkers } from './healthSignals';
import { recordMismatch, subscribeMismatches } from './detector';
import {
  PAGE_HOOK_HEALTH_PING,
  PAGE_HOOK_HEALTH_PONG,
  TOOLBAR_COMPATIBILITY_WARNING,
} from './toolbarWarning';

const PROBE_INTERVAL_MS = 5000;

/** Forwards a brief diagnosis without accessing or exporting chat content. */
function notifyToolbar(detail: string): void {
  try {
    void chrome.runtime.sendMessage({
      type: TOOLBAR_COMPATIBILITY_WARNING,
      detail: detail.slice(0, 180),
    }).catch(() => {
      // An extension reload can invalidate a running content script.
    });
  } catch {
    // Detached contexts cannot signal their toolbar.
  }
}

/**
 * On an existing chat, warn only after repeated missing markers. In parallel,
 * a three-attempt handshake detects a broken MAIN-world content-script hook.
 */
export function startToolbarCompatibilityMonitor(): () => void {
  let hookResponded = false;
  let pingCount = 0;
  let previousMissing = '';
  let repeatedMissing = 0;

  const unsubscribe = subscribeMismatches((records) => {
    if (records.length > 0) {
      notifyToolbar(`检测到 ChatGPT 兼容性变化：${records.map((r) => r.label).join('、')}`);
    }
  });
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === PAGE_HOOK_HEALTH_PONG) hookResponded = true;
  };
  window.addEventListener('message', onMessage);

  const inspect = (): void => {
    if (document.readyState === 'loading') return;

    if (!hookResponded) {
      if (pingCount >= 3) {
        recordMismatch('postmessage.hook-flag',
          'MAIN-world hook responds to a health check',
          'No response after three health checks');
      } else {
        pingCount += 1;
        window.postMessage({ type: PAGE_HOOK_HEALTH_PING }, location.origin);
      }
    }

    const hasRenderedTurns = Boolean(document.querySelector(
      '[data-testid^="conversation-turn-"], [data-turn-id], main article'
    ));
    const missing = missingChatGptDomMarkers(
      location.pathname,
      hasRenderedTurns,
      document.querySelector('[data-message-author-role="user"]') !== null,
      document.querySelector('[data-message-id]') !== null
    );
    const signature = missing.join(',');
    repeatedMissing = signature && signature === previousMissing
      ? repeatedMissing + 1 : (signature ? 1 : 0);
    previousMissing = signature;
    if (repeatedMissing < 2) return;

    for (const id of missing) {
      recordMismatch(id, APP_CONFIG.platforms.chatgpt.contract[id].formal,
        'Rendered chat turns lack the expected DOM marker');
    }
  };

  const firstProbe = window.setTimeout(inspect, 1500);
  const interval = window.setInterval(inspect, PROBE_INTERVAL_MS);
  return () => {
    window.clearTimeout(firstProbe);
    window.clearInterval(interval);
    window.removeEventListener('message', onMessage);
    unsubscribe();
  };
}
