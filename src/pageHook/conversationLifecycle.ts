/**
 * Verifies saved conversation references once on page startup and announces
 * successful ChatGPT deletion mutations. Failed/unauthorized reads never delete.
 */
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
  TOC_CONVERSATION_DELETED,
  isPermanentConversationId,
} from '@/navigation/lifecycle/protocol';

type FetchArgs = Parameters<typeof fetch>;

/**
 * Inspects an outgoing ChatGPT mutation without consuming its request body.
 * A PATCH to archive a chat is not a deletion.
 */
export async function getDeletionTarget(args: FetchArgs): Promise<string | null> {
  try {
    const [input, init] = args;
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/backend-api\/conversations?\/([^/]+)\/?$/);
    if (!match) return null;
    const routeKey = decodeURIComponent(match[1]);
    if (!isPermanentConversationId(routeKey)) return null;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'DELETE') return routeKey;
    if (method !== 'PATCH') return null;

    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof body !== 'string') return null;
    const update: unknown = JSON.parse(body);
    if (!update || typeof update !== 'object') return null;
    const fields = update as Record<string, unknown>;
    return fields.is_visible === false && fields.is_archived !== true ? routeKey : null;
  } catch {
    return null;
  }
}

/** Publishes deletion only after ChatGPT confirms a successful mutation. */
export function publishConfirmedDeletion(
  response: Response,
  pendingTarget: Promise<string | null>
): void {
  if (!response.ok) return;
  void pendingTarget.then((routeKey) => {
    if (!routeKey) return;
    window.postMessage({ type: TOC_CONVERSATION_DELETED, routeKey }, location.origin);
  }).catch(() => undefined);
}

/**
 * Installs a startup-only validator. A 404/410 is actionable only when the
 * content script can prove the mark was recorded for the same signed-in user.
 */
export function installConversationLifecycle(originalFetch: typeof fetch): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: unknown;
      requestId?: unknown;
      conversationIds?: unknown;
    } | null;
    if (data?.type !== TOC_LIFECYCLE_CHECK_REQUEST ||
        !Number.isSafeInteger(data.requestId) ||
        !Array.isArray(data.conversationIds)) return;

    const requestId = data.requestId as number;
    const conversationIds = [...new Set(
      data.conversationIds.filter(isPermanentConversationId)
    )];
    void validateConversations(originalFetch, conversationIds).then((result) => {
      window.postMessage({
        type: TOC_LIFECYCLE_CHECK_RESULT,
        requestId,
        ...result,
      }, location.origin);
    });
  });
}

/** Uses only the authenticated session and direct per-ID checks, never a partial recent-chat list. */
async function validateConversations(
  originalFetch: typeof fetch,
  conversationIds: string[]
): Promise<{ ownerId: string | null; missingIds: string[] }> {
  let ownerId: string | null = null;
  try {
    const sessionResponse = await originalFetch(
      new URL('/api/auth/session', location.origin).toString(),
      { method: 'GET', credentials: 'include' }
    );
    if (!sessionResponse.ok) return { ownerId: null, missingIds: [] };
    const session: unknown = await sessionResponse.json();
    if (!session || typeof session !== 'object') return { ownerId: null, missingIds: [] };
    const user = (session as { user?: { id?: unknown } }).user;
    if (typeof user?.id !== 'string' || !user.id) return { ownerId: null, missingIds: [] };
    ownerId = user.id;
  } catch {
    return { ownerId: null, missingIds: [] };
  }

  const missingIds: string[] = [];
  // Limit concurrent requests so opening ChatGPT cannot flood its API.
  for (let offset = 0; offset < conversationIds.length; offset += 4) {
    const batch = conversationIds.slice(offset, offset + 4);
    await Promise.all(batch.map(async (routeKey) => {
      try {
        const response = await originalFetch(
          new URL('/backend-api/conversation/' + encodeURIComponent(routeKey), location.origin).toString(),
          { method: 'GET', credentials: 'include' }
        );
        if (response.status === 404 || response.status === 410) missingIds.push(routeKey);
      } catch {
        // Offline, throttling and API failures are inconclusive.
      }
    }));
  }
  return { ownerId, missingIds };
}
