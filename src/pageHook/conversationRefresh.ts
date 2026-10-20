/**
 * On-demand, same-origin conversation snapshots. The page hook owns the
 * authenticated request; headers and session credentials never cross the
 * MAIN/ISOLATED messaging boundary.
 */
import type { Platform } from '@/platforms';
import type { ConversationData } from '@/features/conversationPrompts/message';
import { extractActiveBranchMessages, type ConversationSnapshot } from '@/navigation/state/activeBranch';
import { TOC_REFRESH_REQUEST, TOC_REFRESH_RESULT } from '@/navigation/refresh/refreshProtocol';

type HeaderMap = Record<string, string>;

export function installConversationRefresh(
  originalFetch: typeof fetch,
  platform: Platform
): (routeKey: string, headers: HeaderMap) => void {
  const headersByRoute = new Map<string, HeaderMap>();
  const inFlight = new Map<string, Promise<ConversationData | null>>();

  function observeHeaders(routeKey: string, headers: HeaderMap): void {
    if (!isConversationId(routeKey) || !Object.keys(headers).length) return;
    headersByRoute.delete(routeKey);
    headersByRoute.set(routeKey, headers);
    if (headersByRoute.size > 8) {
      const oldest = headersByRoute.keys().next().value;
      if (oldest) headersByRoute.delete(oldest);
    }
  }

  async function getJson(url: string, routeKey: string): Promise<ConversationSnapshot | null> {
    const response = await originalFetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: headersByRoute.get(routeKey),
    });
    if (!response.ok) return null;
    return (await response.json()) as ConversationSnapshot;
  }

  async function loadCurrentBranch(routeKey: string): Promise<ConversationData | null> {
    // The singular endpoint exposes parent pointers and current_node on
    // installations where ChatGPT still serves the mapping representation.
    // Prefer it for edited-prompt branches.
    try {
      const url = new URL(
        '/backend-api/conversation/' + encodeURIComponent(routeKey),
        location.origin
      );
      const tree = await getJson(url.toString(), routeKey);
      if (tree?.mapping) {
        const messages = extractActiveBranchMessages(tree);
        if (messages !== null) {
          return {
            messages,
            current_node: tree.current_node,
            page_info: { has_previous_page: false },
          };
        }
      }
    } catch {
      // Some ChatGPT deployments expose only the paginated endpoint.
    }

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
        const url = page === 0
          ? baseUrl
          : new URL(platform.pageHook.buildBackfillUrl(routeKey, cursor!));
        const data = await getJson(url.toString(), routeKey);
        if (!data || !Array.isArray(data.messages)) return null;
        if (page === 0) currentNode = data.current_node;
        for (const message of data.messages) {
          if (message?.id) accumulated.set(message.id, message);
        }

        if (data.page_info?.has_previous_page !== true) {
          const allMessages = Array.from(accumulated.values());
          const branch = extractActiveBranchMessages({
            messages: allMessages,
            current_node: currentNode,
          });
          if (branch === null) return null;
          return {
            messages: branch,
            current_node: currentNode,
            page_info: { has_previous_page: false },
          };
        }
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
    if (data?.type !== TOC_REFRESH_REQUEST) return;
    if (platform.id !== 'chatgpt' || typeof data.routeKey !== 'string') return;
    if (!isConversationId(data.routeKey) || !Number.isSafeInteger(data.requestId)) return;

    const { routeKey } = data;
    const requestId = data.requestId as number;
    if (platform.routing.getCurrentRouteKey() !== routeKey) return;

    let pending = inFlight.get(routeKey);
    if (!pending) {
      pending = loadCurrentBranch(routeKey).finally(() => {
        inFlight.delete(routeKey);
      });
      inFlight.set(routeKey, pending);
    }
    void pending.then((payload) => {
      window.postMessage(
        {
          type: TOC_REFRESH_RESULT,
          routeKey,
          requestId,
          payload,
        },
        location.origin
      );
    }).catch(() => {
      window.postMessage({
        type: TOC_REFRESH_RESULT,
        routeKey,
        requestId,
        payload: null,
      }, location.origin);
    });
  });

  return observeHeaders;
}

function isConversationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
