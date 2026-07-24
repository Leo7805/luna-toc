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
    expect(fingerprint.buildBatchSize).toBeGreaterThan(0);
    expect(fingerprint.buildTimeBudgetMs).toBeGreaterThan(0);
  });

  it('defines a bounded position-search budget', () => {
    const search = APP_CONFIG.navigation.search;

    expect(search.maxAttempts).toBeGreaterThan(0);
    expect(search.renderWaitMs).toBeGreaterThan(0);
    expect(search.maxDurationMs).toBeGreaterThanOrEqual(search.renderWaitMs);
  });
});
