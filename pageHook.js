/**
 * Injected page-context hook. It captures ChatGPT conversation fetch payloads,
 * streams newly submitted user prompts, and spoofs width media queries while
 * the ChatTOC sidebar is visible.
 */
(() => {
  const HOOK_FLAG = '__conversationNavigatorFetchHookInstalled';
  const MESSAGE_TYPE = 'CHATGPT_CONVERSATION_DATA';
  const WIDTH_SPOOF_MESSAGE_TYPE = 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF';
  const CONVERSATION_API_PATH = '/backend-api/conversation/';
  const SEND_MESSAGE_PATH = '/backend-api/f/conversation';
  const SPOOFED_VIEWPORT_WIDTH = 1400;
  const MEDIA_QUERY_LISTENER_METHODS = {
    addEventListener: { track: true, modern: true },
    removeEventListener: { track: false, modern: true },
    addListener: { track: true, modern: false },
    removeListener: { track: false, modern: false },
  };

  let streamBuffer = '';
  let wideViewportSpoofEnabled = true;
  const spoofedMediaQueryLists = new Set();

  if (window[HOOK_FLAG]) {
    return;
  }

  window[HOOK_FLAG] = true;

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

    const response = await originalFetch(...args);

    try {
      if (requestMeta?.isConversationGet) {
        postConversationData(response, requestMeta.routeKey);
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
  function extractOutgoingMessage(args, routeKey) {
    try {
      const init = args[1] || {};
      if (typeof init.body === 'string') {
        const data = JSON.parse(init.body);
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
  function getRequestMeta(args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = getFetchUrl(input);

      if (!url) {
        return null;
      }

      const method = getFetchMethod(input, init);
      const pathname = new URL(url, window.location.origin).pathname;

      return {
        isConversationGet:
          method === 'GET' && pathname.startsWith(CONVERSATION_API_PATH),
        isSendMessage: method === 'POST' && pathname === SEND_MESSAGE_PATH,
        routeKey: getCurrentConversationKey(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Normalizes fetch input into a URL string so Request objects and string
   * URLs are handled the same way.
   * @param {RequestInfo | URL} input
   * @returns {string}
   */
  function getFetchUrl(input) {
    if (typeof input === 'string') {
      return input;
    }

    if (input instanceof Request) {
      return input.url;
    }

    return input?.url || '';
  }

  /**
   * Resolves the effective fetch method from Request and init arguments.
   * @param {RequestInfo | URL} input
   * @param {RequestInit} init
   * @returns {string}
   */
  function getFetchMethod(input, init) {
    return (
      init.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
  }

  /**
   * Returns the ChatGPT route key at the time a request is intercepted.
   * @returns {string}
   */
  function getCurrentConversationKey() {
    const match = location.pathname.match(/\/c\/([^/]+)/);

    return match?.[1] || `new-chat:${location.pathname}`;
  }

  /**
   * Spoofs JS media-query width checks so ChatGPT keeps its built-in prompt
   * navigator mounted in narrow split-view layouts.
   */
  function installWideViewportMatchMediaSpoof() {
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
  function listenForWidthSpoofToggle() {
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
  function isWidthMediaQuery(query) {
    return getWidthMediaQueryRules(query).length > 0;
  }

  /**
   * Extracts min-width and max-width rules from a JS media query.
   * @param {string} query
   * @returns {RegExpMatchArray[]}
   */
  function getWidthMediaQueryRules(query) {
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
  function getSpoofedMediaQueryMatch(query) {
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
  function createSpoofedMediaQueryList(mediaQueryList, query) {
    const entry = {
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

        if (property in MEDIA_QUERY_LISTENER_METHODS && property in target) {
          return wrapMediaQueryListenerMethod(target, entry, property);
        }

        return getBoundNativeValue(target, property);
      },
      set(target, property, value) {
        if (property === 'onchange') {
          entry.onchange = isMediaQueryListener(value) ? value : null;
          syncTrackedMediaQueryEntry(entry);
          target.onchange = value;
          return true;
        }

        target[property] = value;
        return true;
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
  function wrapMediaQueryListenerMethod(target, entry, method) {
    const config = MEDIA_QUERY_LISTENER_METHODS[method];

    return function (...args) {
      const listener = config.modern ? args[1] : args[0];

      if (!config.modern || args[0] === 'change') {
        setTrackedMediaQueryListener(entry, listener, config.track);
      }

      return target[method]?.(...args);
    };
  }

  /**
   * Adds or removes one listener from the proxy entry's tracked listener set.
   * @param {Object} entry
   * @param {Function | EventListenerObject | null | undefined} listener
   * @param {boolean} shouldTrack
   */
  function setTrackedMediaQueryListener(entry, listener, shouldTrack) {
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
  function syncTrackedMediaQueryEntry(entry) {
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
  function getBoundNativeValue(target, property) {
    const value = target[property];

    return typeof value === 'function' ? value.bind(target) : value;
  }

  /**
   * Notifies responsive hooks that the spoofed width result changed.
   */
  function notifySpoofedMediaQueryListeners() {
    spoofedMediaQueryLists.forEach((entry) => {
      const event = createMediaQueryChangeEvent(entry.mediaQueryList);
      const listeners = new Set(entry.listeners);

      if (entry.onchange) {
        listeners.add(entry.onchange);
      }

      listeners.forEach((listener) => {
        try {
          callMediaQueryListener(listener, entry.mediaQueryList, event);
        } catch {}
      });
    });
  }

  /**
   * Creates a MediaQueryList change event for spoof toggles. Prefer a real
   * Event so code that checks Event APIs still works; fall back to a plain
   * object if the browser refuses to define read-only event fields.
   * @param {MediaQueryList} mediaQueryList
   * @returns {Event | Object}
   */
  function createMediaQueryChangeEvent(mediaQueryList) {
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
      };
    }
  }

  /**
   * Checks whether a value is a valid MediaQueryList listener.
   * @param {*} listener
   * @returns {boolean}
   */
  function isMediaQueryListener(listener) {
    return (
      typeof listener === 'function' ||
      typeof listener?.handleEvent === 'function'
    );
  }

  /**
   * Calls either function listeners or EventListenerObject listeners with the
   * synthetic MediaQueryList change event.
   * @param {Function | EventListenerObject} listener
   * @param {MediaQueryList} mediaQueryList
   * @param {Object} event
   */
  function callMediaQueryListener(listener, mediaQueryList, event) {
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
  function postConversationData(response, routeKey) {
    response
      .clone()
      .json()
      .then((data) => {
        window.postMessage(
          {
            type: MESSAGE_TYPE,
            routeKey,
            payload: data,
          },
          '*'
        );
      })
      .catch(() => {});
  }

  /**
   * Reads a cloned send-message SSE stream so newly submitted user prompts can
   * appear in the navigator before the next full conversation fetch completes.
   * @param {Response} response
   * @param {string} routeKey Route key captured when the request was made.
   * @returns {Promise<void>}
   */
  async function inspectStream(response, routeKey) {
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
  function processBufferedStream(routeKey) {
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
  function processStreamLine(line, routeKey) {
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
  function installHistoryHook() {
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
  function notifyRouteChanged() {
    window.postMessage(
      {
        type: 'CHATGPT_ROUTE_CHANGED',
      },
      '*'
    );
  }
})();
