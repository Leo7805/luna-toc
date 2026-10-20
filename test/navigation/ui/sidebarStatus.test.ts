/** @vitest-environment jsdom */
/** Tests the sidebar status banner state transitions, silent jumps, and timers. */
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
    expect(statusElement.textContent).toBe('加载中…');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    setSidebarStatus({ state: 'loading', promptCount: 5 });
    expect(statusElement.textContent).toBe('加载中...（已加载 5 条）');
  });

  it('renders persistent empty state without retract timer', () => {
    setSidebarStatus({ state: 'empty' });
    expect(statusElement.textContent).toBe('暂无提示词');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    vi.advanceTimersByTime(10000);
    expect(statusElement.textContent).toBe('暂无提示词');
  });

  it('keeps jump start and completion entirely silent, without shifting the list', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 2, remainingSteps: 1 },
    });
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
    expect(statusElement.querySelector('.jumping-dots')).toBeNull();

    setSidebarStatus({ state: 'complete', promptCount: 3 });
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });

  it('retracts complete state to idle after linger delay', () => {
    setSidebarStatus({ state: 'complete', promptCount: 1 });
    expect(statusElement.textContent).toBe('1 条提示词');

    vi.advanceTimersByTime(2500);
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });

  it('retracts failed jump state to idle after linger delay', () => {
    setSidebarStatus({ state: 'failed' });
    expect(statusElement.textContent).toBe('跳转失败');

    vi.advanceTimersByTime(2500);
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });
});
