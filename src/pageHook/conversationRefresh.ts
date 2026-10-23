/**
 * On-demand, same-origin conversation snapshots. The page hook owns the
 * authenticated request; headers and session credentials never cross the
 * MAIN/ISOLATED messaging boundary.
 */
import type { Platform } from '@/platforms';
import type { ConversationData } from '@/features/conversationPrompts/message';
import { extractActiveBranchMessages, type ConversationSnapshot } from '@/navigation/state/activeBranch';
import {
  TOC_REFRESH_CANCEL,
  TOC_REFRESH_REQUEST,
  TOC_REFRESH_RESULT,
  TOC_REFRESH_TIMEOUT_MS,
} from '@/navigation/refresh/refreshProtocol';

type HeaderMap = Record<string, string>;

interface PendingRefresh {
  controller: AbortController;
  requestIds: Set<number>;
  timeoutId: number;
}

export function installConversationRefresh(
  originalFetch: typeof fetch,
  platform: Platform
): (routeKey: string, headers: HeaderMap) => void {
  const headersByRoute = new Map<string, HeaderMap>();
  const inFlight = new Map<string, PendingRefresh>();

  function postResult(routeKey: string, requestId: number, payload: ConversationSnapshot | null): void {
    window.postMessage({ type: TOC_REFRESH_RESULT, routeKey, requestId, payload }, location.origin);
  }

  function finishRefresh(routeKey: string, pending: PendingRefresh, payload: ConversationSnapshot | null): void {
    // A cancelled/timed-out fetch must not publish late data or retire its replacement.
    if (inFlight.get(routeKey) !== pending) return;
    inFlight.delete(routeKey);
    window.clearTimeout(pending.timeoutId);
    for (const requestId of pending.requestIds) postResult(routeKey, requestId, payload);
  }

  function abortRefresh(routeKey: string, pending: PendingRefresh, notify: boolean): void {
    if (inFlight.get(routeKey) !== pending) return;
    inFlight.delete(routeKey);
    window.clearTimeout(pending.timeoutId);
    pending.controller.abort();
    if (notify) {
      for (const requestId of pending.requestIds) postResult(routeKey, requestId, null);
    }
  }

  function observeHeaders(routeKey: string, headers: HeaderMap): void {
    if (!isConversationId(routeKey) || !Object.keys(headers).length) return;
    headersByRoute.delete(routeKey);
    headersByRoute.set(routeKey, headers);
    if (headersByRoute.size > 8) {
      const oldest = headersByRoute.keys().next().value;
      if (oldest) headersByRoute.delete(oldest);
    }
  }

  async function getJson(url: string, routeKey: string, signal: AbortSignal): Promise<ConversationSnapshot | null> {
    const response = await originalFetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: headersByRoute.get(routeKey),
      signal,
    });
    if (!response.ok || signal.aborted) return null;
    const data = (await response.json()) as ConversationSnapshot;
    return signal.aborted ? null : data;
  }

  async function loadCurrentBranch(routeKey: string, signal: AbortSignal): Promise<ConversationSnapshot | null> {
    // The singular endpoint exposes parent pointers and current_node on
    // installations where ChatGPT still serves the mapping representation.
    // Prefer it for edited-prompt branches.
    try {
      const url = new URL(
        '/backend-api/conversation/' + encodeURIComponent(routeKey),
        location.origin
      );
      const tree = await getJson(url.toString(), routeKey, signal);
      if (signal.aborted) return null;
      if (tree?.mapping) {
        const messages = extractActiveBranchMessages(tree);
        if (messages !== null) {
          return {
            messages,
            current_node: tree.current_node,
            activeBranchVerified: true,
            page_info: { has_previous_page: false },
          };
        }
      }
    } catch {
      // Some ChatGPT deployments expose only the paginated endpoint.
      if (signal.aborted) return null;
    }
    if (signal.aborted) return null;

    // Fall back to the current paginated API. Fetch ALL older pages before
    // publishing a replacement; a partial page must not truncate the TOC.
    const baseUrl = new URL(
      '/backend-api/conversations/' + encodeURIComponent(routeKey),
      location.origin
    );
    baseUrl.searchParams.set('num_turns', '100');
    baseUrl.searchParams.set('include_has_versions', 'true');

    const accumulated = new Map<string, ConversationData['messages'][number]>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let currentNode: string | null | undefined;
    const maxPages = Math.max(1, platform.config.backfillMaxPages + 1);

    try {
      for (let page = 0; page < maxPages; page += 1) {
        if (signal.aborted) return null;
        const url = page === 0
          ? baseUrl
          : new URL(platform.pageHook.buildBackfillUrl(routeKey, cursor!));
        const data = await getJson(url.toString(), routeKey, signal);
        if (signal.aborted || !data || !Array.isArray(data.messages)) return null;
        if (page === 0) currentNode = data.current_node;
        for (const message of data.messages) {
          if (message?.id) accumulated.set(message.id, message);
        }

        if (data.page_info?.has_previous_page === false) {
          const allMessages = Array.from(accumulated.values()).sort(
            (a, b) => (a.create_time ?? a.createTime ?? 0) -
              (b.create_time ?? b.createTime ?? 0)
          );
          const branch = extractActiveBranchMessages({
            messages: allMessages,
            current_node: currentNode,
          });
          if (branch === null) return null;
          return {
            messages: branch,
            current_node: currentNode,
            activeBranchVerified: true,
            page_info: { has_previous_page: false },
          };
        }
        // Missing page metadata cannot prove that the snapshot is complete.
        if (data.page_info?.has_previous_page !== true) return null;
        const nextCursor = data.page_info.start_cursor;
        if (!nextCursor || seenCursors.has(nextCursor)) return null;
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    } catch {
      return null;
    }
    return null;
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: string;
      routeKey?: unknown;
      requestId?: unknown;
    } | null;
    if (data?.type !== TOC_REFRESH_REQUEST && data?.type !== TOC_REFRESH_CANCEL) return;
    if (platform.id !== 'chatgpt' || typeof data.routeKey !== 'string') return;
    if (!isConversationId(data.routeKey) || !Number.isSafeInteger(data.requestId)) return;

    const { routeKey } = data;
    const requestId = data.requestId as number;
    const existing = inFlight.get(routeKey);

    if (data.type === TOC_REFRESH_CANCEL) {
      if (!existing) return;
      existing.requestIds.delete(requestId);
      // Coalesced refreshes have independent waiters: abort only once all cancel.
      if (existing.requestIds.size === 0) abortRefresh(routeKey, existing, false);
      return;
    }
    if (platform.routing.getCurrentRouteKey() !== routeKey) return;

    if (existing) {
      existing.requestIds.add(requestId);
      return;
    }

    const controller = new AbortController();
    const pending: PendingRefresh = {
      controller,
      requestIds: new Set([requestId]),
      timeoutId: 0,
    };
    inFlight.set(routeKey, pending);
    // The page hook independently releases hung requests even when the caller
    // disappears before its cancellation message can be delivered.
    pending.timeoutId = window.setTimeout(
      () => abortRefresh(routeKey, pending, true),
      TOC_REFRESH_TIMEOUT_MS
    );
    void loadCurrentBranch(routeKey, controller.signal).then(
      (payload) => finishRefresh(routeKey, pending, payload),
      () => finishRefresh(routeKey, pending, null)
    );
  });

  return observeHeaders;
}

function isConversationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
