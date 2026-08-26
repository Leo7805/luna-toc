/**
 * Notifies spoofed `MediaQueryList` listeners that the spoofed width result
 * changed. Lives next to `matchMediaSpoof.ts` so the Proxy implementation
 * can stay focused on `matchMedia` interception and listener tracking while
 * this module owns the change-event synthesis and fan-out.
 */

export type MediaQueryListener = EventListenerOrEventListenerObject;

export interface SpoofedMediaQueryEntry {
  query: string;
  listeners: Set<MediaQueryListener>;
  mediaQueryList: MediaQueryList | null;
  onchange: MediaQueryListener | null;
  tracked: boolean;
}

/**
 * Creates a MediaQueryList change event for spoof toggles. Prefer a real
 * Event so code that checks Event APIs still works; fall back to a plain
 * object if the browser refuses to define read-only event fields.
 * @param {MediaQueryList} mediaQueryList
 * @returns {Event | Object}
 */
export function createMediaQueryChangeEvent(
  mediaQueryList: MediaQueryList
): Event {
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
 * Calls either function listeners or EventListenerObject listeners with the
 * synthetic MediaQueryList change event.
 */
export function callMediaQueryListener(
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
 * Fans a synthetic `change` event out to every tracked listener of every
 * spoofed MediaQueryList. Called from `listenForWidthSpoofToggle` whenever
 * the content script toggles the spoof.
 */
export function notifySpoofedMediaQueryListeners(
  entries: Iterable<SpoofedMediaQueryEntry>
): void {
  for (const entry of entries) {
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
  }
}

/**
 * Checks whether a value is a valid MediaQueryList listener.
 */
export function isMediaQueryListener(
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