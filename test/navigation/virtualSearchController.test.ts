/** Tests the platform-independent virtual-list search execution loop. */
import { describe, expect, it } from 'vitest';
import {
  createDirectionalProbePlan,
  getSearchDirection,
  getTargetDistance,
  searchVirtualPrompt,
  updateSearchBounds,
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
  it('keeps the closest observed anchors around the target', () => {
    const anchors = [4, 12, 7, 10].map((promptIndex) =>
      createNavigationAnchor({
        conversationKey: 'conversation-1',
        promptId: `prompt-${promptIndex}`,
        promptIndex,
        scrollTop: promptIndex * 1_000,
        scrollHeight: 21_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      })
    );

    expect(
      updateSearchBounds({
        targetPromptIndex: 8,
        anchors,
        lowerAnchor: null,
        upperAnchor: null,
      })
    ).toMatchObject({
      lowerAnchor: { promptIndex: 7 },
      upperAnchor: { promptIndex: 10 },
    });
  });

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

  it('uses segment ratios as fractional positions inside a response', () => {
    const position = {
      status: 'located' as const,
      firstPromptIndex: 26,
      lastPromptIndex: 26,
      matchedPromptIndexes: [26],
      matchedBlockIds: ['response-26'],
      matchedBlocks: [
        {
          blockId: 'response-26',
          promptIndex: 26,
          source: 'segment' as const,
          positionRatio: 0.875,
        },
      ],
    };

    expect(getTargetDistance(28, position)).toBe(1.125);
    expect(getSearchDirection(28, position)).toBe(1);
    expect(getSearchDirection(26, position)).toBe(-1);
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

  it('scales directional probes linearly with logical Prompt distance', () => {
    expect(
      createDirectionalProbePlan({
        targetPromptIndex: 32,
        currentScrollTop: 10_000,
        maximumScrollTop: 100_000,
        viewportHeight: 1_000,
        direction: 1,
        probeCount: 1,
        promptDistance: 32,
      }).scrollTop
    ).toBe(34_000);

    expect(
      createDirectionalProbePlan({
        targetPromptIndex: 10,
        currentScrollTop: 10_000,
        maximumScrollTop: 100_000,
        viewportHeight: 1_000,
        direction: -1,
        probeCount: 10,
        promptDistance: 0.4,
      }).scrollTop
    ).toBe(9_000);
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
    expect(result.attempts).toBe(2);
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

  it('continues locally through transient unresolved virtual-list frames', async () => {
    let currentScrollTop = 50_000;
    let observationCount = 0;
    const scrollPositions: number[] = [];
    const positions = [50, null, null, 42] as const;

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 42 }).options,
      promptCount: 100,
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
          positions[Math.min(observationCount, positions.length - 1)]!;
        observationCount += 1;

        if (promptIndex === null) {
          return {
            position: { status: 'none' as const },
            anchors: [],
          };
        }

        return {
          position: {
            status: 'located' as const,
            firstPromptIndex: promptIndex,
            lastPromptIndex: promptIndex,
            matchedPromptIndexes: [promptIndex],
            matchedBlockIds: [`response-${promptIndex}`],
            matchedBlocks: [
              {
                blockId: `response-${promptIndex}`,
                promptIndex,
                source: 'fingerprint' as const,
              },
            ],
          },
          anchors: [],
        };
      },
      isTargetRendered: () => observationCount >= 4,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
        scrollPositions.push(scrollTop);
      },
      waitForRender: async () => {},
      maxAttempts: 6,
      unresolvedPositionsBeforeAbort: 2,
    });

    expect(result.status).toBe('found');
    expect(scrollPositions).toHaveLength(4);
    expect(scrollPositions[1]).toBeLessThan(scrollPositions[0]!);
    expect(scrollPositions[2]).toBeLessThan(scrollPositions[1]!);
    expect(scrollPositions[1]! - scrollPositions[2]!).toBe(1_000);
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

  it('invalidates a stale exact anchor and replans from the observed position', async () => {
    let currentScrollTop = 0;
    const invalidated: Array<[string, number]> = [];
    const plans: Array<Record<string, unknown>> = [];
    const staleTargetAnchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-8',
      promptIndex: 8,
      scrollTop: 10_000,
      scrollHeight: 21_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 8 }).options,
      promptCount: 11,
      getConfirmedAnchors: async () => [staleTargetAnchor],
      invalidateConfirmedAnchor: async (promptId, promptIndex) => {
        invalidated.push([promptId, promptIndex]);
      },
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 20_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex = currentScrollTop >= 16_000 ? 8 : 2;
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
              scrollTop: currentScrollTop,
              scrollHeight: 21_000,
              viewportWidth: 1_280,
              viewportHeight: 1_000,
            }),
          ],
        };
      },
      isTargetRendered: () => currentScrollTop >= 16_000,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 3,
      onDiagnosticEvent: (event) => {
        if (event.eventName === 'SEARCH_PLAN') plans.push(event.details);
      },
    });

    expect(result.status).toBe('found');
    expect(invalidated).toEqual([['prompt-8', 8]]);
    expect(plans[1]).toMatchObject({
      method: 'linear-probe',
      phase: 'stale-anchor-replan',
    });
  });

  it('crosses the target to discover a bracket before binary search', async () => {
    let currentScrollTop = 0;
    const phases: unknown[] = [];
    const staleTargetAnchor = createNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-8',
      promptIndex: 8,
      scrollTop: 1_000,
      scrollHeight: 21_000,
      viewportWidth: 1_280,
      viewportHeight: 1_000,
    });

    const result = await searchVirtualPrompt({
      ...createFakeSearch({ targetIndex: 8 }).options,
      promptCount: 20,
      getConfirmedAnchors: async () => [staleTargetAnchor],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 20_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => {
        const promptIndex = Math.round(currentScrollTop / 1_000);
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
              scrollTop: currentScrollTop,
              scrollHeight: 21_000,
              viewportWidth: 1_280,
              viewportHeight: 1_000,
            }),
          ],
        };
      },
      isTargetRendered: () =>
        Math.round(currentScrollTop / 1_000) === 8,
      scrollTo: (scrollTop) => {
        currentScrollTop = scrollTop;
      },
      waitForRender: async () => {},
      maxAttempts: 8,
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') phases.push(details.phase);
      },
    });

    expect(result.status).toBe('found');
    expect(phases).toContain('stale-anchor-replan');
    expect(phases).toContain('bracketed-binary-search');
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
    expect(scrollPositions.at(-1)).toBe(22_000);
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

  it('probes toward a platform target when its response is located but prompt DOM is missing', async () => {
    let currentScrollTop = 5_000;
    const scrollPositions: number[] = [];
    const planPhases: unknown[] = [];
    const targetObservation: VirtualSearchObservation = {
      position: {
        status: 'located',
        firstPromptIndex: 5,
        lastPromptIndex: 5,
        matchedPromptIndexes: [5],
        matchedBlockIds: ['response-5'],
        matchedBlocks: [
          {
            blockId: 'response-5',
            promptIndex: 5,
            source: 'response-id',
          },
        ],
      },
      anchors: [
        createNavigationAnchor({
          conversationKey: 'conversation-1',
          promptId: 'prompt-5',
          promptIndex: 5,
          scrollTop: 4_000.375,
          scrollHeight: 11_000,
          viewportWidth: 1_280,
          viewportHeight: 1_000,
        }),
      ],
    };

    const result = await searchVirtualPrompt({
      targetPromptId: 'prompt-5',
      targetPromptIndex: 5,
      promptCount: 10,
      getConfirmedAnchors: async () => [],
      getObservedAnchors: () => [],
      recordObservation: () => {},
      getScrollMetrics: () => ({
        scrollTop: currentScrollTop,
        maximumScrollTop: 10_000,
        viewportWidth: 1_280,
        viewportHeight: 1_000,
      }),
      observePosition: async () => targetObservation,
      isTargetRendered: () => currentScrollTop === 3_000.5,
      scrollTo: (scrollTop) => {
        currentScrollTop = Math.floor(scrollTop) + 0.5;
        scrollPositions.push(currentScrollTop);
      },
      waitForRender: async () => {},
      targetDomRecoveryDirection: -1,
      maxAttempts: 3,
      onDiagnosticEvent: ({ eventName, details }) => {
        if (eventName === 'SEARCH_PLAN') {
          planPhases.push(details.phase);
        }
      },
    });

    expect(result.status).toBe('found');
    expect(scrollPositions).toEqual([4_000.5, 3_000.5]);
    expect(planPhases).toEqual([
      'target-response-anchor',
      'target-dom-recovery',
    ]);
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
