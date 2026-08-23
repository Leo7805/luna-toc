/**
 * Rewrites ChatGPT's own conversation-fetch requests to carry a larger
 * `num_turns` so its renderer fills the message store in a single fetch
 * instead of several small ones. Speeds up far-jump navigation: when the
 * slide loop scrolls to the conversation edge, the renderer's pagination
 * request now returns up to N turns in one round-trip rather than 3-4.
 *
 *   Initial load:  GET /backend-api/conversations/{id}            (no /messages)
 *   Pagination:    GET /backend-api/conversations/{id}/messages?before=X
 *
 * Our own backfill calls `originalFetch` directly, so it bypasses this
 * rewrite. On any parse error, returns the original args (safe no-op).
 *
 * The config is passed in (rather than read from a module-global) so the
 * function stays pure and trivially testable.
 */
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from './conversationRequest';

export type FetchArgs = Parameters<typeof fetch>;

export interface ChatGptFetchBumpConfig {
  /** Rewrite `num_turns` on `/messages?before=...` pagination. `null` = disable. */
  paginationNumTurns: number | null;
  /** Rewrite `num_turns` on `/conversations/{id}` initial loads. `null` = disable. */
  initialLoadNumTurns: number | null;
}

/**
 * Returns `args` with `num_turns` rewritten on ChatGPT's own conversation
 * fetches when a non-null target is configured for the matching request
 * shape. Returns the original `args` unchanged otherwise.
 */
export function maybeBumpChatGptFetchNumTurns(
  args: FetchArgs,
  config: ChatGptFetchBumpConfig
): FetchArgs {
  const input = args[0];
  const init = args[1];

  try {
    const urlString = getFetchUrl(input);
    const url = new URL(urlString, window.location.origin);

    const initialId = getConversationIdFromApiPath(url.pathname);
    const messagesId = getConversationMessagesIdFromApiPath(url.pathname);

    let target: number | null = null;

    if (messagesId !== null && url.searchParams.has('before')) {
      target = config.paginationNumTurns;
    } else if (initialId !== null && messagesId === null) {
      target = config.initialLoadNumTurns;
    }

    if (typeof target !== 'number') return args;

    url.searchParams.set('num_turns', String(target));

    if (typeof Request !== 'undefined' && input instanceof Request) {
      return [
        new Request(url.toString(), input),
        init,
      ] as unknown as FetchArgs;
    }
    return [url.toString(), init] as FetchArgs;
  } catch {
    return args;
  }
}

/**
 * Normalizes fetch input into a URL string so `Request` objects and string
 * URLs are handled the same way. Exported because the page hook's request
 * metadata extractor uses the same normalization independently.
 * @param {RequestInfo | URL} input
 * @returns {string}
 */
export function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof Request) {
    return input.url;
  }

  return input instanceof URL ? input.toString() : '';
}