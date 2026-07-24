/** Tests the platform-independent virtual-list search execution loop. */
import { describe, expect, it } from 'vitest';
import {
  createDirectionalProbePlan,
  getTargetDistance,
  searchVirtualPrompt,
  type VirtualSearchObservation,
} from '@/features/navigation/virtualSearchController';
import {
  createNavigationAnchor,
  type NavigationAnchor,
} from '@/features/navigation/navigationAnchorStore';

interface FakeSearchOptions {
  targetIndex: number;
  initialIndex?: number;
  confirmedAnchors?: NavigationAnchor[];
  unresolved?: boolean;
}

function createFakeSearch({
  targetIndex,
  initialIndex = 0,
  confirmedAnchors = [],
  unresolved = false,
}: FakeSearchOptions) {
  const observedAnchors: NavigationAnchor[] = [];
  let currentScrollTop = initialIndex * 1_000;

  function getCurrentIndex(): number {
    return Math.round(currentScrollTop / 1_000);
  }

  function createCurrentObservation(): VirtualSearchObservation {
    if (unresolved) {
      return {
        position: { status: 'none' },
        anchors: [],
      };
    }

    const promptIndex = getCurrentIndex();
    const anchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: `prompt-${promptIndex}`,
      promptIndex,
      scrollTop: currentScrollTop,
      scrollHeight: 11_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });

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
            source: 'response-id',
          },
        ],
      },
      anchors: [anchor],
    };
  }

  return {
    options: {
      targetPromptId: `prompt-${targetIndex}`,
      targetPromptIndex: targetIndex,
      promptCount: 11,
      getConfirmedAnchors: async () => confirmedAnchors,
      getObservedAnchors: () => observedAnchors,
      recordObservation: (anchor: NavigationAnchor) => {
        const existingIndex = observedAnchors.findIndex(
          ({ promptId }) => promptId === anchor.promptId
        );
        if (existingIndex === -1) observedAnchors.push(anchor);
        else observedAnchors[existingIndex] = anchor;
      },
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => createCurrentObservation(),
      isTargetRendered: () => getCurrentIndex() === targetIndex,
      scrollTo: (scrollTop: number) => {
        currentScrollTop = scrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 8,
      maxDurationMs: 1_000,
    },
    getCurrentScrollTop: () => currentScrollTop,
  };
}

