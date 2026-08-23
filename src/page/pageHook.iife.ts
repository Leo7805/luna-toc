/**
 * Injected page-context hook. It captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts, and spoofs width media queries while
 * the ChatTOC sidebar is visible.
 */
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from '@/platforms/chatgpt/conversationRequest';
import { APP_CONFIG } from '@/config/config';

(() => {
  type FetchArgs = Parameters<typeof window.fetch>;
  type MediaQueryListener = EventListenerOrEventListenerObject;
  type MediaQueryListenerMethod = keyof typeof MEDIA_QUERY_LISTENER_METHODS;

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

  interface OutgoingMessage {
    id: string;
    author?: { role?: string };
    content?: unknown;
    metadata?: unknown;
    create_time?: number;
  }

  interface OutgoingRequestBody {
    messages?: OutgoingMessage[];
  }

  interface SpoofedMediaQueryEntry {
    query: string;
    listeners: Set<MediaQueryListener>;
    mediaQueryList: MediaQueryList | null;
    onchange: MediaQueryListener | null;
    tracked: boolean;
  }

  const HOOK_FLAG = '__conversationNavigatorFetchHookInstalled';
  const MESSAGE_TYPE = 'CHATGPT_CONVERSATION_DATA';
  const WIDTH_SPOOF_MESSAGE_TYPE = 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF';
  const SEND_MESSAGE_PATH = '/backend-api/f/conversation';
  const SPOOFED_VIEWPORT_WIDTH = 1400;
  const MEDIA_QUERY_LISTENER_METHODS = {
    addEventListener: { track: true, modern: true },
    removeEventListener: { track: false, modern: true },
    addListener: { track: true, modern: false },
    removeListener: { track: false, modern: false },
  };

  const BACKFILL_MAX_PAGES = APP_CONFIG.platforms.chatgpt.backfillMaxPages;
  // One page can carry the whole history for typical conversations: the
  // server does not cap `num_turns` at least up to 100, and the payload is
  // bounded by message count (user + assistant), not prompt count.
  const BACKFILL_NUM_TURNS = 100;
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
  let streamBuffer = '';
  let wideViewportSpoofEnabled = true;
  const spoofedMediaQueryLists = new Set<SpoofedMediaQueryEntry>();
  const backfillingConversationIds = new Set<string>();
  const hookWindow = window as unknown as Window & Record<string, unknown>;

  if (hookWindow[HOOK_FLAG]) {
    return;
  }

  hookWindow[HOOK_FLAG] = true;

  installWideViewportMatchMediaSpoof();
  listenForWidthSpoofToggle();
  installHistoryHook();

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const requestMeta = getRequestMeta(args);

    try {
      if (requestMeta?.isSendMessage) {
        extractOutgoingMessage(args, requestMeta.routeKey);
      }
    } catch {}

    const fetchArgs = maybeBumpChatGptPaginationNumTurns(args);
    const response = await originalFetch(...fetchArgs);

    try {
      if (requestMeta?.isConversationGet) {
        const authHeaders = requestMeta.isInitialConversationLoad
          ? getRequestHeaders(args[0], args[1])
          : null;

        postConversationData(
          response,
          requestMeta.routeKey,
          requestMeta.isInitialConversationLoad,
          authHeaders
        );
      }

      if (requestMeta?.isSendMessage) {
        streamBuffer = '';
        inspectStream(response, requestMeta.routeKey).catch(() => {});
      }
    } catch {}

    return response;
  };

  /**
   * Attempts to parse the outgoing POST request body to immediately capture
   * the user's prompt before the server responds.
   */
  function extractOutgoingMessage(args: FetchArgs, routeKey: string): void {
    try {
      const init = args[1] || {};
      if (typeof init.body === 'string') {
        const data = JSON.parse(init.body) as OutgoingRequestBody;
        const messages = data.messages || [];
        const userMessage = messages.find((m) => m.author?.role === 'user');

        if (userMessage) {
          window.postMessage(
            {
              type: 'CHATGPT_NEW_USER_MESSAGE',
              routeKey,
              payload: {
                id: userMessage.id,
                content: userMessage.content,
                metadata: userMessage.metadata,
                createTime: userMessage.create_time || Date.now(),
              },
            },
            '*'
          );
        }
      }
    } catch {}
  }

  /**
   * Captures request metadata before the page fetch resolves so routeKey belongs
   * to the route that initiated the request.
   * @param {unknown[]} args Original fetch arguments.
   * @returns {{ isConversationGet: boolean, isSendMessage: boolean, routeKey: string } | null}
   */
  function getRequestMeta(args: FetchArgs): RequestMeta | null {
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = getFetchUrl(input);

      if (!url) {
        return null;
      }

      const method = getFetchMethod(input, init);
      const pathname = new URL(url, window.location.origin).pathname;
      const conversationId = getConversationIdFromApiPath(pathname);
      const messagesConversationId =
        getConversationMessagesIdFromApiPath(pathname);
      const effectiveConversationId = conversationId ?? messagesConversationId;
      const isConversationGet =
        method === 'GET' && effectiveConversationId !== null;

      return {
        isConversationGet,
        isInitialConversationLoad: conversationId !== null,
        isSendMessage: method === 'POST' && pathname === SEND_MESSAGE_PATH,
        routeKey: isConversationGet
          ? effectiveConversationId
          : getCurrentConversationKey(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Rewrites ChatGPT's own older-page pagination requests
   * (`/backend-api/conversations/{id}/messages?before=...`) to carry a larger
   * `num_turns` so its renderer fills the message store in a single fetch
   * instead of several small ones. The renderer's virtual window then slides
   * over pre-loaded data on subsequent scrolls, which dramatically speeds up
   * far-jump navigation. Our own backfill calls `originalFetch` directly, so
   * it bypasses this rewrite.
   * @param {FetchArgs} args
   * @returns {FetchArgs}
   */
  function maybeBumpChatGptPaginationNumTurns(args: FetchArgs): FetchArgs {
    const target =
      APP_CONFIG.platforms.chatgpt.interceptChatGptPaginationNumTurns;
    if (typeof target !== 'number') return args;

    const input = args[0];
    const init = args[1];

    try {
      const urlString = getFetchUrl(input);
      const url = new URL(urlString, window.location.origin);

      if (getConversationMessagesIdFromApiPath(url.pathname) === null) {
        return args;
      }
      if (!url.searchParams.has('before')) return args;

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
   * Normalizes fetch input into a URL string so Request objects and string
   * URLs are handled the same way.
   * @param {RequestInfo | URL} input
   * @returns {string}
   */
  function getFetchUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
      return input;
    }

    if (input instanceof Request) {
      return input.url;
    }

    return input instanceof URL ? input.toString() : '';
  }

  /**
   * Resolves the effective fetch method from Request and init arguments.
   * @param {RequestInfo | URL} input
   * @param {RequestInit} init
   * @returns {string}
   */
  function getFetchMethod(input: RequestInfo | URL, init: RequestInit): string {
    return (
      init.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
  }

  /**
   * Collects request headers so backfill requests can replay ChatGPT's
   * authentication. Forbidden (browser-controlled) headers are skipped because
   * they cannot be set on a fetch and would otherwise be dropped.
   * @param {RequestInfo | URL} input
   * @param {RequestInit} [init]
   * @returns {Record<string, string>}
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
   * @param {Record<string, string>} target
   * @param {HeadersInit} source
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

  /**
   * Returns the ChatGPT route key at the time a request is intercepted.
   * @returns {string}
   */
  function getCurrentConversationKey(): string {
    const match = location.pathname.match(/\/c\/([^/]+)/);

    return match?.[1] || `new-chat:${location.pathname}`;
  }

  /**
   * Spoofs JS media-query width checks so ChatGPT keeps its built-in prompt
   * navigator mounted in narrow split-view layouts.
   */
  function installWideViewportMatchMediaSpoof(): void {
    const originalMatchMedia = window.matchMedia?.bind(window);

    if (!originalMatchMedia) return;

    // ChatGPT decides whether to mount its built-in prompt navigator from
    // page-context responsive checks. Content scripts run in an isolated world,
    // so the spoof has to live in this injected page script.
    window.matchMedia = function (query) {
      const mediaQueryList = originalMatchMedia(query);

      if (!isWidthMediaQuery(query)) {
        return mediaQueryList;
      }

      return createSpoofedMediaQueryList(mediaQueryList, query);
    };
  }

  /**
   * Lets the content script enable spoofing only while the ChatTOC sidebar is
   * visible. Dispatching resize nudges ChatGPT to rerun responsive layout code.
   */
  function listenForWidthSpoofToggle(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== WIDTH_SPOOF_MESSAGE_TYPE) return;

      wideViewportSpoofEnabled = Boolean(event.data.enabled);
      notifySpoofedMediaQueryListeners();
      window.dispatchEvent(new Event('resize'));
    });
  }

  /**
   * Returns whether a media query contains width breakpoints that can be spoofed.
   * @param {string} query
   * @returns {boolean}
   */
  function isWidthMediaQuery(query: string): boolean {
    return getWidthMediaQueryRules(query).length > 0;
  }

  /**
   * Extracts min-width and max-width rules from a JS media query.
   * @param {string} query
   * @returns {RegExpMatchArray[]}
   */
  function getWidthMediaQueryRules(query: string): RegExpMatchArray[] {
    return Array.from(
      String(query)
        .toLowerCase()
        .matchAll(/\((min|max)-width\s*:\s*([\d.]+)(px|rem|em)\)/g)
    );
  }

  /**
   * Returns the spoofed match result for JS width media queries.
   * @param {string} query
   * @returns {boolean | null} A forced match value, or null to keep the real result.
   */
  function getSpoofedMediaQueryMatch(query: string): boolean | null {
    if (!wideViewportSpoofEnabled) {
      return null;
    }

    const widthRules = getWidthMediaQueryRules(query);

    if (widthRules.length === 0) {
      return null;
    }

    return widthRules.every((match) => {
      const boundary = match[1];
      const value = Number(match[2]);
      const unit = match[3];
      const width = unit === 'px' ? value : value * 16;

      return boundary === 'min'
        ? SPOOFED_VIEWPORT_WIDTH >= width
        : SPOOFED_VIEWPORT_WIDTH <= width;
    });
  }

  /**
   * Creates a MediaQueryList proxy for spoofed JS media queries. We track
   * change listeners because toggling the spoof does not trigger native
   * MediaQueryList events by itself.
   * @param {MediaQueryList} mediaQueryList
   * @param {string} query
   * @returns {MediaQueryList}
   */
  function createSpoofedMediaQueryList(
    mediaQueryList: MediaQueryList,
    query: string
  ): MediaQueryList {
    const entry: SpoofedMediaQueryEntry = {
      query,
      listeners: new Set(),
      mediaQueryList: null,
      onchange: null,
      tracked: false,
    };

    const proxy = new Proxy(mediaQueryList, {
      get(target, property) {
        if (property === 'matches') {
          const forcedMatch = getSpoofedMediaQueryMatch(query);

          return forcedMatch ?? target.matches;
        }

        if (property === 'onchange') {
          return entry.onchange ?? target.onchange;
        }

        if (isMediaQueryListenerMethod(property) && property in target) {
          return wrapMediaQueryListenerMethod(target, entry, property);
        }

        return getBoundNativeValue(target, property);
      },
      set(target, property, value: unknown) {
        if (property === 'onchange') {
          entry.onchange = isMediaQueryListener(value) ? value : null;
          syncTrackedMediaQueryEntry(entry);
          target.onchange = value as MediaQueryList['onchange'];
          return true;
        }

        return Reflect.set(target, property, value);
      },
    });

    entry.mediaQueryList = proxy;

    return proxy;
  }

  /**
   * Wraps MediaQueryList listener methods so we can track which callbacks need
   * synthetic change events when the spoof is toggled.
   * @param {MediaQueryList} target
   * @param {Object} entry
   * @param {'addEventListener' | 'removeEventListener' | 'addListener' | 'removeListener'} method
   * @returns {Function}
   */
  function wrapMediaQueryListenerMethod(
    target: MediaQueryList,
    entry: SpoofedMediaQueryEntry,
    method: MediaQueryListenerMethod
  ): (...args: unknown[]) => unknown {
    const config = MEDIA_QUERY_LISTENER_METHODS[method];

    return function (...args: unknown[]): unknown {
      const listener = config.modern ? args[1] : args[0];

      if (!config.modern || args[0] === 'change') {
        setTrackedMediaQueryListener(entry, listener, config.track);
      }

      if (config.modern) {
        const type = String(args[0]);
        const modernListener =
          args[1] as EventListenerOrEventListenerObject | null;
        const options = args[2] as
          | boolean
          | AddEventListenerOptions
          | undefined;
        if (!modernListener) return undefined;
        if (method === 'addEventListener') {
          return target.addEventListener(type, modernListener, options);
        }
        return target.removeEventListener(type, modernListener, options);
      }

      const legacyListener = args[0] as
        | ((event: MediaQueryListEvent) => void)
        | null;
      if (method === 'addListener') return target.addListener(legacyListener);
      return target.removeListener(legacyListener);
    };
  }

  /**
   * Adds or removes one listener from the proxy entry's tracked listener set.
   * @param {Object} entry
   * @param {Function | EventListenerObject | null | undefined} listener
   * @param {boolean} shouldTrack
   */
  function setTrackedMediaQueryListener(
    entry: SpoofedMediaQueryEntry,
    listener: unknown,
    shouldTrack: boolean
  ): void {
    if (!isMediaQueryListener(listener)) return;

    if (shouldTrack) {
      entry.listeners.add(listener);
      syncTrackedMediaQueryEntry(entry);
      return;
    }

    entry.listeners.delete(listener);
    syncTrackedMediaQueryEntry(entry);
  }

  /**
   * Keeps the global spoofedMediaQueryLists set limited to proxies that have at
   * least one listener or onchange handler.
   * @param {Object} entry
   */
  function syncTrackedMediaQueryEntry(entry: SpoofedMediaQueryEntry): void {
    const shouldTrack = entry.listeners.size > 0 || Boolean(entry.onchange);

    if (shouldTrack && !entry.tracked) {
      spoofedMediaQueryLists.add(entry);
      entry.tracked = true;
      return;
    }

    if (!shouldTrack && entry.tracked) {
      spoofedMediaQueryLists.delete(entry);
      entry.tracked = false;
    }
  }

  /**
   * Returns native MediaQueryList properties while binding methods back to the
   * original object to preserve browser API behavior through the Proxy.
   * @param {MediaQueryList} target
   * @param {string | symbol} property
   * @returns {*}
   */
  function getBoundNativeValue(
    target: MediaQueryList,
    property: string | symbol
  ): unknown {
    const value = Reflect.get(target, property) as unknown;

    return typeof value === 'function' ? value.bind(target) : value;
  }

  /**
   * Notifies responsive hooks that the spoofed width result changed.
   */
  function notifySpoofedMediaQueryListeners(): void {
    spoofedMediaQueryLists.forEach((entry) => {
      const mediaQueryList = entry.mediaQueryList;
      if (!mediaQueryList) return;

      const event = createMediaQueryChangeEvent(mediaQueryList);
      const listeners = new Set(entry.listeners);

      if (entry.onchange) {
        listeners.add(entry.onchange);
      }

      listeners.forEach((listener) => {
        try {
          callMediaQueryListener(listener, mediaQueryList, event);
        } catch {}
      });
    });
  }

  function isMediaQueryListenerMethod(
    property: string | symbol
  ): property is MediaQueryListenerMethod {
    return (
      typeof property === 'string' && property in MEDIA_QUERY_LISTENER_METHODS
    );
  }

  /**
   * Creates a MediaQueryList change event for spoof toggles. Prefer a real
   * Event so code that checks Event APIs still works; fall back to a plain
   * object if the browser refuses to define read-only event fields.
   * @param {MediaQueryList} mediaQueryList
   * @returns {Event | Object}
   */
  function createMediaQueryChangeEvent(mediaQueryList: MediaQueryList): Event {
    const event = new Event('change');
    const eventProperties = {
      media: {
        value: mediaQueryList.media,
      },
      matches: {
        value: mediaQueryList.matches,
      },
      target: {
        value: mediaQueryList,
      },
      currentTarget: {
        value: mediaQueryList,
      },
    };

    try {
      Object.defineProperties(event, eventProperties);
      return event;
    } catch {
      return {
        media: mediaQueryList.media,
        matches: mediaQueryList.matches,
        target: mediaQueryList,
        currentTarget: mediaQueryList,
      } as unknown as Event;
    }
  }

  /**
   * Checks whether a value is a valid MediaQueryList listener.
   * @param {*} listener
   * @returns {boolean}
   */
  function isMediaQueryListener(
    listener: unknown
  ): listener is MediaQueryListener {
    return (
      typeof listener === 'function' ||
      (typeof listener === 'object' &&
        listener !== null &&
        'handleEvent' in listener &&
        typeof listener.handleEvent === 'function')
    );
  }

  /**
   * Calls either function listeners or EventListenerObject listeners with the
   * synthetic MediaQueryList change event.
   * @param {Function | EventListenerObject} listener
   * @param {MediaQueryList} mediaQueryList
   * @param {Object} event
   */
  function callMediaQueryListener(
    listener: MediaQueryListener,
    mediaQueryList: MediaQueryList,
    event: Event
  ): void {
    if (typeof listener === 'function') {
      listener.call(mediaQueryList, event);
      return;
    }

    listener.handleEvent(event);
  }

  /**
   * Clones ChatGPT's conversation GET response and sends the parsed payload to
   * the content script without consuming the page's original response body.
   * @param {Response} response
   * @param {string} routeKey Route key captured when the request was made.
   */
  function postConversationData(
    response: Response,
    routeKey: string,
    isInitialConversationLoad: boolean,
    authHeaders: Record<string, string> | null
  ): void {
    response
      .clone()
      .json()
      .then((data) => {
        postConversationPayload(data, routeKey);

        if (isInitialConversationLoad) {
          startBackfillIfNeeded(data, routeKey, authHeaders);
        }
      })
      .catch(() => {});
  }

  /**
   * Forwards one parsed conversation payload to the content script.
   * @param {unknown} payload
   * @param {string} routeKey
   */
  function postConversationPayload(payload: unknown, routeKey: string): void {
    window.postMessage(
      {
        type: MESSAGE_TYPE,
        routeKey,
        payload,
      },
      '*'
    );
  }

  /**
   * Starts a bounded backfill of older conversation pages when the initial
   * response indicates there is earlier history to load.
   * @param {unknown} data Parsed initial conversation payload.
   * @param {string} routeKey Conversation ID captured when the request was made.
   */
  function startBackfillIfNeeded(
    data: unknown,
    routeKey: string,
    authHeaders: Record<string, string> | null
  ): void {
    const pageInfo = (data as ConversationPayload | undefined)?.page_info;

    if (!pageInfo?.has_previous_page || !pageInfo?.start_cursor) return;
    if (!routeKey || backfillingConversationIds.has(routeKey)) return;

    backfillingConversationIds.add(routeKey);
    void backfillPreviousPages(
      routeKey,
      pageInfo.start_cursor,
      authHeaders
    ).finally(() => {
      backfillingConversationIds.delete(routeKey);
    });
  }

  /**
   * Fetches earlier pages by cursor until the beginning of the conversation or
   * the page cap is reached. Any failure stops the chain silently so the
   * navigator falls back to accumulating whatever pages ChatGPT loads itself.
   * @param {string} conversationId
   * @param {string} startCursor Cursor of the next older page to fetch.
   * @returns {Promise<void>}
   */
  async function backfillPreviousPages(
    conversationId: string,
    startCursor: string,
    authHeaders: Record<string, string> | null
  ): Promise<void> {
    let cursor = startCursor;

    for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
      if (!cursor) return;

      let data: ConversationPayload;

      try {
        const response = await originalFetch(
          buildBackfillUrl(conversationId, cursor),
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

      postConversationPayload(data, conversationId);

      const pageInfo = data?.page_info;
      if (!pageInfo?.has_previous_page || !pageInfo?.start_cursor) return;

      cursor = pageInfo.start_cursor;
    }
  }

  /**
   * Builds the paginated messages URL for one older conversation page.
   * @param {string} conversationId
   * @param {string} beforeCursor
   * @returns {string}
   */
  function buildBackfillUrl(
    conversationId: string,
    beforeCursor: string
  ): string {
    const url = new URL(
      `/backend-api/conversations/${conversationId}/messages`,
      window.location.origin
    );

    url.searchParams.set('before', beforeCursor);
    url.searchParams.set('include_has_versions', 'true');
    url.searchParams.set('num_turns', String(BACKFILL_NUM_TURNS));

    return url.toString();
  }

  /**
   * Reads a cloned send-message SSE stream so newly submitted user prompts can
   * appear in the navigator before the next full conversation fetch completes.
   * @param {Response} response
   * @param {string} routeKey Route key captured when the request was made.
   * @returns {Promise<void>}
   */
  async function inspectStream(
    response: Response,
    routeKey: string
  ): Promise<void> {
    const reader = response.clone().body?.getReader();

    if (!reader) return;

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (streamBuffer.trim()) {
          processStreamLine(streamBuffer, routeKey);
          streamBuffer = '';
        }

        break;
      }

      streamBuffer += decoder.decode(value, {
        stream: true,
      });

      processBufferedStream(routeKey);
    }
  }

  /**
   * Splits the accumulated SSE buffer into complete lines while keeping the
   * trailing partial line for the next stream chunk.
   */
  function processBufferedStream(routeKey: string): void {
    const lines = streamBuffer.split('\n');

    // The last line may be incomplete.
    streamBuffer = lines.pop() || '';

    for (const line of lines) {
      processStreamLine(line, routeKey);
    }
  }

  /**
   * Parses one SSE data line and forwards ChatGPT input_message events to the
   * content script.
   * @param {string} line
   * @param {string} routeKey Route key captured when the request was made.
   */
  function processStreamLine(line: string, routeKey: string): void {
    if (!line.startsWith('data: ')) {
      return;
    }

    const jsonText = line.slice(6).trim();

    if (!jsonText || jsonText === '[DONE]') {
      return;
    }

    try {
      const data = JSON.parse(jsonText);

      if (data.type === 'input_message') {
        const message = data.input_message;

        window.postMessage(
          {
            type: 'CHATGPT_NEW_USER_MESSAGE',
            routeKey,
            payload: {
              id: message.id,
              content: message.content,
              metadata: message.metadata,
              createTime: message.create_time || Date.now(),
            },
          },
          '*'
        );
      }
    } catch {}
  }

  /**
   * Intercepts HTML5 History pushState and replaceState calls to notify the
   * content script of SPA routing changes immediately.
   */
  function installHistoryHook(): void {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    if (typeof originalPushState === 'function') {
      window.history.pushState = function (...args) {
        originalPushState.apply(this, args);
        notifyRouteChanged();
      };
    }

    if (typeof originalReplaceState === 'function') {
      window.history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        notifyRouteChanged();
      };
    }
  }

  /**
   * Sends a message to the content script indicating that navigation occurred.
   */
  function notifyRouteChanged(): void {
    window.postMessage(
      {
        type: 'CHATGPT_ROUTE_CHANGED',
      },
      '*'
    );
  }
})();
