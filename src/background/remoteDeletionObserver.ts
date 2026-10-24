/**
 * Observes only ChatGPT conversation deletion mutations at Chrome's network
 * boundary. It never modifies requests, stores request bodies, or logs content.
 */
import {
  TOC_TRUSTED_CONVERSATION_DELETED,
  isPermanentConversationId,
} from '@/navigation/lifecycle/protocol';

const ALLOWED_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
const REQUEST_URLS = [
  'https://chatgpt.com/backend-api/conversation/*',
  'https://chatgpt.com/backend-api/conversations/*',
  'https://chat.openai.com/backend-api/conversation/*',
  'https://chat.openai.com/backend-api/conversations/*',
];
const MAX_PENDING_REQUESTS = 256;
const PENDING_TTL_MS = 60_000;
const MAX_PATCH_BODY_BYTES = 64 * 1024;

interface RequestBodyChunk { bytes?: ArrayBuffer }
export interface DeletionRequestDetails {
  requestId: string;
  url: string;
  method: string;
  tabId: number;
  frameId: number;
  type: string;
  initiator?: string;
  documentUrl?: string;
  requestBody?: { raw?: RequestBodyChunk[] };
}
export interface DeletionCompletionDetails {
  requestId: string;
  tabId: number;
  statusCode: number;
}
export interface DeletionFailureDetails { requestId: string }
interface PendingDeletion {
  tabId: number;
  routeKey: string;
  startedAt: number;
}
export interface RemoteDeletionObserver {
  onBeforeRequest(details: DeletionRequestDetails): void;
  onCompleted(details: DeletionCompletionDetails): void;
  onFailed(details: DeletionFailureDetails): void;
  pendingCount(): number;
}

function readPatchBody(details: DeletionRequestDetails): string | null {
  const chunks = details.requestBody?.raw ?? [];
  if (!chunks.length || chunks.some((chunk) => !(chunk.bytes instanceof ArrayBuffer))) return null;
  const byteArrays = chunks.map((chunk) => new Uint8Array(chunk.bytes!));
  const total = byteArrays.reduce((size, bytes) => size + bytes.byteLength, 0);
  if (total === 0 || total > MAX_PATCH_BODY_BYTES) return null;
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const bytes of byteArrays) {
    combined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  try {
    return new TextDecoder().decode(combined);
  } catch {
    return null;
  }
}

/** Extracts a route only from a top-level same-origin ChatGPT network mutation. */
export function detectDeletionTarget(details: DeletionRequestDetails): string | null {
  if (details.tabId < 0 || details.frameId !== 0 || details.type !== 'xmlhttprequest') return null;
  try {
    const url = new URL(details.url);
    if (!ALLOWED_ORIGINS.has(url.origin) || details.initiator !== url.origin) return null;
    if (details.documentUrl && new URL(details.documentUrl).origin !== url.origin) return null;
    const match = url.pathname.match(/^\/backend-api\/conversations?\/([^/]+)\/?$/);
    if (!match) return null;
    const routeKey = decodeURIComponent(match[1]);
    if (!isPermanentConversationId(routeKey)) return null;
    const method = details.method.toUpperCase();
    if (method === 'DELETE') return routeKey;
    if (method !== 'PATCH') return null;
    const bodyText = readPatchBody(details);
    if (!bodyText) return null;
    const body: unknown = JSON.parse(bodyText);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const fields = body as Record<string, unknown>;
    return fields.is_visible === false && fields.is_archived !== true ? routeKey : null;
  } catch {
    return null;
  }
}

export function createRemoteDeletionObserver(
  sendToTab: (tabId: number, routeKey: string) => void,
  now: () => number = Date.now
): RemoteDeletionObserver {
  const pending = new Map<string, PendingDeletion>();

  const prune = (): void => {
    const timestamp = now();
    for (const [requestId, entry] of pending) {
      if (timestamp - entry.startedAt > PENDING_TTL_MS) pending.delete(requestId);
    }
    while (pending.size >= MAX_PENDING_REQUESTS) {
      const oldest = pending.keys().next();
      if (oldest.done) break;
      pending.delete(oldest.value);
    }
  };

  return {
    onBeforeRequest(details): void {
      prune();
      const routeKey = detectDeletionTarget(details);
      if (!routeKey) {
        pending.delete(details.requestId);
        return;
      }
      pending.set(details.requestId, {
        tabId: details.tabId, routeKey, startedAt: now(),
      });
    },
    onCompleted(details): void {
      const entry = pending.get(details.requestId);
      pending.delete(details.requestId);
      if (!entry || entry.tabId !== details.tabId ||
          details.statusCode < 200 || details.statusCode >= 300) return;
      try { sendToTab(entry.tabId, entry.routeKey); } catch {
        // A closed tab or expired content context must not disrupt other listeners.
      }
    },
    onFailed(details): void {
      pending.delete(details.requestId);
    },
    pendingCount(): number { return pending.size; },
  };
}

/** Registers minimal, non-blocking observers for only the two ChatGPT API path forms. */
export function installRemoteDeletionObserver(): void {
  const observer = createRemoteDeletionObserver((tabId, routeKey) => {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: TOC_TRUSTED_CONVERSATION_DELETED,
        routeKey,
      }, () => {
        // Consume lastError when a tab closes or has no active content script.
        void chrome.runtime.lastError;
      });
    } catch {
      // The tab may have closed between request completion and message delivery.
    }
  });
  // Keep the browser API's overloaded event callback types at this boundary;
  // the pure observer consumes only the explicitly declared subset of each event.
  const api = chrome.webRequest as unknown as {
    onBeforeRequest: {
      addListener(
        listener: (details: DeletionRequestDetails) => void,
        filter: { urls: string[]; types: string[] },
        extraInfoSpec?: string[]
      ): void;
    };
    onCompleted: {
      addListener(
        listener: (details: DeletionCompletionDetails) => void,
        filter: { urls: string[]; types: string[] }
      ): void;
    };
    onErrorOccurred: {
      addListener(
        listener: (details: DeletionFailureDetails) => void,
        filter: { urls: string[]; types: string[] }
      ): void;
    };
    onBeforeRedirect: {
      addListener(
        listener: (details: DeletionFailureDetails) => void,
        filter: { urls: string[]; types: string[] }
      ): void;
    };
  };
  const filter = { urls: REQUEST_URLS, types: ['xmlhttprequest'] };
  api.onBeforeRequest.addListener(observer.onBeforeRequest, filter, ['requestBody']);
  api.onCompleted.addListener(observer.onCompleted, filter);
  api.onErrorOccurred.addListener(observer.onFailed, filter);
  api.onBeforeRedirect.addListener(observer.onFailed, filter);
}
