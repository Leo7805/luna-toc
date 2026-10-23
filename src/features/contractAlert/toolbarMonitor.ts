/**
 * Always-on, passive compatibility monitor. Tracks confirmed problems separately
 * from the developer dialog: manually dismissing a dialog is not recovery.
 */
import { APP_CONFIG, type ChatGptContractId } from '@/config/config';
import { CHATGPT_MESSAGE_TYPES } from '@/platforms/chatgpt/messages';
import { canInspectChatGptDom, missingChatGptDomMarkers } from './healthSignals';
import { dismissAllMismatches, dismissMismatch, recordMismatch, subscribeMismatches } from './detector';
import { PAGE_HOOK_RECOVERY_MESSAGE_TYPE } from './pageHookBridge';
import {
  PAGE_HOOK_HEALTH_PING,
  PAGE_HOOK_HEALTH_PONG,
  TOOLBAR_COMPATIBILITY_WARNING,
  TOOLBAR_COMPATIBILITY_HEALTHY,
} from './toolbarWarning';

const PROBE_INTERVAL_MS = 5000;
const MARKER_STREAK = 2;
const DOM_MARKER_IDS = [
  'dom.selector.user-message', 'dom.selector.message-id',
] as const;

/** Sends only contract labels and the state revision, never chat contents. */
export function startToolbarCompatibilityMonitor(): () => void {
  const active = new Map<ChatGptContractId, string>();
  const healthyStreak = new Map<ChatGptContractId, number>();
  const routeChangedType = CHATGPT_MESSAGE_TYPES.routeChanged;
  let pathname = location.pathname;
  let revision = 0;
  let sentSignature: string | null = null;
  let hookResponded = false;
  let pingCount = 0;
  let previousMissing = '';
  let repeatedMissing = 0;
  let nextProbeAt = 0;
  let routeProbe: number | null = null;

  const publish = (): void => {
    const ids = Array.from(active.keys()).sort();
    const signature = ids.join(',');
    if (signature === sentSignature) return;
    sentSignature = signature;
    revision += 1;
    const detail = ids.map((id) => active.get(id) ?? id).join('、').slice(0, 180);
    const message = detail
      ? { type: TOOLBAR_COMPATIBILITY_WARNING, detail, revision }
      : { type: TOOLBAR_COMPATIBILITY_HEALTHY, revision };
    try {
      void chrome.runtime.sendMessage(message).catch(() => {
        // An extension reload can invalidate a running content script.
      });
    } catch {
      // Detached contexts cannot signal their toolbar.
    }
  };

  const recover = (id: ChatGptContractId): void => {
    healthyStreak.delete(id);
    active.delete(id);
    dismissMismatch(id);
    publish();
  };

  const unsubscribe = subscribeMismatches((records) => {
    for (const record of records) active.set(record.contractId, record.label);
    // The dialog's dismiss operation cannot establish that a contract recovered.
    publish();
  });

  const resetForRoute = (): void => {
    if (location.pathname === pathname) return;
    pathname = location.pathname;
    active.clear();
    healthyStreak.clear();
    dismissAllMismatches();
    hookResponded = false;
    pingCount = 0;
    previousMissing = '';
    repeatedMissing = 0;
    nextProbeAt = Date.now() + 1500;
    publish();
    if (routeProbe !== null) window.clearTimeout(routeProbe);
    routeProbe = window.setTimeout(inspect, 1500);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { type?: unknown; contractId?: unknown } | null;
    if (data?.type === routeChangedType) {
      resetForRoute();
      return;
    }
    if (data?.type === PAGE_HOOK_HEALTH_PONG) {
      hookResponded = true;
      pingCount = 0;
      recover('postmessage.hook-flag');
      return;
    }
    if (data?.type === PAGE_HOOK_RECOVERY_MESSAGE_TYPE &&
        typeof data.contractId === 'string' &&
        Object.prototype.hasOwnProperty.call(APP_CONFIG.platforms.chatgpt.contract, data.contractId)) {
      recover(data.contractId as ChatGptContractId);
    }
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('popstate', resetForRoute);

  const inspect = (): void => {
    // A route can change without a hook event (e.g. native browser navigation).
    resetForRoute();
    if (document.readyState === 'loading' || Date.now() < nextProbeAt) return;

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
    if (!canInspectChatGptDom(location.pathname, hasRenderedTurns)) return;
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

    for (const id of DOM_MARKER_IDS) {
      if (missing.includes(id)) {
        healthyStreak.delete(id);
        if (repeatedMissing >= MARKER_STREAK) {
          recordMismatch(id, APP_CONFIG.platforms.chatgpt.contract[id].formal,
            'Rendered chat turns lack the expected DOM marker');
        }
      } else {
        const streak = (healthyStreak.get(id) ?? 0) + 1;
        healthyStreak.set(id, streak);
        if (streak >= MARKER_STREAK && active.has(id)) recover(id);
      }
    }
  };

  const firstProbe = window.setTimeout(inspect, 1500);
  const interval = window.setInterval(inspect, PROBE_INTERVAL_MS);
  return () => {
    window.clearTimeout(firstProbe);
    window.clearInterval(interval);
    if (routeProbe !== null) window.clearTimeout(routeProbe);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('popstate', resetForRoute);
    unsubscribe();
  };
}
