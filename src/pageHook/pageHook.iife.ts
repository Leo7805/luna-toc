/**
 * Injected page-context hook. Captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts without altering host media queries.
 *
 * This entry is a thin per-platform orchestrator: the heavy lifting lives
 * in the focused modules under `src/pageHook/` (platform-agnostic) and the
 * `Platform.pageHook` adapter (platform-specific). The runtime entry calls
 * `getActivePlatform()` once and threads its adapter through to the
 * generic modules.
 *
 * Vite + CRXJS auto-discover the file from `manifest.json` and bundle
 * every imported submodule into a single IIFE chunk; the source-level
 * split exists for humans, the bundle for Chrome.
 */
import { getActivePlatform } from '@/platforms';
import {
  checkConversationPathAgainstContract,
  installContractAlerts,
  reportContractMismatch,
  reportContractRecovered,
  resetContractMismatchCounters,
  setContractProbesEnabled,
  setEffectiveContractValues,
} from './contractAlerts';
import {
  extractOutgoingMessage,
  getRequestHeaders,
  installConversationCapture,
  inspectFetchRequest,
  inspectStream,
  postConversationData,
} from './conversationCapture';
import { cancelBackfillsExcept, installConversationBackfill } from './conversationBackfill';
import { installConversationRefresh } from './conversationRefresh';
import { TOC_EDIT_SUBMISSION } from '@/navigation/refresh/refreshProtocol';
import { installConversationLifecycle } from './conversationLifecycle';
import { installHistoryHook } from './historyHook';
import { installTitleObserver } from './titleObserver';
import { PAGE_HOOK_HEALTH_PING, PAGE_HOOK_HEALTH_PONG } from '@/features/contractAlert/toolbarWarning';

(() => {
  const platform = getActivePlatform();
  const HOOK_FLAG = platform.pageHook.installFlag;
  const hookWindow = window as unknown as Window & Record<string, unknown>;

  if (hookWindow[HOOK_FLAG]) {
    return;
  }

  hookWindow[HOOK_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  installConversationCapture({ originalFetch });
  installConversationBackfill({ originalFetch, platform });
  installContractAlerts({ originalFetch });
  const observeRefreshHeaders = installConversationRefresh(originalFetch, platform);
  installConversationLifecycle(originalFetch);
  installHistoryHook(platform.pageHook.messages.routeChanged);
  // Back/forward navigation bypasses history.pushState/replaceState wrappers.
  window.addEventListener('popstate', () => {
    cancelBackfillsExcept(platform.routing.getCurrentRouteKey());
  });
  installTitleObserver(platform.pageHook.messages.titleChanged);

  window.addEventListener('message', (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: string;
      showCompatibilityAlert?: unknown;
      contractValues?: Record<string, unknown>;
    } | null;
    if (data?.type === platform.pageHook.messages.routeChanged) {
      cancelBackfillsExcept(platform.routing.getCurrentRouteKey());
      resetContractMismatchCounters();
      return;
    }
    if (data?.type === PAGE_HOOK_HEALTH_PING) {
      window.postMessage({ type: PAGE_HOOK_HEALTH_PONG }, location.origin);
      return;
    }
    if (!data || data.type !== platform.pageHook.messages.configUpdate) return;
    if (data.contractValues && typeof data.contractValues === 'object') {
      setEffectiveContractValues(data.contractValues);
    }
    setContractProbesEnabled(data.showCompatibilityAlert === true);
  });

  window.fetch = async function (...args) {
    const requestMeta = inspectFetchRequest(args, platform);
    try {
      if (requestMeta?.isConversationGet) {
        const requestUrl = platform.pageHook.fetch.getFetchUrl(args[0]);
        const requestPath = new URL(requestUrl, window.location.origin).pathname;
        const contractId = requestMeta.isInitialConversationLoad
          ? 'api.conversation.path'
          : 'api.conversation.messages-path';
        const matches = checkConversationPathAgainstContract(contractId, requestPath);
        if (matches === false) {
          reportContractMismatch(contractId, requestPath);
        } else if (matches === true) {
          reportContractRecovered(contractId);
        }
      }
    } catch {}

    let outgoingMessageMeta: ReturnType<typeof extractOutgoingMessage> = null;
    try {
      if (requestMeta?.isSendMessage) {
        outgoingMessageMeta = extractOutgoingMessage(
          args,
          requestMeta.routeKey,
          platform.pageHook.messages.newUserMessage
        );
      }
    } catch {}

    const fetchArgs = platform.pageHook.fetch.maybeBumpFetch(args, {
      paginationNumTurns: platform.config.interceptFetchNumTurns.pagination,
      initialLoadNumTurns:
        platform.config.interceptFetchNumTurns.initialLoad,
    });
    const requestStartedAt = Date.now();
    const response = await originalFetch(...fetchArgs);
    try {
      if (requestMeta?.isConversationGet) {
        // Both full and paginated conversation requests can carry auth headers.
        const requestHeaders = getRequestHeaders(args[0], args[1]);
        if (Object.keys(requestHeaders).length > 0) {
          observeRefreshHeaders(requestMeta.routeKey, requestHeaders);
        }

        postConversationData(
          response,
          requestMeta.routeKey,
          requestMeta.isInitialConversationLoad,
          requestMeta.isInitialConversationLoad ? requestHeaders : null,
          requestStartedAt
        );
      }

      if (requestMeta?.isSendMessage) {
        if (response.ok && outgoingMessageMeta?.parentMessageId) {
          window.postMessage({
            type: TOC_EDIT_SUBMISSION,
            stage: 'accepted',
            routeKey: requestMeta.routeKey,
            messageId: outgoingMessageMeta.messageId,
            parentMessageId: outgoingMessageMeta.parentMessageId,
          }, location.origin);
        }

        const streamInspection = inspectStream(
          response,
          requestMeta.routeKey,
          platform.pageHook.messages.newUserMessage
        );
        if (outgoingMessageMeta?.parentMessageId) {
          const notifyStreamFinished = () => {
            window.postMessage({
              type: TOC_EDIT_SUBMISSION,
              stage: 'finished',
              routeKey: requestMeta.routeKey,
              messageId: outgoingMessageMeta!.messageId,
              parentMessageId: outgoingMessageMeta!.parentMessageId,
            }, location.origin);
          };
          void streamInspection.then(notifyStreamFinished, notifyStreamFinished).catch(() => {});
        } else {
          streamInspection.catch(() => {});
        }
      }
    } catch {}

    return response;
  };

})();