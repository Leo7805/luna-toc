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
 * Installs startup account validation. HTTP 404/410 cannot prove deletion:
 * unsupported endpoints and access restrictions may appear indistinguishable.
 */
export function installConversationLifecycle(originalFetch: typeof fetch): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: unknown;
      requestId?: unknown;
    } | null;
    if (data?.type !== TOC_LIFECYCLE_CHECK_REQUEST ||
        !Number.isSafeInteger(data.requestId)) return;

    const requestId = data.requestId as number;
    // Verify identity only; ambiguous GET results never destroy local content.
    void validateConversations(originalFetch).then((result) => {
      window.postMessage({
        type: TOC_LIFECYCLE_CHECK_RESULT,
        requestId,
        ...result,
      }, location.origin);
    });
  });
}

/** Reads the authenticated session; no uncertain 404 can erase a saved alias. */
async function validateConversations(
  originalFetch: typeof fetch
): Promise<{ ownerId: string | null }> {
  let ownerId: string | null = null;
  try {
    const sessionResponse = await originalFetch(
      new URL('/api/auth/session', location.origin).toString(),
      { method: 'GET', credentials: 'include' }
    );
    if (!sessionResponse.ok) return { ownerId: null };
    const session: unknown = await sessionResponse.json();
    if (!session || typeof session !== 'object') return { ownerId: null };
    const user = (session as { user?: { id?: unknown } }).user;
    if (typeof user?.id !== 'string' || !user.id) return { ownerId: null };
    ownerId = user.id;
  } catch {
    return { ownerId: null };
  }

  // Only an observed successful ChatGPT deletion mutation is conclusive.
  return { ownerId };
}
