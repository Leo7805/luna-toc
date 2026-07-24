/** Centralizes project-level values intended for deliberate tuning. */

export type ChatGptNavigationAlgorithm =
  | 'legacy-native'
  | 'independent-virtual';

/** Shared compile-time configuration for navigation and future project sections. */
export const APP_CONFIG = {
  platforms: {
    chatgpt: {
      navigationAlgorithm:
        'legacy-native' as ChatGptNavigationAlgorithm,
    },
  },
  navigation: {
    fingerprint: {
      countPerAssistant: 3,
      probeLength: 40,
      verificationLength: 256,
      buildBatchSize: 10,
      buildTimeBudgetMs: 8,
      observationDebounceMs: 750,
    },
    anchorCache: {
      maxConversations: 50,
      maxAnchorsPerConversation: 100,
      maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
      viewportWidthTolerance: 48,
    },
    search: {
      maxAttempts: 8,
      renderWaitMs: 80,
      maxDurationMs: 1_000,
      interpolationFailuresBeforeBinary: 2,
      unresolvedPositionsBeforeAbort: 2,
    },
  },
} as const;
