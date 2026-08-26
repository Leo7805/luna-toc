/**
 * Injected page-context hook. It captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts, and spoofs width media queries while
 * the ChatTOC sidebar is visible.
 *
 * This entry is a thin orchestrator: the heavy lifting lives in the focused
 * modules under `src/pageHook/`. Vite + CRXJS auto-discover the file from
 * `manifest.json` and bundle every imported submodule into a single IIFE
 * chunk; the source-level split exists for humans, the bundle for Chrome.
 */
import { APP_CONFIG } from '@/config/config';
import {
  maybeBumpChatGptFetchNumTurns,
  getFetchUrl,
} from '@/platforms/chatgpt/chatGptFetchBumper';
import { CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE } from '@/features/contractAlert/pageHookBridge';
import {
  checkConversationPathAgainstContract,
  installContractAlerts,
  reportContractMismatch,
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
import { installHistoryHook } from './historyHook';
import { installMatchMediaSpoof } from './matchMediaSpoof';
import { installTitleObserver } from './titleObserver';

(() => {
  const HOOK_FLAG = '__conversationNavigatorFetchHookInstalled';
  const hookWindow = window as unknown as Window & Record<string, unknown>;

  if (hookWindow[HOOK_FLAG]) {
    return;
  }

  hookWindow[HOOK_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  installConversationCapture({ originalFetch });
  installConversationBackfill({ originalFetch });
  installContractAlerts({ originalFetch });
  installMatchMediaSpoof();
  installHistoryHook();
  installTitleObserver();

  window.addEventListener('message', (event: MessageEvent): void => {
    const data = event.data as
      | {
          type?: string;
          contractValues?: Record<string, unknown>;
        }
      | null;
    if (!data || data.type !== CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE) return;
    if (data.contractValues && typeof data.contractValues === 'object') {
      setEffectiveContractValues(data.contractValues);
    }
  });

  window.fetch = async function (...args) {
    const requestMeta = inspectFetchRequest(args);

    try {
      const requestUrl = getFetchUrl(args[0]);
      const requestPath = new URL(requestUrl, window.location.origin).pathname;
      if (
        requestMeta &&
        requestMeta.isConversationGet &&
        requestPath.includes('/backend-api/conversations/')
      ) {
        // The bare conversation path and its `/messages` pagination
        // sub-resource are two distinct contracts. Comparing a `/messages`
        // GET against `api.conversation.path` produces a false-positive
        // "API path updated" alert, so pick the correct template using
        // the initial-load distinction already computed in
        // `inspectFetchRequest`.
        const contractId = requestMeta.isInitialConversationLoad
          ? 'api.conversation.path'
          : 'api.conversation.messages-path';
        const matches = checkConversationPathAgainstContract(
          contractId,
          requestPath
        );
        if (matches === false) {
          reportContractMismatch(contractId, requestPath);
        }
      }
    } catch {}

    try {
      if (requestMeta?.isSendMessage) {
        extractOutgoingMessage(args, requestMeta.routeKey);
      }
    } catch {}

    const fetchArgs = maybeBumpChatGptFetchNumTurns(args, {
      paginationNumTurns:
        APP_CONFIG.platforms.chatgpt.interceptChatGptPaginationNumTurns,
      initialLoadNumTurns:
        APP_CONFIG.platforms.chatgpt.interceptChatGptInitialLoadNumTurns,
    });
    const response = await originalFetch(...fetchArgs);

    try {
      if (requestMeta?.isConversationGet) {
        const authHeaders = requestMeta.isInitialConversationLoad
          ? getRequestHeaders(args[0], args[1])
          : null;

        postConversationData(
          response,
          requestMeta.routeKey,
          requestMeta.isInitialConversationLoad,
          authHeaders
        );
      }

      if (requestMeta?.isSendMessage) {
        // `inspectStream` resets the SSE line buffer before reading, so the
        // entry never touches that state directly.
        inspectStream(response, requestMeta.routeKey).catch(() => {});
      }
    } catch {}

    return response;
  };
})();