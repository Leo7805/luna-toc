/** Tests adaptive virtual-list search orchestration. */
import { describe, expect, it } from 'vitest';
import {
  getClosestLogicalPosition,
  getInteriorRecoveryDirection,
  searchVirtualPrompt,
  type VirtualSearchObservation,
} from '@/navigation/jump/virtualSearchController';
import { createNavigationAnchor } from '@/navigation/jump/navigationAnchorStore';

function createLocatedObservation(
  promptIndex: number,
  scrollTop: number
): VirtualSearchObservation {
  return {
    position: {
      status: 'located',
      firstPromptIndex: promptIndex,
      lastPromptIndex: promptIndex,
      matchedPromptIndexes: [promptIndex],
      matchedBlockIds: [`response-${promptIndex}`],
      matchedBlocks: [
        {
          blockId: `response-${promptIndex}`,
          promptIndex,
          source: 'fingerprint',
        },
      ],
    },
    anchors: [
      createNavigationAnchor({
        conversationKey: 'conversation-1',
        promptId: `prompt-${promptIndex}`,
        promptIndex,
        scrollTop,
        scrollHeight: 101_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
    ],
  };
}

describe('adaptive virtual search controller', () => {
  it('selects the closest fractional logical position', () => {
    expect(
      getClosestLogicalPosition(8, {
        status: 'located',
        firstPromptIndex: 3,
        lastPromptIndex: 10,
        matchedPromptIndexes: [3, 10],
        matchedBlockIds: ['a', 'b'],
        matchedBlocks: [
          {
            blockId: 'a',
            promptIndex: 3,
            source: 'fingerprint',
          },
          {
            blockId: 'b',
            promptIndex: 10,
            source: 'segment',
            positionRatio: 0.25,
          },
        ],
      })
    ).toBe(10.25);
  });

  it('chooses an inward recovery direction at either list edge', () => {
    expect(getInteriorRecoveryDirection(24, 25)).toBe(-1);
    expect(getInteriorRecoveryDirection(0, 25)).toBe(1);
  });

  it('uses live relative feedback after the initial absolute estimate', async () => {
    let scrollTop = 90_000;
    let rendered = false;
    const phases: unknown[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-20',
      targetPromptIndex: 20,
      promptCount: 100,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 100_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex = Math.round(scrollTop / 1_000);
        if (promptIndex === 20) rendered = true;
        return createLocatedObservation(promptIndex, scrollTop);
      },
      isTargetRendered: () => rendered,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 8,
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') phases.push(details.phase);
      },
    });

    expect(result.status).toBe('found');
    expect(phases[0]).toBe('initial-estimate');
    expect(phases).not.toContain('bracketed-binary-search');
  });

  it('keeps prompt mounting isolated from response seeking', async () => {
    let scrollTop = 5_000;
    const phases: unknown[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-5',
      targetPromptIndex: 5,
      promptCount: 10,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        return scrollTop >= 4_050
          ? createLocatedObservation(5, scrollTop)
          : createLocatedObservation(4, scrollTop);
      },
      isTargetRendered: () => scrollTop <= 4_050,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
      },
      waitForRender: async () => {},
      targetDomRecoveryDirection: -1,
      maxAttempts: 6,
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') phases.push(details.phase);
      },
    });

    expect(result.status).toBe('found');
    expect(phases).toEqual([
      'mount-prompt',
      'mount-prompt',
      'mount-prompt',
    ]);
  });

  it('nudges inward when an unresolved initial hint equals the edge', async () => {
    let scrollTop = 10_000;
    let observationCount = 0;
    const phases: unknown[] = [];
    const confirmed = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-10',
      promptIndex: 10,
      scrollTop,
      scrollHeight: 11_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-10',
      targetPromptIndex: 10,
      promptCount: 11,
      getConfirmedAnchors: async () => [confirmed],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        observationCount += 1;
        return observationCount === 1
          ? { position: { status: 'none' }, anchors: [] }
          : createLocatedObservation(10, scrollTop);
      },
      isTargetRendered: () => observationCount >= 2,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 3,
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') phases.push(details.phase);
      },
    });

    expect(result.status).toBe('found');
    expect(phases).toEqual(['initial-mount-recovery']);
    expect(scrollTop).toBe(9_000);
  });

  it('recovers upward after a learned estimate overshoots the bottom edge', async () => {
    let scrollTop = 2_000;
    let rendered = false;
    const plannedScrollTops: number[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-21',
      targetPromptIndex: 21,
      promptCount: 25,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        if (scrollTop === 2_000) {
          return createLocatedObservation(8, scrollTop);
        }
        if (scrollTop === 8_750) {
          return createLocatedObservation(13, scrollTop);
        }
        return { position: { status: 'none' }, anchors: [] };
      },
      isTargetRendered: () => rendered,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
        plannedScrollTops.push(nextScrollTop);
        if (nextScrollTop === 9_000) rendered = true;
      },
      waitForRender: async () => {},
      maxAttempts: 5,
    });

    expect(result.status).toBe('found');
    expect(plannedScrollTops).toEqual([8_750, 10_000, 9_000]);
  });

  it('continues inward across multiple unresolved viewports', async () => {
    let scrollTop = 2_000;
    let rendered = false;
    const plannedScrollTops: number[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-21',
      targetPromptIndex: 21,
      promptCount: 25,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        if (scrollTop === 2_000) {
          return createLocatedObservation(8, scrollTop);
        }
        if (scrollTop === 8_750) {
          return createLocatedObservation(13, scrollTop);
        }
        return { position: { status: 'none' }, anchors: [] };
      },
      isTargetRendered: () => rendered,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
        plannedScrollTops.push(nextScrollTop);
        if (nextScrollTop === 7_000) rendered = true;
      },
      waitForRender: async () => {},
      maxAttempts: 8,
      maxUnproductiveAttempts: 6,
    });

    expect(result.status).toBe('found');
    expect(plannedScrollTops).toEqual([
      8_750,
      10_000,
      9_000,
      8_000,
      7_000,
    ]);
  });

  it('recovers downward after a learned estimate overshoots the top edge', async () => {
    let scrollTop = 8_000;
    let rendered = false;
    const plannedScrollTops: number[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-3',
      targetPromptIndex: 3,
      promptCount: 25,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        if (scrollTop === 8_000) {
          return createLocatedObservation(16, scrollTop);
        }
        if (scrollTop === 1_250) {
          return createLocatedObservation(12, scrollTop);
        }
        return { position: { status: 'none' }, anchors: [] };
      },
      isTargetRendered: () => rendered,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
        plannedScrollTops.push(nextScrollTop);
        if (nextScrollTop === 1_000) rendered = true;
      },
      waitForRender: async () => {},
      maxAttempts: 5,
    });

    expect(result.status).toBe('found');
    expect(plannedScrollTops).toEqual([1_250, 0, 1_000]);
  });

  it('reports diagnostic context when Prompt mounting is exhausted', async () => {
    let scrollTop = 500_000;
    const eventNames: string[] = [];

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-5',
      targetPromptIndex: 5,
      promptCount: 10,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop,
        maximumScrollTop: 1_000_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () =>
        createLocatedObservation(5, scrollTop),
      isTargetRendered: () => false,
      scrollTo: (nextScrollTop) => {
        scrollTop = nextScrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 20,
      onDiagnosticEvent: ({ eventName }) => {
        eventNames.push(eventName);
      },
    });

    expect(result.status).toBe('exhausted');
    expect(eventNames).toContain('PROMPT_MOUNT_EXHAUSTED');
  });
});
