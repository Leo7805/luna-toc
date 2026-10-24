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

// One page can carry the whole history for typical conversations: the
// server does not cap `num_turns` at least up to 100, and the payload is
// bounded by message count (user + assistant), not prompt count.
const BACKFILL_NUM_TURNS = 100;
export const BACKFILL_PAGE_TIMEOUT_MS = 15_000;

interface BackfillJob {
  controller: AbortController;
  cancelledByNavigation: boolean;
}
const jobs = new Map<string, BackfillJob>();
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
  authHeaders: Record<string, string> | null,
  requestStartedAt?: number
): boolean {
  const pageInfo = (data as ConversationPayload | undefined)?.page_info;

  if (!pageInfo?.has_previous_page || !pageInfo?.start_cursor) return false;
  if (!routeKey || jobs.has(routeKey)) return false;

  const job: BackfillJob = { controller: new AbortController(), cancelledByNavigation: false };
  jobs.set(routeKey, job);
  void backfillPreviousPages(
    routeKey, pageInfo.start_cursor, authHeaders, job, requestStartedAt
  ).finally(() => {
    if (jobs.get(routeKey) === job) jobs.delete(routeKey);
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
  authHeaders: Record<string, string> | null,
  job: BackfillJob,
  requestStartedAt?: number
): Promise<void> {
  const platform = installedPlatform ?? getActivePlatform();
  let cursor = startCursor;
  let isComplete = false;
  const seenCursors = new Set<string>();

  try {
    for (let page = 0; page < platform.config.backfillMaxPages; page += 1) {
      if (!cursor || job.controller.signal.aborted || seenCursors.has(cursor)) return;
      seenCursors.add(cursor);

      let data: ConversationPayload;

      try {
        // Timeout covers both the network response and body parsing. Racing
        // against the abort event also frees the job if a host fetch ignores
        // AbortSignal and never settles.
        data = await fetchBackfillPage(
          platform.pageHook.buildBackfillUrl(conversationId, cursor),
          authHeaders, job.controller
        );
        if (job.controller.signal.aborted) return;
      } catch {
        return;
      }

      if (job.controller.signal.aborted) return;
      postConversationPayload(data, conversationId, platform, requestStartedAt);

      const pageInfo = data?.page_info;
      if (pageInfo?.has_previous_page === false) {
        isComplete = true;
        return;
      }
      if (!pageInfo?.start_cursor) {
        return;
      }

      cursor = pageInfo.start_cursor;
    }
  } finally {
    // Whatever path terminates backfill (network error, no further history,
    // or hitting `BACKFILL_MAX_PAGES` on a conversation longer than the
    // cap), always tell the navigator this route is done streaming pages.
    // The controller only flips out of `loading` once it sees this signal.
    if (!job.cancelledByNavigation) postConversationEnded(conversationId, platform, isComplete);
  }
}

/** Cancels jobs for routes no longer active after SPA navigation. */
export function cancelBackfillsExcept(activeRouteKey: string): void {
  for (const [routeKey, job] of jobs) {
    if (routeKey === activeRouteKey) continue;
    job.cancelledByNavigation = true;
    jobs.delete(routeKey);
    job.controller.abort();
  }
}

/** Per-page timeout releases hung fetches and hung JSON parsing alike. */
async function fetchBackfillPage(
  url: string,
  authHeaders: Record<string, string> | null,
  controller: AbortController
): Promise<ConversationPayload> {
  const signal = controller.signal;
  if (signal.aborted) throw new Error('Backfill cancelled');
  let abortListener: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abortListener = () => reject(new Error('Backfill cancelled or timed out'));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  const timeoutId = window.setTimeout(() => controller.abort(), BACKFILL_PAGE_TIMEOUT_MS);
  try {
    return await Promise.race([
      (async () => {
        const response = await originalFetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: authHeaders ?? undefined,
          signal,
        });
        if (!response.ok) throw new Error('Backfill HTTP error');
        const data = (await response.json()) as ConversationPayload;
        if (signal.aborted) throw new Error('Backfill cancelled');
        return data;
      })(),
      interrupted,
    ]);
  } finally {
    window.clearTimeout(timeoutId);
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

/**
 * Returns true when backfill is currently in flight for a given route key.
 * Used by `postConversationData` to avoid posting a premature end-of-stream
 * signal while backfill's `finally` will post one.
 */
export function isBackfilling(routeKey: string): boolean {
  return jobs.has(routeKey);
}

/**
 * Forwards one parsed conversation payload to the content script. Shared
 * by the initial-load response and by each backfill page.
 */
export function postConversationPayload(
  payload: unknown,
  routeKey: string,
  platform: Platform = installedPlatform ?? getActivePlatform(),
  requestStartedAt?: number
): void {
  window.postMessage(
    {
      type: platform.pageHook.messages.conversationData,
      ...(requestStartedAt !== undefined ? { requestStartedAt } : {}),
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
  platform: Platform = installedPlatform ?? getActivePlatform(),
  complete = false
): void {
  if (!routeKey) return;
  window.postMessage(
    {
      type: platform.pageHook.messages.conversationEnded,
      routeKey,
      complete,
    },
    '*'
  );
}

