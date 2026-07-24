/** Tests the platform-independent virtual-list search execution loop. */
import { describe, expect, it } from 'vitest';
import {
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

    const result = await searchVirtualPrompt(fake.options);

    expect(result.status).toBe('found');
    expect(result.attempts).toBe(2);
    expect(fake.getCurrentScrollTop()).toBe(8_000);
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
});
