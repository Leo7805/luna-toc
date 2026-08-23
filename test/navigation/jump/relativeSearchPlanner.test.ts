/** Tests relative feedback planning without browser DOM dependencies. */
import { describe, expect, it } from 'vitest';
import {
  planPromptMountScan,
  planRelativeSearch,
} from '@/navigation/jump/relativeSearchPlanner';

describe('relative search planner', () => {
  it('learns pixels per Prompt from consecutive live observations', () => {
    const plan = planRelativeSearch({
      targetPromptIndex: 20,
      currentSample: { logicalPosition: 10, scrollTop: 10_000 },
      previousSample: { logicalPosition: 5, scrollTop: 5_000 },
      lastScrollDelta: 5_000,
      maximumScrollTop: 100_000,
      viewportHeight: 1_000,
    });

    expect(plan.scrollTop).toBe(20_000);
    expect(plan.planningBasis).toBe('learned-rate');
    expect(plan.estimatedPixelsPerPrompt).toBe(1_000);
  });

  it('allows larger learned steps while the target is far away', () => {
    const plan = planRelativeSearch({
      targetPromptIndex: 100,
      currentSample: { logicalPosition: 10, scrollTop: 10_000 },
      previousSample: { logicalPosition: 9, scrollTop: 9_000 },
      lastScrollDelta: 1_000,
      maximumScrollTop: 200_000,
      viewportHeight: 1_000,
    });

    expect(plan.scrollTop).toBe(74_000);
    expect(plan.movementLimit).toBe(64_000);
  });

  it('uses the smaller learned-step limit near the target', () => {
    const plan = planRelativeSearch({
      targetPromptIndex: 20,
      currentSample: { logicalPosition: 16, scrollTop: 16_000 },
      previousSample: { logicalPosition: 15, scrollTop: 13_000 },
      lastScrollDelta: 3_000,
      maximumScrollTop: 100_000,
      viewportHeight: 1_000,
    });

    expect(plan.scrollTop).toBe(24_000);
    expect(plan.movementLimit).toBe(8_000);
  });

  it('reverses and halves the previous step after crossing the target', () => {
    const plan = planRelativeSearch({
      targetPromptIndex: 10,
      currentSample: { logicalPosition: 12, scrollTop: 12_000 },
      previousSample: { logicalPosition: 8, scrollTop: 8_000 },
      lastScrollDelta: 4_000,
      maximumScrollTop: 100_000,
      viewportHeight: 1_000,
    });

    expect(plan.scrollTop).toBe(10_000);
    expect(plan.planningBasis).toBe('target-crossing');
  });

  it('scans for mounted prompts relative to the current scroll', () => {
    expect(
      planPromptMountScan({
        targetPromptIndex: 3,
        currentScrollTop: 4_500,
        maximumScrollTop: 20_000,
        viewportHeight: 1_000,
        direction: -1,
      }).scrollTop
    ).toBe(4_300);
  });
});
