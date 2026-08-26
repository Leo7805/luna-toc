/**
 * Spoofs `window.matchMedia` width queries so ChatGPT keeps its built-in
 * prompt navigator mounted in narrow split-view layouts. The spoof has to
 * live in the MAIN-world page-hook because the content script runs in an
 * isolated world and cannot replace the host page's `matchMedia`.
 *
 * The module exposes a single `installMatchMediaSpoof()` factory that wires
 * up the `matchMedia` override and the toggle listener. State
 * (`wideViewportSpoofEnabled`, `spoofedMediaQueryLists`) is module-internal
 * and never escapes the file. The synthetic change-event dispatch lives in
 * `matchMediaNotifier.ts` so this module can stay focused on interception
 * and listener tracking.
 */
import {
  isMediaQueryListener,
  notifySpoofedMediaQueryListeners,
} from './matchMediaNotifier';
import type {
  MediaQueryListener,
  SpoofedMediaQueryEntry,
} from './matchMediaNotifier';

type MediaQueryListenerMethod = keyof typeof MEDIA_QUERY_LISTENER_METHODS;

const SPOOFED_VIEWPORT_WIDTH = 1400;
const WIDTH_SPOOF_MESSAGE_TYPE = 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF';

const MEDIA_QUERY_LISTENER_METHODS = {
  addEventListener: { track: true, modern: true },
  removeEventListener: { track: false, modern: true },
  addListener: { track: true, modern: false },
  removeListener: { track: false, modern: false },
} as const;

let wideViewportSpoofEnabled = true;
const spoofedMediaQueryLists = new Set<SpoofedMediaQueryEntry>();

/**
 * Installs the `matchMedia` proxy and the message listener that lets the
 * content script toggle the spoof on/off. Safe to call once at page-hook
 * startup.
 */
export function installMatchMediaSpoof(): void {
  installWideViewportMatchMediaSpoof();
  listenForWidthSpoofToggle();
}

/**
 * Replaces `window.matchMedia` with a function that returns a `MediaQueryList`
 * Proxy for any width-based query and the original list otherwise.
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
    notifySpoofedMediaQueryListeners(spoofedMediaQueryLists);
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

function isMediaQueryListenerMethod(
  property: string | symbol
): property is MediaQueryListenerMethod {
  return (
    typeof property === 'string' && property in MEDIA_QUERY_LISTENER_METHODS
  );
}