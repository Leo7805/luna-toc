/**
 * @vitest-environment jsdom
 *
 * Repeatable synthetic TOC performance workloads. Time values are diagnostics
 * for the runner, not universal browser performance guarantees.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { resetOutline } from '@/navigation/jump/outline';
import { readMountedWithSidebarIdx } from '@/platforms/chatgpt/virtualSearchAdapter';
import { setLoading } from '@/navigation/loading/promptLoadingState';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

interface TocPerformanceResult {
  workload: number;
  environment: string;
  coldRenderMs: number;
  reusedRenderMedianMs: number;
  searchMissMs: number;
  activeTransitionMedianMs: number;
  activeClassRemoveCalls: number;
  activeClassAddCalls: number;
  transitions: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function duration(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function createMessages(count: number): NavigatorMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 'perf-prompt-' + index,
    text: 'Synthetic question ' + index + ' about a long conversation',
    canMatchByText: true,
    createTime: index,
  }));
}

describe('TOC synthetic performance baseline', () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="navigator-list"></div>',
      '<div class="navigator-hint"></div>',
      '<div id="sidebar-status-band"></div>',
    ].join('');
    setLoading(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetOutline();
    document.body.innerHTML = '';
  });

  for (const workload of [100, 500, 2000]) {
    it('records initial render, reused render, search and active highlight for ' + workload + ' prompts', () => {
      const messages = createMessages(workload);
      let activeIndex = 0;
      const renderer = createTocListRenderer({
        getMessages: () => messages,
        getActiveIndex: () => activeIndex,
        onItemClick: vi.fn(),
      });

      const coldRenderMs = duration(() => renderer.render());
      const list = document.getElementById('navigator-list')!;
      expect(list.children.length).toBe(workload);

      const firstRow = renderer.getNavigatorItems()[0];
      const reusedRenderSamples = Array.from({ length: 3 }, () =>
        duration(() => renderer.render())
      );
      expect(renderer.getNavigatorItems()[0]).toBe(firstRow);

      const removeSpy = vi.spyOn(DOMTokenList.prototype, 'remove');
      const addSpy = vi.spyOn(DOMTokenList.prototype, 'add');
      const activeSamples: number[] = [];
      const transitions = 20;
      for (let iteration = 0; iteration < transitions; iteration += 1) {
        activeIndex = iteration % 2 === 0 ? workload - 1 : 0;
        activeSamples.push(duration(() => renderer.updateActiveItemUI(activeIndex, false)));
        expect(renderer.getNavigatorItems()[activeIndex]?.classList.contains('navigator-item-active')).toBe(true);
      }
      const activeClassRemoveCalls = removeSpy.mock.calls.filter(
        (args) => args.includes('navigator-item-active')
      ).length;
      const activeClassAddCalls = addSpy.mock.calls.filter(
        (args) => args.includes('navigator-item-active')
      ).length;
      removeSpy.mockRestore();
      addSpy.mockRestore();
      // The highlighted row can change without touching all other rows.
      expect(activeClassRemoveCalls).toBeLessThanOrEqual(transitions);
      expect(activeClassAddCalls).toBe(transitions);

      const searchMissMs = duration(() => renderer.setSearchQuery('synthetic-no-match-987654321'));
      expect(list.children.length).toBe(0);
      renderer.setSearchQuery('');
      expect(list.children.length).toBe(workload);
      expect(renderer.getNavigatorItems()[0]?.classList.contains('navigator-item-active')).toBe(true);

      const result: TocPerformanceResult = {
        workload,
        environment: 'Vitest/jsdom synthetic workload (runner-specific, no ChatGPT network)',
        coldRenderMs: Number(coldRenderMs.toFixed(3)),
        reusedRenderMedianMs: Number(median(reusedRenderSamples).toFixed(3)),
        searchMissMs: Number(searchMissMs.toFixed(3)),
        activeTransitionMedianMs: Number(median(activeSamples).toFixed(3)),
        activeClassRemoveCalls,
        activeClassAddCalls,
        transitions,
      };
      console.info('[LunaTOC performance] ' + JSON.stringify(result));
    });
  }

  for (const workload of [100, 500, 2000]) {
    it('records mounted prompt index lookup with a distant final ID in ' + workload + ' prompts', () => {
      const messages = createMessages(workload);
      const host = document.createElement('div');
      for (const index of [0, workload - 1]) {
        const bubble = document.createElement('div');
        bubble.setAttribute('data-chatgpt-search-unit-key', messages[index].id + ':user');
        bubble.setAttribute('data-chatgpt-search-message-ids', messages[index].id);
        host.appendChild(bubble);
      }
      document.body.appendChild(host);

      const mounted = readMountedWithSidebarIdx(messages, host);
      expect(mounted.map((entry) => entry.sidebarIdx)).toEqual([0, workload - 1]);
      const lookupSamples = Array.from({ length: 10 }, () =>
        duration(() => { readMountedWithSidebarIdx(messages, host); })
      );
      console.info('[LunaTOC mounted-index performance] ' + JSON.stringify({
        workload,
        mountedCount: 2,
        targetIndex: workload - 1,
        lookupMedianMs: Number(median(lookupSamples).toFixed(3)),
        environment: 'Vitest/jsdom; mounted ID resolution only, not a scrolling jump',
      }));
    });
  }
});
