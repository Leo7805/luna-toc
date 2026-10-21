/** @vitest-environment jsdom */
/** Tests the sidebar status banner state transitions, jumping dots, and timers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSidebarStatus } from '@/navigation/ui/sidebarStatus';

describe('sidebarStatus', () => {
  let statusElement: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    statusElement = document.createElement('div');
    statusElement.id = 'luna-toc-status';
    document.body.appendChild(statusElement);
  });

  afterEach(() => {
    setSidebarStatus({ state: 'idle' });
    vi.useRealTimers();
    document.body.textContent = '';
  });

  it('renders loading states for initial load and backfill progress', () => {
    setSidebarStatus({ state: 'loading', promptCount: 0 });
    expect(statusElement.textContent).toBe('Loading…');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    setSidebarStatus({ state: 'loading', promptCount: 5 });
    expect(statusElement.textContent).toBe('Loading... (5 so far)');
  });

  it('renders persistent empty state without retract timer', () => {
    setSidebarStatus({ state: 'empty' });
    expect(statusElement.textContent).toBe('No prompts');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    vi.advanceTimersByTime(10000);
    expect(statusElement.textContent).toBe('No prompts');
  });

  it('renders jumping state with animated dots DOM cluster', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 2, remainingSteps: 1 },
    });

    expect(statusElement.textContent).toContain('To #3');
    const dotsContainer = statusElement.querySelector('.jumping-dots');
    expect(dotsContainer).not.toBeNull();
    expect(dotsContainer?.querySelectorAll('.dot')).toHaveLength(3);
  });

  it('renders unified format with destination and current position (To #N · Now #M)', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 426 },
    });

    expect(statusElement.textContent).toBe('To #120 · Now #427');
  });

  it('updates text node without recreating jumping dots DOM cluster', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 426 },
    });

    const initialDots = statusElement.querySelector('.jumping-dots');
    expect(initialDots).not.toBeNull();
    expect(statusElement.textContent).toBe('To #120 · Now #427');

    // Advance progress: Now #380
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 379 },
    });

    expect(statusElement.textContent).toBe('To #120 · Now #380');
    const currentDots = statusElement.querySelector('.jumping-dots');
    // Existing DOM node identity preserved
    expect(currentDots).toBe(initialDots);
  });

  it('retracts complete state to idle after linger delay', () => {
    setSidebarStatus({ state: 'complete', promptCount: 1 });
    expect(statusElement.textContent).toBe('1 prompt');

    vi.advanceTimersByTime(2500);
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });

  it('retracts failed jump state to idle after linger delay', () => {
    setSidebarStatus({ state: 'failed' });
    expect(statusElement.textContent).toBe('Jump failed');

    vi.advanceTimersByTime(2500);
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });
});
