/** Centralizes project-level values intended for deliberate tuning. */

export type ChatGptNavigationAlgorithm =
  | 'legacy-native'
  | 'independent-virtual';

/** Shared compile-time configuration for navigation and future project sections. */
export const APP_CONFIG = {
  ui: {
    sidebar: {
      defaultWidthPx: 300,
      minimumWidthPx: 240,
      maximumWidthPx: 520,
    },
    stacking: {
      baseZIndex: 1_000,
      offsets: {
        sidebar: 0,
        toggle: 10,
        popover: 20,
        modal: 100,
      },
    },
  },
  platforms: {
    chatgpt: {
      navigationAlgorithm: 'independent-virtual' as ChatGptNavigationAlgorithm,
      promptTopOffsetPx: 16,
      settleAttempts: 3,
      backfillMaxPages: 10,
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
      maxAttempts: 32,
      maxUnproductiveAttempts: 6,
      renderWaitMs: 80,
      maxDurationMs: 30_000,
      edgeBackfillWaitMs: 1_200,
      maximumWindowSlideCycles: 16,
      interpolationFailuresBeforeBinary: 2,
      relativeViewportRatio: 0.75,
      minimumRelativeViewportRatio: 0.25,
      maximumRelativeViewportCount: 16,
      maximumLearnedRelativeViewportCount: 64,
      nearTargetPromptDistance: 4,
      maximumNearTargetViewportCount: 8,
      stalledStepGrowthRatio: 1.5,
      crossingStepRatio: 0.5,
      promptMountScanViewportRatio: 0.2,
      minimumPromptMountViewportRatio: 0.05,
      maximumPromptMountViewportCount: 2,
      promptMountStepGrowthRatio: 1.5,
      promptMountCrossingStepRatio: 0.5,
      maximumPromptMountAttempts: 12,
    },
  },
} as const;
