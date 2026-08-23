/** Tests anchor-based virtual-list scroll planning. */
import { describe, expect, it } from 'vitest';
import {
  planVirtualSearch,
  type VirtualSearchPlannerInput,
} from '@/navigation/jump/virtualSearchPlanner';
import {
  createNavigationAnchor,
  type NavigationAnchor,
} from '@/navigation/jump/navigationAnchorStore';

function createAnchor(
  promptIndex: number,
  scrollTop: number,
  overrides: Partial<NavigationAnchor> = {}
): NavigationAnchor {
  return {
    ...createNavigationAnchor(
      {
        conversationKey: 'conversation-1',
        promptId: `prompt-${promptIndex}`,
        promptIndex,
        scrollTop,
        scrollHeight: 11_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      },
      100
    ),
    ...overrides,
  };
}

function createInput(
  overrides: Partial<VirtualSearchPlannerInput> = {}
): VirtualSearchPlannerInput {
  return {
    targetPromptIndex: 8,
    promptCount: 21,
    maximumScrollTop: 10_000,
    viewportWidth: 1_280,
    observedAnchors: [],
    confirmedAnchors: [],
    ...overrides,
  };
}

describe('virtual search planner', () => {
  it('uses an exact observed anchor before estimating', () => {
    const plan = planVirtualSearch(
      createInput({
        observedAnchors: [createAnchor(8, 4_200)],
        confirmedAnchors: [createAnchor(8, 3_800)],
      })
    );

    expect(plan).toEqual({
      method: 'exact-anchor',
      targetPromptIndex: 8,
      scrollTop: 4_200,
      lowerAnchor: {
        promptIndex: 8,
        scrollTop: 4_200,
        source: 'observed',
      },
      upperAnchor: {
        promptIndex: 8,
        scrollTop: 4_200,
        source: 'observed',
      },
    });
  });

  it('interpolates inside the smallest known anchor range', () => {
    const plan = planVirtualSearch(
      createInput({
        observedAnchors: [
          createAnchor(5, 2_000),
          createAnchor(11, 5_000),
          createAnchor(20, 10_000),
        ],
      })
    );

    expect(plan).toMatchObject({
      method: 'interpolation',
      targetPromptIndex: 8,
      scrollTop: 3_500,
      lowerAnchor: { promptIndex: 5, source: 'observed' },
      upperAnchor: { promptIndex: 11, source: 'observed' },
    });
  });

  it('uses the closest upper range for a later target', () => {
    const plan = planVirtualSearch(
      createInput({
        targetPromptIndex: 15,
        observedAnchors: [
          createAnchor(5, 2_000),
          createAnchor(11, 5_000),
          createAnchor(20, 10_000),
        ],
      })
    );

    expect(plan).toMatchObject({
      method: 'interpolation',
      lowerAnchor: { promptIndex: 11 },
      upperAnchor: { promptIndex: 20 },
    });
    expect(plan.scrollTop).toBeCloseTo(7_222.22, 1);
  });

  it('uses proportional estimation when no anchor is available', () => {
    const plan = planVirtualSearch(
      createInput({
        targetPromptIndex: 10,
      })
    );

    expect(plan).toEqual({
      method: 'proportional',
      targetPromptIndex: 10,
      scrollTop: 5_000,
      lowerAnchor: null,
      upperAnchor: null,
    });
  });

  it('uses a page boundary when only one anchor side is known', () => {
    const plan = planVirtualSearch(
      createInput({
        targetPromptIndex: 15,
        observedAnchors: [createAnchor(11, 5_000)],
      })
    );

    expect(plan).toMatchObject({
      method: 'interpolation',
      lowerAnchor: {
        promptIndex: 11,
        scrollTop: 5_000,
        source: 'observed',
      },
      upperAnchor: {
        promptIndex: 20,
        scrollTop: 10_000,
        source: 'boundary',
      },
    });
  });

  it('rescales compatible confirmed anchors to the current scroll height', () => {
    const confirmedAnchor = createAnchor(8, 4_000);
    const plan = planVirtualSearch(
      createInput({
        maximumScrollTop: 20_000,
        confirmedAnchors: [confirmedAnchor],
      })
    );

    expect(plan).toMatchObject({
      method: 'exact-anchor',
      scrollTop: 8_000,
      lowerAnchor: { source: 'confirmed' },
    });
  });

  it('ignores confirmed anchors from an incompatible viewport width', () => {
    const plan = planVirtualSearch(
      createInput({
        confirmedAnchors: [
          createAnchor(8, 4_000, { viewportWidth: 1_500 }),
        ],
      })
    );

    expect(plan.method).toBe('proportional');
  });

  it('switches from interpolation to binary after repeated failures', () => {
    const plan = planVirtualSearch(
      createInput({
        observedAnchors: [
          createAnchor(5, 2_000),
          createAnchor(11, 5_000),
        ],
        failedInterpolationAttempts: 2,
      })
    );

    expect(plan).toMatchObject({
      method: 'binary',
      scrollTop: 3_500,
      lowerAnchor: { promptIndex: 5 },
      upperAnchor: { promptIndex: 11 },
    });
  });

  it('rejects anchor bounds whose scroll positions run backwards', () => {
    const plan = planVirtualSearch(
      createInput({
        targetPromptIndex: 12,
        promptCount: 20,
        maximumScrollTop: 73_621,
        observedAnchors: [
          createAnchor(7, 37_813),
          createAnchor(19, 28_337),
        ],
        failedInterpolationAttempts: 2,
      })
    );

    expect(plan).toEqual({
      method: 'proportional',
      targetPromptIndex: 12,
      scrollTop: (12 / 19) * 73_621,
      lowerAnchor: null,
      upperAnchor: null,
    });
  });

  it('clamps invalid target indexes and planned scroll positions', () => {
    const plan = planVirtualSearch(
      createInput({
        targetPromptIndex: 99,
        promptCount: 21,
        observedAnchors: [createAnchor(19, 20_000)],
      })
    );

    expect(plan.targetPromptIndex).toBe(20);
    expect(plan.scrollTop).toBe(10_000);
  });
});
