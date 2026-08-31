/**
 * ChatGPT page-hook concern: spoof `window.matchMedia` width queries so
 * ChatGPT keeps its built-in prompt navigator mounted in narrow split-view
 * layouts. The Proxy/event machinery is generic; this module is the
 * ChatGPT-specific entry point that registers the override and the
 * content-script toggle listener.
 *
 * The Proxy/Event synthesis lives in `@/pageHook/matchMediaNotifier` so
 * other future platforms (e.g. Gemini) can reuse it once they too want
 * to spoof the host's responsive checks.
 */
import {
  notifySpoofedMediaQueryListeners,
  type SpoofedMediaQueryEntry,
} from '@/pageHook/matchMediaNotifier';
import { CHATGPT_MESSAGE_TYPES } from '../messages';

export const SPOOFED_VIEWPORT_WIDTH = 1400;

const WIDTH_SPOOF_MESSAGE_TYPE = CHATGPT_MESSAGE_TYPES.setWidthSpoof;

let wideViewportSpoofEnabled = true;
const spoofedMediaQueryLists = new Set<SpoofedMediaQueryEntry>();

/**
 * Replaces `window.matchMedia` with a function that returns a `MediaQueryList`
 * Proxy for any width-based query and the original list otherwise.
 */
export function installMatchMediaSpoof(): void {
  installWideViewportMatchMediaSpoof();
}

/**
 * Listens for the content-script visibility toggle message. Idempotent —
 * registered once per page-hook lifetime.
 */
export function installMatchMediaToggleListener(): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if ((event.data as { type?: string } | null)?.type !== WIDTH_SPOOF_MESSAGE_TYPE) return;

    wideViewportSpoofEnabled = Boolean(
      (event.data as { enabled?: boolean }).enabled
    );
    notifySpoofedMediaQueryListeners(spoofedMediaQueryLists);
    window.dispatchEvent(new Event('resize'));
  });
}

/**
 * Programmatic toggle for callers that already hold a platform reference.
 * Currently used by sidebarVisibility.ts when the user pins/unpins.
 */
export function setSidebarSpoofEnabled(enabled: boolean): void {
  wideViewportSpoofEnabled = Boolean(enabled);
  notifySpoofedMediaQueryListeners(spoofedMediaQueryLists);
  window.dispatchEvent(new Event('resize'));
}

function installWideViewportMatchMediaSpoof(): void {
  const originalMatchMedia = window.matchMedia?.bind(window);
  if (!originalMatchMedia) return;

  // ChatGPT decides whether to mount its built-in prompt navigator from
  // page-context responsive checks. Content scripts run in an isolated
  // world, so the spoof has to live in this injected page script.
  window.matchMedia = function (query: string) {
    const mediaQueryList = originalMatchMedia(query);
    if (!isWidthMediaQuery(query)) return mediaQueryList;
    return createSpoofedMediaQueryList(mediaQueryList, query);
  };
}

function isWidthMediaQuery(query: string): boolean {
  return getWidthMediaQueryRules(query).length > 0;
}

function getWidthMediaQueryRules(query: string): RegExpMatchArray[] {
  return Array.from(
    String(query)
      .toLowerCase()
      .matchAll(/\((min|max)-width\s*:\s*([\d.]+)(px|rem|em)\)/g)
  );
}

function getSpoofedMediaQueryMatch(query: string): boolean | null {
  if (!wideViewportSpoofEnabled) return null;
  const widthRules = getWidthMediaQueryRules(query);
  if (widthRules.length === 0) return null;

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
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value: unknown) {
      if (property === 'onchange') {
        entry.onchange = value as SpoofedMediaQueryEntry['onchange'];
        return true;
      }
      return Reflect.set(target, property, value);
    },
  });

  entry.mediaQueryList = proxy;
  spoofedMediaQueryLists.add(entry);
  return proxy;
}