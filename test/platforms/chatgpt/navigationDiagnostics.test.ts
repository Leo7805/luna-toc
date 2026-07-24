/** @vitest-environment jsdom */
/** Tests ChatGPT runtime navigation diagnostics and override validation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getChatGptNavigationTestConfig,
  logChatGptNavigationEvent,
  NAVIGATION_DEBUG_STORAGE_KEY,
  NAVIGATION_TEST_CONFIG_STORAGE_KEY,
} from '@/platforms/chatgpt/navigationDiagnostics';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ChatGPT navigation diagnostics', () => {
  it('returns project defaults without runtime overrides', () => {
    expect(getChatGptNavigationTestConfig()).toEqual({
      settleWaitMs: 80,
      settleAttempts: 3,
      maxSearchAttempts: 32,
      maxUnproductiveSearchAttempts: 6,
      maxSearchDurationMs: 4_000,
      unresolvedPositionsBeforeAbort: 2,
      useConfirmedAnchors: true,
      useObservedAnchors: true,
    });
  });

  it('accepts valid overrides and clamps unsafe numeric values', () => {
    localStorage.setItem(
      NAVIGATION_TEST_CONFIG_STORAGE_KEY,
      JSON.stringify({
        settleWaitMs: 300,
        settleAttempts: 99,
        maxSearchAttempts: 12,
        maxUnproductiveSearchAttempts: 6,
        maxSearchDurationMs: 50_000,
        unresolvedPositionsBeforeAbort: 4,
        useConfirmedAnchors: false,
        useObservedAnchors: false,
      })
    );

    expect(getChatGptNavigationTestConfig()).toEqual({
      settleWaitMs: 300,
      settleAttempts: 20,
      maxSearchAttempts: 12,
      maxUnproductiveSearchAttempts: 6,
      maxSearchDurationMs: 15_000,
      unresolvedPositionsBeforeAbort: 4,
      useConfirmedAnchors: false,
      useObservedAnchors: false,
    });
  });

  it('ignores malformed JSON and incorrectly typed fields', () => {
    localStorage.setItem(NAVIGATION_TEST_CONFIG_STORAGE_KEY, '{invalid');
    expect(getChatGptNavigationTestConfig().settleWaitMs).toBe(80);

    localStorage.setItem(
      NAVIGATION_TEST_CONFIG_STORAGE_KEY,
      JSON.stringify({
        settleWaitMs: '300',
        useConfirmedAnchors: 'false',
      })
    );
    expect(getChatGptNavigationTestConfig()).toMatchObject({
      settleWaitMs: 80,
      useConfirmedAnchors: true,
    });
  });

  it('logs structured events only when diagnostics are enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logChatGptNavigationEvent('jump-1', 'SEARCH_PLAN', {
      method: 'interpolation',
    });
    expect(debug).not.toHaveBeenCalled();

    localStorage.setItem(NAVIGATION_DEBUG_STORAGE_KEY, '1');
    logChatGptNavigationEvent('jump-1', 'SEARCH_PLAN', {
      method: 'interpolation',
    });

    expect(debug).toHaveBeenCalledWith(
      '[LunaTOC navigation][jump-1] SEARCH_PLAN',
      { method: 'interpolation' }
    );
  });
});
