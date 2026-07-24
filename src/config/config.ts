/** Centralizes project-level values intended for deliberate tuning. */

/** Shared compile-time configuration for navigation and future project sections. */
export const APP_CONFIG = {
  navigation: {
    algorithm: 'native',
    fingerprint: {
      countPerAssistant: 3,
      probeLength: 40,
      verificationLength: 256,
      buildBatchSize: 10,
      buildTimeBudgetMs: 8,
    },
    search: {
      maxAttempts: 8,
      renderWaitMs: 80,
      maxDurationMs: 1_000,
    },
  },
} as const;
