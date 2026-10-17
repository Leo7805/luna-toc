/** @vitest-environment jsdom */
/**
 * Tests strategy configuration, transparent viewportWalkerStrategy adapter, and virtualLayout scaffold.
 */
import { describe, expect, it, vi } from 'vitest';
import { JUMP_STRATEGY_CONFIG } from '@/navigation/jump/strategies/config';
import { executeViewportWalkerStrategy } from '@/navigation/jump/strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from '@/navigation/jump/strategies/virtualLayoutStrategy';
import * as viewportWalker from '@/navigation/jump/viewportWalker';

describe('jump strategies', () => {
  it('defines stepViewports default as 1 in internal configuration', () => {
    expect(JUMP_STRATEGY_CONFIG.viewportWalker.stepViewports).toBe(1);
  });

  it('transparently delegates to loadUntilMountedViaViewport and returns its original promise directly', async () => {
    const fakeElement = document.createElement('div');
    const loadSpy = vi
      .spyOn(viewportWalker, 'loadUntilMountedViaViewport')
      .mockResolvedValue(fakeElement);

    const isCancelled = vi.fn(() => false);
    const container = document.createElement('div');
    const prompts = [{ id: 'p-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }];

    const promise = executeViewportWalkerStrategy({
      targetMessage: prompts[0],
      targetIndex: 0,
      prompts,
      container,
      jumpId: 'test-jump',
      isCancelled,
    });

    expect(loadSpy).toHaveBeenCalledWith(
      'p-1',
      0,
      prompts,
      container,
      'test-jump',
      isCancelled
    );

    const result = await promise;
    expect(result).toBe(fakeElement);

    loadSpy.mockRestore();
  });

  it('virtualLayoutStrategy scaffold resolves to null in Step 1', async () => {
    const isCancelled = vi.fn(() => false);
    const container = document.createElement('div');
    const prompts = [{ id: 'p-1', text: 'Prompt 1', canMatchByText: true, createTime: 0 }];

    const result = await tryVirtualLayoutStrategy({
      targetMessage: prompts[0],
      targetIndex: 0,
      prompts,
      container,
      jumpId: 'test-jump',
      isCancelled,
    });

    expect(result).toBeNull();
  });
});