describe('virtual search controller', () => {
  it('measures distance from actual matches instead of their outer range', () => {
    expect(
      getTargetDistance(8, {
        status: 'located',
        firstPromptIndex: 3,
        lastPromptIndex: 26,
        matchedPromptIndexes: [3, 4, 24, 25, 26],
        matchedBlockIds: [],
        matchedBlocks: [],
      })
    ).toBe(4);
  });

  it('grows directional probes linearly up to the configured limit', () => {
    expect(
      createDirectionalProbePlan({
        targetPromptIndex: 9,
        currentScrollTop: 5_000,
        maximumScrollTop: 50_000,
        viewportHeight: 1_000,
        direction: 1,
        probeCount: 1,
      }).scrollTop
    ).toBe(7_000);
    expect(
      createDirectionalProbePlan({
        targetPromptIndex: 9,
        currentScrollTop: 5_000,
        maximumScrollTop: 50_000,
        viewportHeight: 1_000,
        direction: 1,
        probeCount: 4,
      }).scrollTop
    ).toBe(13_000);
  });

  it('returns immediately when the target is already rendered', async () => {
    const fake = createFakeSearch({ targetIndex: 3, initialIndex: 3 });

    const result = await searchVirtualPrompt(fake.options);

    expect(result).toMatchObject({
      status: 'found',
      attempts: 0,
      lastPlan: null,
    });
  });

  it('finds a target from proportional and observed anchor planning', async () => {
    const fake = createFakeSearch({ targetIndex: 8 });

    const result = await searchVirtualPrompt(fake.options);

    expect(result).toMatchObject({
      status: 'found',
      attempts: 1,
      lastPlan: {
        method: 'interpolation',
        targetPromptIndex: 8,
        scrollTop: 8_000,
      },
    });
  });

  it('ignores a stale confirmed target anchor for the current search', async () => {
    const staleAnchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-8',
      promptIndex: 8,
      scrollTop: 1_000,
      scrollHeight: 11_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });
    const fake = createFakeSearch({
      targetIndex: 8,
      confirmedAnchors: [staleAnchor],
    });

    const result = await searchVirtualPrompt({
      ...fake.options,
      isTargetRendered: () => fake.getCurrentScrollTop() >= 8_000,
    });

    expect(result.status).toBe('found');
    expect(result.attempts).toBe(4);
    expect(fake.getCurrentScrollTop()).toBe(9_000);
  });

  it('stops after repeated unresolved observations', async () => {
    const fake = createFakeSearch({
      targetIndex: 5,
      unresolved: true,
    });

    const result = await searchVirtualPrompt({
      ...fake.options,
      isTargetRendered: () => false,
      unresolvedPositionsBeforeAbort: 2,
    });

    expect(result).toMatchObject({
      status: 'unresolved',
      attempts: 1,
    });
  });

  it('returns cancelled before another search attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = createFakeSearch({ targetIndex: 5 });

    const result = await searchVirtualPrompt({
      ...fake.options,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: 'cancelled',
      attempts: 0,
    });
  });

  it('returns timed-out when the duration budget is exhausted', async () => {
    const fake = createFakeSearch({ targetIndex: 5 });
    let time = 0;

    const result = await searchVirtualPrompt({
      ...fake.options,
      isTargetRendered: () => false,
      now: () => {
        time += 600;
        return time;
      },
      maxDurationMs: 1_000,
    });

    expect(result.status).toBe('timed-out');
  });

  it('stops when every planned scroll position has already been tried', async () => {
    const fake = createFakeSearch({ targetIndex: 5 });

    const result = await searchVirtualPrompt({
      ...fake.options,
      isTargetRendered: () => false,
      observePosition: async () => ({
        position: {
          status: 'located',
          firstPromptIndex: 0,
          lastPromptIndex: 0,
          matchedPromptIndexes: [0],
          matchedBlockIds: ['response-0'],
          matchedBlocks: [
            {
              blockId: 'response-0',
              promptIndex: 0,
              source: 'response-id',
            },
          ],
        },
        anchors: [
          createNavigationAnchor({
            conversationKey: 'conversation-1',
            promptId: 'prompt-0',
            promptIndex: 0,
            scrollTop: 0,
            scrollHeight: 11_000,
            viewportWidth: 1_280,
            viewportHeight: 1_000,
          }),
        ],
      }),
    });

    expect(result.status).toBe('exhausted');
    expect(result.attempts).toBeGreaterThan(0);
  });

  it('continues forward when a long response keeps the same prompt visible', async () => {
    let currentScrollTop = 6_000;
    const scrollPositions: number[] = [];
    const staleTargetAnchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-9',
      promptIndex: 9,
      scrollTop: 6_000,
      scrollHeight: 71_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });
    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 9 }).options,
      promptCount: 25,
      getConfirmedAnchors: async () => [staleTargetAnchor],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 70_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => ({
        position: {
          status: 'located',
          firstPromptIndex: currentScrollTop >= 12_000 ? 9 : 8,
          lastPromptIndex: currentScrollTop >= 12_000 ? 9 : 8,
          matchedPromptIndexes: [currentScrollTop >= 12_000 ? 9 : 8],
          matchedBlockIds: [
            `response-${currentScrollTop >= 12_000 ? 9 : 8}`,
          ],
          matchedBlocks: [
            {
              blockId: `response-${currentScrollTop >= 12_000 ? 9 : 8}`,
              promptIndex: currentScrollTop >= 12_000 ? 9 : 8,
              source: 'fingerprint',
            },
          ],
        },
        anchors: [],
      }),
      isTargetRendered: () => currentScrollTop >= 12_000,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
        scrollPositions.push(scrollTop);
      },
      waitForRender: async () => {},
      maxAttempts: 8,
    });

    expect(result.status).toBe('found');
    expect(scrollPositions).toEqual([8_000, 12_000]);
  });

  it('keeps the growing probe step after partial prompt progress', async () => {
    let currentScrollTop = 6_000;
    let observationCount = 0;
    const scrollPositions: number[] = [];
    const observedPromptIndexes = [6, 6, 7];
    const staleTargetAnchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-12',
      promptIndex: 12,
      scrollTop: 6_000,
      scrollHeight: 71_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 12 }).options,
      promptCount: 20,
      getConfirmedAnchors: async () => [staleTargetAnchor],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 70_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex =
          observedPromptIndexes[
            Math.min(observationCount, observedPromptIndexes.length - 1)
          ]!;
        observationCount += 1;

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
          anchors: [],
        };
      },
      isTargetRendered: () => currentScrollTop >= 18_000,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
        scrollPositions.push(scrollTop);
      },
      waitForRender: async () => {},
      maxAttempts: 8,
    });

    expect(result.status).toBe('found');
    expect(scrollPositions.at(-1)).toBe(18_000);
  });

  it('uses only relative probes after the virtual scroll range is rebuilt', async () => {
    let currentScrollTop = 19_474;
    let maximumScrollTop = 59_173;
    let observationCount = 0;
    let rebuilt = false;
    const planMethods: string[] = [];
    const observedPromptIndexes = [12, 11, 10, 8, 5];

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 3 }).options,
      targetPromptIndex: 3,
      promptCount: 20,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex =
          observedPromptIndexes[
            Math.min(observationCount, observedPromptIndexes.length - 1)
          ]!;
        observationCount += 1;

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
          anchors: [],
        };
      },
      isTargetRendered: () => currentScrollTop === 0,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
      },
      waitForRender: async () => {
        if (!rebuilt) {
          rebuilt = true;
          maximumScrollTop = 82_347;
          currentScrollTop = 19_420;
        }
      },
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') {
          planMethods.push(String(details.method));
        }
      },
      maxAttempts: 8,
    });

    expect(result.status).toBe('found');
    expect(planMethods[0]).toBe('proportional');
    expect(planMethods.slice(1).every((method) => method === 'linear-probe'))
      .toBe(true);
  });

  it('slows down when the observed prompt moves close to the target', async () => {
    let currentScrollTop = 30_000;
    let observationCount = 0;
    const scrollPositions: number[] = [];
    const observedPromptIndexes = [82, 82, 78];

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 77 }).options,
      targetPromptIndex: 77,
      promptCount: 91,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 100_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex =
          observedPromptIndexes[
            Math.min(observationCount, observedPromptIndexes.length - 1)
          ]!;
        observationCount += 1;

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
          anchors: [],
        };
      },
      isTargetRendered: () => scrollPositions.length >= 3,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
        scrollPositions.push(scrollTop);
      },
      waitForRender: async () => {},
      maxAttempts: 12,
    });

    expect(result.status).toBe('found');
    expect(scrollPositions[1]! - scrollPositions[2]!).toBe(2_000);
  });

  it('reports observation, planning, scrolling, and completion events', async () => {
    const fake = createFakeSearch({ targetIndex: 8 });
    const eventNames: string[] = [];

    const result = await searchVirtualPrompt({
      ...fake.options,
      onDiagnosticEvent: ({ eventName }) => {
        eventNames.push(eventName);
      },
    });

    expect(result.status).toBe('found');
    expect(eventNames).toEqual([
      'SEARCH_STARTED',
      'POSITION_OBSERVED',
      'SEARCH_PLAN',
      'SCROLL_APPLIED',
      'SEARCH_FINISHED',
    ]);
  });
});
