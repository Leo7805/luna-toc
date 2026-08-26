/**
 * Thin orchestrator that wires together the conversation-capture sub-modules.
 *
 * - `inspectFetchRequest` classifies a `window.fetch` call so the entry can
 *   dispatch the right follow-up actions.
 * - `postConversationData` consumes a conversation GET response, forwards
 *   the parsed payload, and triggers backfill / contract probes.
 * - `extractOutgoingMessage`, `inspectStream`, and `getRequestHeaders` are
 *   re-exported from the dedicated sub-modules so the entry has a single
 *   import surface.
 *
 * The `installConversationCapture` factory is a no-op kept for parity with
 * the other `install*` factories. Sub-modules that need `originalFetch` get
 * it directly via their own factories.
 */
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from '@/platforms/chatgpt/conversationRequest';
import { getFetchUrl } from '@/platforms/chatgpt/chatGptFetchBumper';
import {
  probeNumTurnsBehavior,
  probeDomSelectors,
  reportContractMismatch,
} from './contractAlerts';
import {
  isBackfilling,
  postConversationEnded,
  postConversationPayload,
  startBackfillIfNeeded,
} from './conversationBackfill';
import { extractOutgoingMessage, inspectStream } from './conversationStream';
import type {
  ConversationPayload,
  FetchArgs,
  RequestMeta,
} from './fetchHelpers';
import {
  getCurrentConversationKey,
  getFetchMethod,
  getRequestHeaders,
} from './fetchHelpers';

export { extractOutgoingMessage, getRequestHeaders, inspectStream };

const SEND_MESSAGE_PATH = '/backend-api/f/conversation';

/**
 * Reserved for future module warmup. Currently a no-op so the entry keeps a
 * consistent `install*({ originalFetch })` shape across sub-modules.
 */
export function installConversationCapture(_opts: {
  originalFetch: typeof fetch;
}): void {
  // `originalFetch` is wired directly into `conversationBackfill` and
  // `contractAlerts` by the entry, so this module does not need to capture
  // it. The factory stays here as a hook for future warming.
}

/**
 * Classifies a `window.fetch` call site so the entry can dispatch the right
 * follow-up actions. Returns `null` when the request does not look like a
 * ChatGPT conversation endpoint we care about.
 */
export function inspectFetchRequest(args: FetchArgs): RequestMeta | null {
  try {
    const input = args[0];
    const init = args[1] || {};
    const url = getFetchUrl(input);

    if (!url) {
      return null;
    }

    const method = getFetchMethod(input, init);
    const pathname = new URL(url, window.location.origin).pathname;
    const conversationId = getConversationIdFromApiPath(pathname);
    const messagesConversationId =
      getConversationMessagesIdFromApiPath(pathname);
    const effectiveConversationId = conversationId ?? messagesConversationId;
    const isConversationGet =
      method === 'GET' && effectiveConversationId !== null;

    return {
      isConversationGet,
      isInitialConversationLoad: conversationId !== null,
      isSendMessage: method === 'POST' && pathname === SEND_MESSAGE_PATH,
      routeKey: isConversationGet
        ? effectiveConversationId
        : getCurrentConversationKey(),
    };
  } catch {
    return null;
  }
}

/**
 * Clones ChatGPT's conversation GET response and sends the parsed payload to
 * the content script without consuming the page's original response body.
 */
export function postConversationData(
  response: Response,
  routeKey: string,
  isInitialConversationLoad: boolean,
  authHeaders: Record<string, string> | null
): void {
  response
    .clone()
    .json()
    .then((data) => {
      postConversationPayload(data, routeKey);

      const messages = (data as { messages?: unknown } | null)?.messages;
      if (!Array.isArray(messages)) {
        reportContractMismatch(
          'response.messages-field',
          `typeof messages = ${typeof messages}`
        );
      }

      if (isInitialConversationLoad) {
        const backfillStarted = startBackfillIfNeeded(
          data,
          routeKey,
          authHeaders
        );
        // Skip the probe when the conversation is empty — a brand-new
        // chat has 0 messages by definition, and the probe would see 0
        // messages from its own fetches and falsely alert on "no
        // content". For any non-empty conversation the probe runs
        // unconditionally: it only alerts when both num_turns requests
        // return 0 messages, the only failure mode that actually
        // matters.
        if (Array.isArray(messages) && messages.length > 0) {
          void probeNumTurnsBehavior(routeKey, authHeaders);
        }
        probeDomSelectors();
        // If the initial response already represents the whole conversation
        // and no backfill is currently in flight for this route, the
        // backfill branch above won't fire the ENDED signal — do it here.
        // (If backfill already started for this route, either via the
        // branch above or by an earlier fetch, its `finally` will post
        // ENDED when it terminates, so we must not preempt it.)
        const pageInfo = (data as ConversationPayload | undefined)?.page_info;
        if (
          !backfillStarted &&
          !isBackfilling(routeKey) &&
          !pageInfo?.has_previous_page
        ) {
          postConversationEnded(routeKey);
        }
      }
    })
    .catch(() => {});
}