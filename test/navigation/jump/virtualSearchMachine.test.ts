/** Tests the explicit adaptive navigation phase machine. */
import { describe, expect, it } from 'vitest';
import {
  advanceVirtualSearchMachine,
  createVirtualSearchMachine,
  updatePromptMountFeedback,
} from '@/navigation/jump/virtualSearchMachine';

describe('virtual search machine', () => {
  it('moves from initial estimation to response seeking', () => {
    expect(
      advanceVirtualSearchMachine(
        createVirtualSearchMachine(),
        false
      ).phase
    ).toBe('seek-response');
  });

  it('keeps mount ownership after neighboring responses appear', () => {
    const mounting = advanceVirtualSearchMachine(
      createVirtualSearchMachine(),
      true
    );
    const firstScan = updatePromptMountFeedback(mounting, {
      targetPromptIndex: 5,
      logicalPosition: 5,
      initialDirection: -1,
      initialStepViewportRatio: 0.2,
      minimumStepViewportRatio: 0.05,
      maximumStepViewportRatio: 2,
      growthRatio: 1.5,
      crossingRatio: 0.5,
    });
    const afterNeighbor = advanceVirtualSearchMachine(
      firstScan,
      false
    );

    expect(afterNeighbor).toEqual({
      phase: 'mount-prompt',
      mountAttempts: 1,
      mountDirection: -1,
      mountStepViewportRatio: 0.2,
    });
  });

  it('grows on the same response and reverses smaller after crossing', () => {
    const mounting = advanceVirtualSearchMachine(
      createVirtualSearchMachine(),
      true
    );
    const config = {
      targetPromptIndex: 5,
      initialDirection: -1 as const,
      initialStepViewportRatio: 0.2,
      minimumStepViewportRatio: 0.05,
      maximumStepViewportRatio: 2,
      growthRatio: 1.5,
      crossingRatio: 0.5,
    };
    const first = updatePromptMountFeedback(mounting, {
      ...config,
      logicalPosition: 5,
    });
    const grown = updatePromptMountFeedback(first, {
      ...config,
      logicalPosition: 5,
    });
    const crossed = updatePromptMountFeedback(grown, {
      ...config,
      logicalPosition: 4,
    });

    expect(grown.mountStepViewportRatio).toBeCloseTo(0.3);
    expect(crossed.mountDirection).toBe(1);
    expect(crossed.mountStepViewportRatio).toBeCloseTo(0.15);
  });
});
