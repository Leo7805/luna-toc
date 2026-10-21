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
import { installConversationBackfill } from './conversationBackfill';
import { installConversationRefresh } from './conversationRefresh';
import { installHistoryHook } from './historyHook';
import { installTitleObserver } from './titleObserver';

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
  installHistoryHook(platform.pageHook.messages.routeChanged);
  installTitleObserver(platform.pageHook.messages.titleChanged);

  window.addEventListener('message', (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: string;
      showCompatibilityAlert?: unknown;
      contractValues?: Record<string, unknown>;
    } | null;
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
        if (checkConversationPathAgainstContract(contractId, requestPath) === false) {
          reportContractMismatch(contractId, requestPath);
        }
      }
    } catch {}

    try {
      if (requestMeta?.isSendMessage) {
        extractOutgoingMessage(
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
        const authHeaders = requestMeta.isInitialConversationLoad
          ? getRequestHeaders(args[0], args[1])
          : null;

        if (authHeaders) observeRefreshHeaders(requestMeta.routeKey, authHeaders);

        postConversationData(
          response,
          requestMeta.routeKey,
          requestMeta.isInitialConversationLoad,
          authHeaders,
          requestStartedAt
        );
      }

      if (requestMeta?.isSendMessage) {
        inspectStream(
          response,
          requestMeta.routeKey,
          platform.pageHook.messages.newUserMessage
        ).catch(() => {});
      }
    } catch {}

    return response;
  };

})();