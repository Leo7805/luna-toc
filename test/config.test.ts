/** Verifies constraints required by the shared project configuration. */
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config/config';

describe('APP_CONFIG', () => {
  it('defines usable Assistant fingerprint limits', () => {
    const fingerprint = APP_CONFIG.navigation.fingerprint;

    expect(fingerprint.countPerAssistant).toBeGreaterThan(0);
    expect(fingerprint.probeLength).toBeGreaterThan(0);
    expect(fingerprint.verificationLength).toBeGreaterThan(
      fingerprint.probeLength
    );
    expect(fingerprint.segmentViewportRatio).toBeGreaterThan(0);
    expect(fingerprint.segmentOverlapRatio).toBeGreaterThanOrEqual(0);
    expect(fingerprint.estimatedCharsPerVisualLine).toBeGreaterThan(0);
    expect(fingerprint.estimatedRowsPerViewport).toBeGreaterThan(0);
    expect(fingerprint.maximumSegmentsPerAssistant).toBeGreaterThan(0);
    expect(fingerprint.buildBatchSize).toBeGreaterThan(0);
    expect(fingerprint.buildTimeBudgetMs).toBeGreaterThan(0);
  });

  it('defines a bounded position-search budget', () => {
    const search = APP_CONFIG.navigation.search;

    expect(search.maxAttempts).toBeGreaterThan(0);
    expect(search.renderWaitMs).toBeGreaterThan(0);
    expect(search.maxDurationMs).toBeGreaterThanOrEqual(search.renderWaitMs);
    expect(search.relativeViewportRatio).toBeGreaterThan(0);
    expect(search.minimumRelativeViewportRatio).toBeGreaterThan(0);
    expect(search.maximumRelativeViewportCount).toBeGreaterThan(0);
    expect(
      search.maximumLearnedRelativeViewportCount
    ).toBeGreaterThan(search.maximumRelativeViewportCount);
    expect(search.nearTargetPromptDistance).toBeGreaterThan(0);
    expect(search.maximumNearTargetViewportCount).toBeGreaterThan(0);
    expect(search.stalledStepGrowthRatio).toBeGreaterThan(1);
    expect(search.crossingStepRatio).toBeGreaterThan(0);
    expect(search.promptMountScanViewportRatio).toBeGreaterThan(0);
    expect(search.minimumPromptMountViewportRatio).toBeGreaterThan(0);
    expect(search.maximumPromptMountViewportCount).toBeGreaterThan(0);
    expect(search.promptMountStepGrowthRatio).toBeGreaterThan(1);
    expect(search.promptMountCrossingStepRatio).toBeGreaterThan(0);
    expect(search.maximumPromptMountAttempts).toBeGreaterThan(0);
    expect(search.maxAttempts * search.renderWaitMs).toBeLessThanOrEqual(
      search.maxDurationMs
    );
  });
});
