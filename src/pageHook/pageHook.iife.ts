/**
 * Injected page-context hook. Captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts, and spoofs width media queries while
 * the ChatTOC sidebar is visible.
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
import { APP_CONFIG } from '@/config/config';
import { getActivePlatform } from '@/platforms';
import { CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE } from '@/features/contractAlert/pageHookBridge';
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
  platform.pageHook.installMatchMediaSpoof();
  platform.pageHook.installMatchMediaToggleListener();
  installHistoryHook(platform.pageHook.messages.routeChanged);
  installTitleObserver(platform.pageHook.messages.titleChanged);

  window.addEventListener('message', (event: MessageEvent): void => {
    const data = event.data as
      | {
          type?: string;
          contractValues?: Record<string, unknown>;
        }
      | null;
    if (!data || data.type !== platform.pageHook.messages.configUpdate) return;
    if (data.contractValues && typeof data.contractValues === 'object') {
      // Contract-values are pushed into the platform's contract table by the
      // content script. Page-hook consumes them via the platform's contract
      // resolver rather than directly (re)writing a map.
      void data.contractValues;
    }
  });

  window.fetch = async function (...args) {
    const requestMeta = inspectFetchRequest(args, platform);

    try {
      const requestUrl = platform.pageHook.fetch.getFetchUrl(args[0]);
      const requestPath = new URL(requestUrl, window.location.origin).pathname;
      if (
        requestMeta?.isConversationGet &&
        requestPath.includes('/backend-api/conversations/')
      ) {
        // ChatGPT-specific path check kept inline until the routing adapter
        // exposes a richer API. The check is intentionally narrow so other
        // platforms with `/api/conversations/` style URLs are unaffected.
        const contractIds = platform.config.contract.ids as readonly string[];
        const initialId = contractIds.find((id) =>
          id.startsWith('api.conversation.path')
        );
        const messagesId = contractIds.find((id) =>
          id.startsWith('api.conversation.messages-path')
        );
        const contractId = requestMeta.isInitialConversationLoad
          ? initialId
          : messagesId;
        if (contractId) {
          const expected = platform.config.contract.resolve(
            contractId,
            platform.config.useLocalConfig
          );
          if (
            expected &&
            !buildPathRegexFromTemplate(expected).test(requestPath)
          ) {
            // Forward to the platform-agnostic contract-mismatch reporter
            // (populated in step 7).
            void contractId;
          }
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
        inspectStream(
          response,
          requestMeta.routeKey,
          platform.pageHook.messages.newUserMessage
        ).catch(() => {});
      }
    } catch {}

    return response;
  };

  /**
   * Builds a RegExp from a contract path template by escaping every regex
   * special character and substituting the `{id}` placeholder with a path
   * segment matcher. Duplicated here from `contractAlerts` to keep the
   * page-hook entry self-contained; the contractAlerts module exposes a
   * `checkConversationPathAgainstContract` helper in step 7 that the entry
   * will switch to once `effectiveContractValues` flows through.
   */
  function buildPathRegexFromTemplate(template: string): RegExp {
    const parts = template.split('{id}').map((part) =>
      part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    return new RegExp('^' + parts.join('([^/]+)') + '/?$');
  }
})();