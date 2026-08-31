/**
 * Paginates older conversation history after the initial load when
 * `page_info.has_previous_page` is set. Posts each parsed page to the
 * content script and emits a platform-specific end-of-stream signal from
 * the terminal `finally` block so the navigator can leave `loading` mode
 * regardless of how backfill terminates.
 *
 * Owns the `backfillingConversationIds` set and the `originalFetch`
 * binding injected by `installConversationBackfill`. The message-type
 * strings come from the active platform via `Platform.pageHook.messages`,
 * keeping this module platform-agnostic at the wire level.
 */
import type { Platform } from '@/platforms';
import { getActivePlatform } from '@/platforms';
import type { ConversationPayload } from './fetchHelpers';

const BACKFILL_MAX_PAGES_FALLBACK = 10;
// One page can carry the whole history for typical conversations: the
// server does not cap `num_turns` at least up to 100, and the payload is
// bounded by message count (user + assistant), not prompt count.
const BACKFILL_NUM_TURNS = 100;

const backfillingConversationIds = new Set<string>();
let originalFetch: typeof fetch = window.fetch.bind(window);
let installedPlatform: Platform | null = null;

/**
 * Reserved for future module warmup. The entry passes the page-bound
 * `originalFetch` and platform once so backfill can replay platform
 * requests without going through our own `window.fetch` override.
 */
export function installConversationBackfill(opts: {
  originalFetch: typeof fetch;
  platform?: Platform;
}): void {
  originalFetch = opts.originalFetch;
  installedPlatform = opts.platform ?? null;
}

/**
 * Starts a bounded backfill of older conversation pages when the initial
 * response indicates there is earlier history to load.
 * @param {unknown} data Parsed initial conversation payload.
 * @param {string} routeKey Conversation ID captured when the request was made.
 * @returns {boolean} Whether backfill was actually started. Callers use the
 *   `false` return to decide whether the ENDED signal should fire immediately
 *   (no backfill means no later ENDED from `backfillPreviousPages`).
 */
export function startBackfillIfNeeded(
  data: unknown,
  routeKey: string,
  authHeaders: Record<string, string> | null
): boolean {
  const pageInfo = (data as ConversationPayload | undefined)?.page_info;

  if (!pageInfo?.has_previous_page || !pageInfo?.start_cursor) return false;
  if (!routeKey || backfillingConversationIds.has(routeKey)) return false;

  backfillingConversationIds.add(routeKey);
  backfillPreviousPages(
    routeKey,
    pageInfo.start_cursor,
    authHeaders
  ).finally(() => {
    backfillingConversationIds.delete(routeKey);
  });
  return true;
}

/**
 * Fetches earlier pages by cursor until the beginning of the conversation or
 * the page cap is reached. Any failure stops the chain silently so the
 * navigator falls back to accumulating whatever pages the host loads itself.
 */
async function backfillPreviousPages(
  conversationId: string,
  startCursor: string,
  authHeaders: Record<string, string> | null
): Promise<void> {
  const platform = installedPlatform ?? getActivePlatform();
  let cursor = startCursor;

  try {
    for (let page = 0; page < platform.config.backfillMaxPages; page += 1) {
      if (!cursor) return;

      let data: ConversationPayload;

      try {
        const response = await originalFetch(
          platform.pageHook.buildBackfillUrl(conversationId, cursor),
          {
            method: 'GET',
            credentials: 'include',
            headers: authHeaders ?? undefined,
          }
        );

        if (!response.ok) return;
        data = (await response.json()) as ConversationPayload;
      } catch {
        return;
      }

      postConversationPayload(data, conversationId, platform);

      const pageInfo = data?.page_info;
      if (!pageInfo?.has_previous_page || !pageInfo?.start_cursor) return;

      cursor = pageInfo.start_cursor;
    }
  } finally {
    // Whatever path terminates backfill (network error, no further history,
    // or hitting `BACKFILL_MAX_PAGES` on a conversation longer than the
    // cap), always tell the navigator this route is done streaming pages.
    // The controller only flips out of `loading` once it sees this signal.
    postConversationEnded(conversationId, platform);
  }
}

/**
 * Returns true when backfill is currently in flight for a given route key.
 * Used by `postConversationData` to avoid posting a premature end-of-stream
 * signal while backfill's `finally` will post one.
 */
export function isBackfilling(routeKey: string): boolean {
  return backfillingConversationIds.has(routeKey);
}

/**
 * Forwards one parsed conversation payload to the content script. Shared
 * by the initial-load response and by each backfill page.
 */
export function postConversationPayload(
  payload: unknown,
  routeKey: string,
  platform: Platform = installedPlatform ?? getActivePlatform()
): void {
  window.postMessage(
    {
      type: platform.pageHook.messages.conversationData,
      routeKey,
      payload,
    },
    '*'
  );
}

/**
 * Signals that the page hook has finished streaming every conversation
 * page it intends to send (initial load plus any backfill). Emitted when:
 *  - the initial response had no further history to backfill, or
 *  - backfill terminated naturally at the page cap, or
 *  - backfill exited because the next page reported no further history.
 *
 * The content script uses this to leave `loading` mode. The earlier
 * `has_previous_page !== false` heuristic in the controller treated any
 * missing/incomplete field as "still loading", which stranded the UI when
 * the backend omitted `page_info` on the final response or when the
 * backfill cap was reached before the true last page.
 */
export function postConversationEnded(
  routeKey: string,
  platform: Platform = installedPlatform ?? getActivePlatform()
): void {
  if (!routeKey) return;
  window.postMessage(
    {
      type: platform.pageHook.messages.conversationEnded,
      routeKey,
    },
    '*'
  );
}

// Re-exported for compatibility with the previous default; consumers that
// don't have a platform reference still get a sensible chatgpt fallback.
const _UNUSED_BACKFILL_MAX_PAGES = BACKFILL_MAX_PAGES_FALLBACK;
void _UNUSED_BACKFILL_MAX_PAGES;