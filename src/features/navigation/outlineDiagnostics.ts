/** Provides opt-in diagnostics for per-Prompt Assistant outlines. */
const OUTLINE_DIAGNOSTICS_STORAGE_KEY = 'chatTocDebugOutline';

/**
 * Logs structured Outline diagnostics when explicitly enabled.
 */
export function logOutlineDiagnostic(
  eventName: string,
  details: Record<string, unknown> = {}
): void {
  try {
    if (
      window.localStorage.getItem(OUTLINE_DIAGNOSTICS_STORAGE_KEY) !== '1'
    ) {
      return;
    }

    console.debug(`[LunaTOC outline] ${eventName}`, details);
  } catch {
    // Ignore unavailable page storage or console contexts.
  }
}
