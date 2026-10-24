/** Verifies the authenticated account for lifecycle diagnostics; it does not authorize local deletion. */
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
} from '@/navigation/lifecycle/protocol';

/* DELETE detection intentionally lives in the extension background's webRequest observer.
 * MAIN-world page messages are forgeable and cannot authorize local data deletion.
 */
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
