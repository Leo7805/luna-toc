/**
 * Shared fetch-arg utilities used by the entry's `window.fetch` override and
 * by the conversation-backfill module. Lives in its own file so neither
 * module has to drag in the other's state.
 */
type FetchArgs = Parameters<typeof window.fetch>;

interface RequestMeta {
  isConversationGet: boolean;
  isInitialConversationLoad: boolean;
  isSendMessage: boolean;
  routeKey: string;
}

interface ConversationPageInfo {
  start_cursor?: string;
  end_cursor?: string;
  has_previous_page?: boolean;
  has_next_page?: boolean;
}

interface ConversationPayload {
  page_info?: ConversationPageInfo;
}

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

/**
 * Resolves the effective fetch method from Request and init arguments.
 */
function getFetchMethod(input: RequestInfo | URL, init: RequestInit): string {
  return (
    init.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
}

/**
 * Returns the ChatGPT route key at the time a request is intercepted.
 */
function getCurrentConversationKey(): string {
  const match = location.pathname.match(/\/c\/([^/]+)/);

  return match?.[1] || `new-chat:${location.pathname}`;
}

/**
 * Collects request headers so backfill requests can replay ChatGPT's
 * authentication. Forbidden (browser-controlled) headers are skipped because
 * they cannot be set on a fetch and would otherwise be dropped.
 */
function getRequestHeaders(
  input: RequestInfo | URL,
  init?: RequestInit
): Record<string, string> {
  const rawHeaders: Record<string, string> = {};

  if (input instanceof Request) {
    collectHeaderEntries(rawHeaders, input.headers);
  }

  if (init?.headers) {
    collectHeaderEntries(rawHeaders, init.headers);
  }

  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(rawHeaders)) {
    const normalizedName = name.toLowerCase();

    if (FORBIDDEN_REQUEST_HEADERS.has(normalizedName)) continue;
    if (normalizedName.startsWith('proxy-')) continue;
    if (normalizedName.startsWith('sec-')) continue;

    headers[normalizedName] = value;
  }

  return headers;
}

/**
 * Merges a HeadersInit into a lowercase-keyed header map.
 */
function collectHeaderEntries(
  target: Record<string, string>,
  source: HeadersInit
): void {
  if (source instanceof Headers) {
    source.forEach((value, name) => {
      target[name.toLowerCase()] = value;
    });
    return;
  }

  if (Array.isArray(source)) {
    for (const [name, value] of source) {
      target[name.toLowerCase()] = value;
    }
    return;
  }

  for (const [name, value] of Object.entries(source)) {
    target[name.toLowerCase()] = value;
  }
}

export {
  collectHeaderEntries,
  getCurrentConversationKey,
  getFetchMethod,
  getRequestHeaders,
};

export type {
  ConversationPageInfo,
  ConversationPayload,
  FetchArgs,
  RequestMeta,
};