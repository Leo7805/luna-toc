/** Centralizes project-level values intended for deliberate tuning. */

export type ChatGptNavigationAlgorithm =
  | 'legacy-native'
  | 'independent-virtual';

/** Shared compile-time configuration for navigation and future project sections. */
export const APP_CONFIG = {
  platforms: {
    chatgpt: {
      navigationAlgorithm: 'independent-virtual' as ChatGptNavigationAlgorithm,
      promptTopOffsetPx: 16,
      settleAttempts: 3,
    },
  },
  navigation: {
    fingerprint: {
      countPerAssistant: 3,
      probeLength: 40,
      verificationLength: 256,
      segmentViewportRatio: 0.75,
      segmentOverlapRatio: 0.15,
      estimatedCharsPerVisualLine: 60,
      estimatedRowsPerViewport: 30,
      maximumSegmentsPerAssistant: 20,
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
      maxAttempts: 12,
      renderWaitMs: 80,
      maxDurationMs: 2_500,
      interpolationFailuresBeforeBinary: 2,
      unresolvedPositionsBeforeAbort: 2,
      initialProbeViewportCount: 2,
      probeViewportIncrement: 2,
      maximumProbeViewportCount: 8,
      distanceProbeViewportRatio: 0.75,
      maximumDistanceProbeViewportCount: 32,
      bracketDiscoveryDistanceMultiplier: 1.5,
      nearTargetPromptDistance: 2,
      nearTargetProbeViewportCount: 2,
      targetDomRecoveryViewportCount: 1,
    },
  },
} as const;
