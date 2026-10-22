/** Tests prompt-usage reconciliation with the surviving user-owned prompt library. */
import { describe, expect, it } from 'vitest';
import { filterUsageForPrompts } from '@/features/myPrompts/promptUsageStore';

describe('prompt usage reconciliation', () => {
  it('removes only orphan usage entries, preserving surviving prompt statistics', () => {
    expect(filterUsageForPrompts({
      saved: { usageCount: 3, lastUsedAt: 100 },
      removed: { usageCount: 4, lastUsedAt: 150 },
    }, ['saved'])).toEqual({ saved: { usageCount: 3, lastUsedAt: 100 } });
  });

  it('keeps unknown source objects unmodified', () => {
    const usage = { known: { usageCount: 1, lastUsedAt: 2 } };
    expect(filterUsageForPrompts(usage, [])).toEqual({});
    expect(usage.known.usageCount).toBe(1);
  });
});
