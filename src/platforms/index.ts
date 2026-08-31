/**
 * Platform registry + host detection.
 *
 * This file is the **only** host-detection function in the codebase. The
 * page-hook entry (`src/pageHook/pageHook.iife.ts`) and the content-script
 * application shell (`src/app/applicationShell.ts`) both call
 * `getActivePlatform()` at startup to dispatch per-platform calls.
 *
 * Order matters only when two platforms share a host (not currently the
 * case). Each entry's `matches` mirrors a `content_scripts.matches` block
 * in `manifest.json`; a follow-up PR generates `manifest.json` from
 * `Platform.matches` directly.
 */
import { chatGptPlatform } from './chatgpt';
import { copilotPlatform } from './copilot';
import type { Platform, PlatformId } from './platformInterface';

/**
 * Every registered platform. Order matters only when two platforms share
 * a host (not currently the case).
 */
export const PLATFORMS: readonly Platform[] = [
  chatGptPlatform,
  copilotPlatform,
];

/**
 * Returns the platform record for a given id, or throws if unknown.
 */
export function getPlatformById(id: PlatformId): Platform {
  const found = PLATFORMS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown platform id: ${id}`);
  }
  return found;
}

/**
 * Resolves the active platform from the current `window.location.host`.
 * Falls back to a parameter so tests can inject any host. Throws if no
 * registered platform matches.
 */
export function getActivePlatform(
  host: string = window.location.host
): Platform {
  for (const platform of PLATFORMS) {
    if (platform.matches.some((pattern) => matchHost(pattern, host))) {
      return platform;
    }
  }
  throw new Error(`LunaTOC: no platform registered for host "${host}"`);
}

/**
 * Returns whether a Chrome `content_scripts.matches` pattern (e.g.
 * `https://chatgpt.com/*`) covers the given host. Subdomain wildcards are
 * treated as exact-match the immediate host (Chrome matches based on
 * URL prefix, so `https://*.chatgpt.com/*` matches any subdomain). The
 * pattern's trailing `/*` is ignored; the host portion is compared
 * against the URL up to the first `/` or end of string.
 */
function matchHost(pattern: string, host: string): boolean {
  const hostPart = pattern.replace(/^https?:\/\//, '').split('/')[0];
  if (!hostPart) return false;
  if (hostPart === host) return true;
  if (hostPart.startsWith('*.')) {
    const suffix = hostPart.slice(1); // ".chatgpt.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

export type { Platform, PlatformId };