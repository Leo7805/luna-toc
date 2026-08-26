/**
 * Injected page-context hook. It captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts, and spoofs width media queries while
 * the ChatTOC sidebar is visible.
 */
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from '@/platforms/chatgpt/conversationRequest';
import {
  maybeBumpChatGptFetchNumTurns,
  getFetchUrl,
} from '@/platforms/chatgpt/chatGptFetchBumper';
import {
  APP_CONFIG,
  getActiveContractValue,
  type ChatGptContractId,
} from '@/config/config';
import { PAGE_HOOK_MISMATCH_MESSAGE_TYPE, CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE } from '@/features/contractAlert/pageHookBridge';

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
  const CONVERSATION_ENDED_MESSAGE_TYPE = 'CHATGPT_CONVERSATION_ENDED';
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
  const contractMismatchCounters = new Map<ChatGptContractId, number>();
  /**
   * Effective contract values pushed from the content script. When a value
   * is present it overrides the hard-coded fallback used by the page-hook
   * detection. Populated on startup and on every `chrome.storage` change.
   */
  const effectiveContractValues: Partial<Record<ChatGptContractId, string>> = {};
  /**
   * Minimum number of times a given contract mismatch must be observed in a
   * session before it is forwarded to the content-script detector. One-off
   * path variations are filtered out; consistent mismatches reach the
   * developer-facing alert.
   */
  const CONTRACT_MISMATCH_REPORT_THRESHOLD = 2;
  const hookWindow = window as unknown as Window & Record<string, unknown>;

  if (hookWindow[HOOK_FLAG]) {
    return;
  }

  hookWindow[HOOK_FLAG] = true;

  installWideViewportMatchMediaSpoof();
  listenForWidthSpoofToggle();
  installHistoryHook();

  const originalFetch = window.fetch.bind(window);

  window.addEventListener('message', (event: MessageEvent): void => {
    const data = event.data as
      | {
          type?: string;
          contractValues?: Record<string, unknown>;
        }
      | null;
    if (!data || data.type !== CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE) return;
    if (data.contractValues && typeof data.contractValues === 'object') {
      for (const [key, value] of Object.entries(data.contractValues)) {
        if (typeof value === 'string') {
          effectiveContractValues[key as ChatGptContractId] = value;
        }
      }
    }
  });

  window.fetch = async function (...args) {
    const requestMeta = getRequestMeta(args);

    try {
      const requestUrl = getFetchUrl(args[0]);
      const requestPath = new URL(requestUrl, window.location.origin).pathname;
      if (
        requestMeta &&
        requestMeta.isConversationGet &&
        requestPath.includes('/backend-api/conversations/')
      ) {
        // The bare conversation path and its `/messages` pagination
        // sub-resource are two distinct contracts. Comparing a `/messages`
        // GET against `api.conversation.path` produces a false-positive
        // "API path updated" alert, so pick the correct template using
        // the initial-load distinction already computed in getRequestMeta.
        const contractId = requestMeta.isInitialConversationLoad
          ? 'api.conversation.path'
          : 'api.conversation.messages-path';
        const expectedTemplate = effectiveContractValues[contractId];
        if (
          expectedTemplate &&
          !buildPathRegexFromTemplate(expectedTemplate).test(requestPath)
        ) {
          reportContractMismatch(contractId, requestPath);
        }
      }
    } catch {}

    try {
      if (requestMeta?.isSendMessage) {
        extractOutgoingMessage(args, requestMeta.routeKey);
      }
    } catch {}

    const fetchArgs = maybeBumpChatGptFetchNumTurns(args, {
      paginationNumTurns:
        APP_CONFIG.platforms.chatgpt.interceptChatGptPaginationNumTurns,
      initialLoadNumTurns:
        APP_CONFIG.platforms.chatgpt.interceptChatGptInitialLoadNumTurns,
    });
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
   * Increments the per-contract mismatch counter and, once it crosses the
   * report threshold, posts a `LUNA_CONTRACT_MISMATCH` message to the
   * content-script detector. Subsequent observations of the same contract
   * are ignored so a noisy page does not spam the bridge.
   * @param {ChatGptContractId} contractId
   * @param {string} actual The value the page-hook actually observed.
   */
  function reportContractMismatch(
    contractId: ChatGptContractId,
    actual: string
  ): void {
    const previous = contractMismatchCounters.get(contractId) ?? 0;
    if (previous >= CONTRACT_MISMATCH_REPORT_THRESHOLD) return;
    const next = previous + 1;
    contractMismatchCounters.set(contractId, next);
    if (next < CONTRACT_MISMATCH_REPORT_THRESHOLD) return;

    try {
      window.postMessage(
        {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId,
          expected: getActiveContractValue(contractId, false),
          actual,
        },
        window.location.origin
      );
    } catch {}
  }

  /**
   * Builds a RegExp from a contract path template by escaping every regex
   * special character and substituting the `{id}` placeholder with a path
   * segment matcher.
   * @param {string} template
   * @returns {RegExp}
   */
  function buildPathRegexFromTemplate(template: string): RegExp {
    const parts = template.split('{id}').map((part) =>
      part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    return new RegExp('^' + parts.join('([^/]+)') + '/?$');
  }

  /**
   * Probes the conversation messages endpoint with two different `num_turns`
   * values to detect the one failure mode that actually affects the plugin:
   * the fetch path returning zero messages (auth, route, etc.). Whether the
   * server honors `num_turns` is irrelevant — the plugin has its own backfill
   * strategy and works whether or not ChatGPT paginates. The earlier
   * delta-based heuristic produced false positives for short conversations
   * and for conversations whose turn-count semantics differ from their
   * message-count.
   * @param {string} conversationId
   * @param {Record<string, string> | null} authHeaders
   * @returns {Promise<void>}
   */
  async function probeNumTurnsBehavior(
    conversationId: string,
    authHeaders: Record<string, string> | null
  ): Promise<void> {
    const base = `/backend-api/conversations/${conversationId}/messages`;
    try {
      const [r10, r100] = await Promise.all([
        originalFetch(`${base}?num_turns=10&include_has_versions=true`, {
          method: 'GET',
          credentials: 'include',
          headers: authHeaders ?? undefined,
        }),
        originalFetch(`${base}?num_turns=100&include_has_versions=true`, {
          method: 'GET',
          credentials: 'include',
          headers: authHeaders ?? undefined,
        }),
      ]);
      if (!r10.ok || !r100.ok) return;
      const [d10, d100] = await Promise.all([r10.json(), r100.json()]);
      const len10 = Array.isArray(d10?.messages) ? d10.messages.length : 0;
      const len100 = Array.isArray(d100?.messages)
        ? d100.messages.length
        : 0;
      if (len10 === 0 && len100 === 0) {
        reportContractMismatch(
          'api.params.num-turns',
          'num_turns=10 and num_turns=100 both returned 0 messages'
        );
      }
    } catch {
      // Probe failures are non-fatal.
    }
  }

  /**
   * After the initial conversation load settles, observes the document for
   * DOM mutations and re-checks the navigation selectors on each change.
   * Resolves as soon as both selectors return at least one hit. Falls back
   * to the original single-shot report after 30 s so a genuinely broken
   * contract still surfaces a developer-facing alert.
   *
   * The previous implementation ran a single `setTimeout(3000)` query,
   * which could fire before ChatGPT finished hydrating the conversation
   * DOM and produced false-positive `LUNA_CONTRACT_MISMATCH` alerts.
   * Observing mutations removes the timing guess: the probe resolves as
   * soon as the host page actually mounts the expected elements.
   */
  function probeDomSelectors(): void {
    const userContractId: ChatGptContractId = 'dom.selector.user-message';
    const idContractId: ChatGptContractId = 'dom.selector.message-id';
    const DEBOUNCE_MS = 200;
    const FALLBACK_TIMEOUT_MS = 30_000;

    const resolveUserSelector = (): string =>
      effectiveContractValues[userContractId] ??
      getActiveContractValue(userContractId, false);
    const resolveIdSelector = (): string =>
      effectiveContractValues[idContractId] ??
      getActiveContractValue(idContractId, false);

    let resolved = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const observer = new MutationObserver((): void => {
        if (resolved) return;
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout((): void => {
          debounceTimer = null;
          if (resolved) return;
          const userCount = document.querySelectorAll(resolveUserSelector())
            .length;
          const idCount = document.querySelectorAll(resolveIdSelector())
            .length;
          if (userCount > 0 && idCount > 0) {
            resolved = true;
            observer.disconnect();
          }
        }, DEBOUNCE_MS);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout((): void => {
        if (resolved) return;
        observer.disconnect();
        if (debounceTimer !== null) clearTimeout(debounceTimer);

        const userCount = document.querySelectorAll(resolveUserSelector())
          .length;
        const idCount = document.querySelectorAll(resolveIdSelector()).length;
        if (userCount === 0) {
          reportContractMismatch(
            userContractId,
            'querySelectorAll returned 0 user message nodes'
          );
        }
        if (idCount === 0) {
          reportContractMismatch(
            idContractId,
            'querySelectorAll returned 0 message-id nodes'
          );
        }
      }, FALLBACK_TIMEOUT_MS);
    } catch {
      // Probe failures are non-fatal.
    }
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

        const messages = (data as { messages?: unknown } | null)?.messages;
        if (!Array.isArray(messages)) {
          reportContractMismatch(
            'response.messages-field',
            `typeof messages = ${typeof messages}`
          );
        }

        if (isInitialConversationLoad) {
          const backfillStarted = startBackfillIfNeeded(
            data,
            routeKey,
            authHeaders
          );
          // Skip the probe when the conversation is empty — a brand-new
          // chat has 0 messages by definition, and the probe would see 0
          // messages from its own fetches and falsely alert on "no
          // content". For any non-empty conversation the probe runs
          // unconditionally: it only alerts when both num_turns requests
          // return 0 messages, the only failure mode that actually
          // matters.
          if (Array.isArray(messages) && messages.length > 0) {
            void probeNumTurnsBehavior(routeKey, authHeaders);
          }
          probeDomSelectors();
          // If the initial response already represents the whole conversation
          // and no backfill is currently in flight for this route, the
          // backfill branch above won't fire the ENDED signal — do it here.
          // (If backfill already started for this route, either via the
          // branch above or by an earlier fetch, its `finally` will post
          // ENDED when it terminates, so we must not preempt it.)
          const pageInfo = (data as ConversationPayload | undefined)
            ?.page_info;
          if (
            !backfillStarted &&
            !backfillingConversationIds.has(routeKey) &&
            !pageInfo?.has_previous_page
          ) {
            postConversationEnded(routeKey);
          }
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
   * Signals that the page hook has finished streaming every conversation
   * page it intends to send (initial load plus any backfill). Emitted when:
   *  - the initial response had no further history to backfill, or
   *  - backfill terminated naturally at the page cap, or
   *  - backfill exited because the next page reported no further history.
   *
   * The content script uses this to leave `loading` mode. The earlier
   * `has_previous_page !== false` heuristic in the controller treated any
   * missing/incomplete field as "still loading", which stranded the UI
   * when the backend omitted `page_info` on the final response or when
   * the backfill cap was reached before the true last page.
   * @param {string} routeKey
   */
  function postConversationEnded(routeKey: string): void {
    if (!routeKey) return;
    window.postMessage(
      {
        type: CONVERSATION_ENDED_MESSAGE_TYPE,
        routeKey,
      },
      '*'
    );
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
  function startBackfillIfNeeded(
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

    try {
      for (let page = 0; page < BACKFILL_MAX_PAGES; page += 1) {
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
    } finally {
      // Whatever path terminates backfill (network error, no further history,
      // or hitting `BACKFILL_MAX_PAGES` on a conversation longer than the
      // cap), always tell the navigator this route is done streaming pages.
      // The controller only flips out of `loading` once it sees this signal.
      postConversationEnded(conversationId);
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
