/**
 * Tests navigation direction calculation relative to mounted prompt indices.
 */
import { describe, expect, it } from 'vitest';
import { computeDirectionTowardTarget } from '@/navigation/jump/direction';

describe('computeDirectionTowardTarget', () => {
  it('returns null when sidebarIndices is empty', () => {
    expect(computeDirectionTowardTarget(5, [])).toBeNull();
  });

  it('returns -1 when target is before all mounted prompt indices', () => {
    expect(computeDirectionTowardTarget(0, [10, 11, 12])).toBe(-1);
    expect(computeDirectionTowardTarget(5, [10, 20, 30])).toBe(-1);
  });

  it('returns 1 when target is after all mounted prompt indices', () => {
    expect(computeDirectionTowardTarget(15, [10, 11, 12])).toBe(1);
    expect(computeDirectionTowardTarget(35, [10, 20, 30])).toBe(1);
  });

  it('determines direction based on the nearest mounted index', () => {
    // Mounted indices: [10, 20]. Target: 12. Nearest is 10. 12 > 10 => +1.
    expect(computeDirectionTowardTarget(12, [10, 20])).toBe(1);

    // Mounted indices: [10, 20]. Target: 18. Nearest is 20. 18 < 20 => -1.
    expect(computeDirectionTowardTarget(18, [10, 20])).toBe(-1);

    // Mounted indices: [5, 50, 100]. Target: 40. Nearest is 50. 40 < 50 => -1.
    expect(computeDirectionTowardTarget(40, [5, 50, 100])).toBe(-1);

    // Mounted indices: [5, 50, 100]. Target: 60. Nearest is 50. 60 > 50 => +1.
    expect(computeDirectionTowardTarget(60, [5, 50, 100])).toBe(1);
  });

  it('handles target equal to nearest mounted index consistently (-1)', () => {
    // If targetIndex === nearestIdx, targetIndex > nearestIdx is false => -1
    expect(computeDirectionTowardTarget(10, [10, 20])).toBe(-1);
  });
});
