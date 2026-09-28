/** @vitest-environment jsdom */
/** Tests the active-jump progress store. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getJumpProgress,
  setJumpProgress,
  clearJumpProgress,
  setOnRender,
} from '@/navigation/loading/jumpProgressState';

describe('jumpProgressState', () => {
  beforeEach(() => {
    clearJumpProgress();
    setOnRender(() => {});
  });

  it('starts null', () => {
    expect(getJumpProgress()).toBeNull();
  });

  it('setJumpProgress stores the snapshot and notifies render', () => {
    const onRender = vi.fn();
    setOnRender(onRender);

    setJumpProgress({ active: true, targetIndex: 3, remainingSteps: 10 });

    expect(getJumpProgress()).toEqual({
      active: true,
      targetIndex: 3,
      remainingSteps: 10,
    });
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('clearJumpProgress clears and notifies render', () => {
    const onRender = vi.fn();
    setOnRender(onRender);

    setJumpProgress({ active: true, targetIndex: 3, remainingSteps: 10 });
    clearJumpProgress();

    expect(getJumpProgress()).toBeNull();
    expect(onRender).toHaveBeenCalledTimes(2); // set + clear
  });

  it('clearJumpProgress is a no-op when already null', () => {
    const onRender = vi.fn();
    setOnRender(onRender);

    clearJumpProgress();

    expect(getJumpProgress()).toBeNull();
    expect(onRender).not.toHaveBeenCalled();
  });
});