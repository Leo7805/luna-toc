/**
 * Provides runtime diagnostics and temporary test overrides for ChatGPT navigation.
 */
import { APP_CONFIG } from '@/config/config';

export const NAVIGATION_DEBUG_STORAGE_KEY = 'chatTocDebugJump';
export const NAVIGATION_TEST_CONFIG_STORAGE_KEY =
  'chatTocNavigationTestConfig';

export interface ChatGptNavigationTestConfig {
  settleWaitMs: number;
  settleAttempts: number;
  maxSearchAttempts: number;
  maxSearchDurationMs: number;
  unresolvedPositionsBeforeAbort: number;
  useConfirmedAnchors: boolean;
  useObservedAnchors: boolean;
}

let jumpSequence = 0;

/**
 * Returns validated runtime overrides, falling back to project defaults.
 *
 * @example
 * const config = getChatGptNavigationTestConfig(localStorage);
 */
export function getChatGptNavigationTestConfig(
  storage: Pick<Storage, 'getItem'> = localStorage
): ChatGptNavigationTestConfig {
  const defaults = getDefaultNavigationTestConfig();

  try {
    const rawValue = storage.getItem(NAVIGATION_TEST_CONFIG_STORAGE_KEY);
    if (!rawValue) return defaults;

    const value: unknown = JSON.parse(rawValue);
    if (!isRecord(value)) return defaults;

    return {
      settleWaitMs: readBoundedNumber(
        value.settleWaitMs,
        defaults.settleWaitMs,
        0,
        2_000
      ),
      settleAttempts: readBoundedInteger(
        value.settleAttempts,
        defaults.settleAttempts,
        1,
        20
      ),
      maxSearchAttempts: readBoundedInteger(
        value.maxSearchAttempts,
        defaults.maxSearchAttempts,
        1,
        50
      ),
      maxSearchDurationMs: readBoundedNumber(
        value.maxSearchDurationMs,
        defaults.maxSearchDurationMs,
        100,
        15_000
      ),
      unresolvedPositionsBeforeAbort: readBoundedInteger(
        value.unresolvedPositionsBeforeAbort,
        defaults.unresolvedPositionsBeforeAbort,
        1,
        10
      ),
      useConfirmedAnchors: readBoolean(
        value.useConfirmedAnchors,
        defaults.useConfirmedAnchors
      ),
      useObservedAnchors: readBoolean(
        value.useObservedAnchors,
        defaults.useObservedAnchors
      ),
    };
  } catch {
    return defaults;
  }
}

/**
 * Creates a compact identifier shared by every event in one jump.
 */
export function createChatGptNavigationJumpId(): string {
  jumpSequence += 1;
  return `jump-${Date.now()}-${jumpSequence}`;
}

/**
 * Writes one structured event when navigation diagnostics are enabled.
 */
export function logChatGptNavigationEvent(
  jumpId: string,
  eventName: string,
  details: Record<string, unknown> = {},
  storage: Pick<Storage, 'getItem'> = localStorage
): void {
  try {
    if (storage.getItem(NAVIGATION_DEBUG_STORAGE_KEY) !== '1') return;
    console.debug(
      `[LunaTOC navigation][${jumpId}] ${eventName}`,
      details
    );
  } catch {
    // Ignore diagnostics when page storage is unavailable.
  }
}

/**
 * Returns project defaults in the same shape as runtime test overrides.
 */
function getDefaultNavigationTestConfig(): ChatGptNavigationTestConfig {
  return {
    settleWaitMs: APP_CONFIG.navigation.search.renderWaitMs,
    settleAttempts: APP_CONFIG.platforms.chatgpt.settleAttempts,
    maxSearchAttempts: APP_CONFIG.navigation.search.maxAttempts,
    maxSearchDurationMs: APP_CONFIG.navigation.search.maxDurationMs,
    unresolvedPositionsBeforeAbort:
      APP_CONFIG.navigation.search.unresolvedPositionsBeforeAbort,
    useConfirmedAnchors: true,
    useObservedAnchors: true,
  };
}

/**
 * Reads a finite number and clamps it to an inclusive range.
 */
function readBoundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Reads and truncates a bounded integer.
 */
function readBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.trunc(
    readBoundedNumber(value, fallback, minimum, maximum)
  );
}

/**
 * Reads a boolean without coercing strings or numbers.
 */
function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Returns whether an unknown value can be inspected as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
