/** @vitest-environment jsdom */
/**
 * Tests DOM mutation quiescence waiter behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOM_SETTLE_CONFIG,
  waitForDomChange,
} from '@/navigation/jump/domSettle';

describe('waitForDomChange', () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true once mutations have ceased for the debounce window', async () => {
    const promise = waitForDomChange(root, () => false, 1500, 10);

    // Trigger mutation
    root.appendChild(document.createElement('span'));

    // Halfway through debounce
    await vi.advanceTimersByTimeAsync(5);

    // Debounce window finishes (total 10ms from mutation)
    await vi.advanceTimersByTimeAsync(5);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('resets debounce timer on subsequent mutations before resolving', async () => {
    const promise = waitForDomChange(root, () => false, 1500, 10);

    // First mutation at t = 0
    root.appendChild(document.createElement('span'));

    // At t = 8ms (before 10ms expires), second mutation occurs
    await vi.advanceTimersByTimeAsync(8);
    root.appendChild(document.createElement('div'));

    // At t = 14ms (6ms after second mutation), should not yet have resolved
    await vi.advanceTimersByTimeAsync(6);

    // At t = 18ms (10ms after second mutation), debounce window completes
    await vi.advanceTimersByTimeAsync(4);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('resolves false on total timeout when no mutations occur', async () => {
    const promise = waitForDomChange(root, () => false, 1500, 10);

    // Advance 1499ms - still waiting
    await vi.advanceTimersByTimeAsync(1499);

    // Advance to 1500ms - times out
    await vi.advanceTimersByTimeAsync(1);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolves cancelled immediately if pre-cancelled', async () => {
    const promise = waitForDomChange(root, () => true, 1500, 10);
    const result = await promise;
    expect(result).toBe('cancelled');
  });

  it('resolves cancelled during debounce when cancellation occurs', async () => {
    let cancelled = false;
    const promise = waitForDomChange(root, () => cancelled, 1500, 10);

    root.appendChild(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(5);

    cancelled = true;
    // Trigger another event or timer tick
    await vi.advanceTimersByTimeAsync(5);

    const result = await promise;
    expect(result).toBe('cancelled');
  });

  it('uses default DOM_SETTLE_CONFIG values when optional arguments are omitted', async () => {
    expect(DOM_SETTLE_CONFIG.settleMs).toBe(1500);
    expect(DOM_SETTLE_CONFIG.debounceMs).toBe(10);

    const promise = waitForDomChange(root, () => false);

    // Trigger mutation and advance by default debounceMs (10ms)
    root.appendChild(document.createElement('p'));
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result).toBe(true);
  });
});
