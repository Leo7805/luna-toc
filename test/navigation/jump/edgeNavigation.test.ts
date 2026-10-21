/** @vitest-environment jsdom */
/**
 * Tests edgeNavigation functionality including column-reverse edge math, top-band detection, and retry settle loops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAbsoluteEdgeJump } from '@/navigation/jump/edgeNavigation';

describe('edgeNavigation', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'chatgpt.com' },
      writable: true,
    });
    document.body.innerHTML = '';

    container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    container.scrollTop = 500;
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('executeAbsoluteEdgeJump', () => {
    it('scrolls to 0 on standard layout top jump', () => {
      container.style.flexDirection = 'column';

      executeAbsoluteEdgeJump('top', { container });
      expect(container.scrollTop).toBe(0);
    });

    it('scrolls to maxScrollTop on standard layout bottom jump', () => {
      container.style.flexDirection = 'column';

      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(1200); // 2000 - 800
    });

    it('scrolls to -maxScrollTop on column-reverse layout top jump', () => {
      container.style.flexDirection = 'column-reverse';

      executeAbsoluteEdgeJump('top', { container });
      expect(container.scrollTop).toBe(-1200); // -(2000 - 800)
    });

    it('scrolls to 0 on column-reverse layout bottom jump', () => {
      container.style.flexDirection = 'column-reverse';

      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(0);
    });

    it('cancels loop immediately when isCancelled returns true', async () => {
      container.style.flexDirection = 'column';
      let cancelled = false;

      executeAbsoluteEdgeJump('top', {
        container,
        isCancelled: () => cancelled,
      });

      expect(container.scrollTop).toBe(0);
      cancelled = true;

      await vi.advanceTimersByTimeAsync(1600);
      // Loop should have exited without further actions
    });

    it('notifies onFirstPromptVisible when first prompt reaches top band (within 200px of container top)', async () => {
      container.style.flexDirection = 'column';
      const promptEl = document.createElement('div');
      promptEl.setAttribute('data-chatgpt-search-unit-key', 'first-msg:user');
      promptEl.setAttribute('data-chatgpt-search-message-ids', 'first-msg');
      document.body.appendChild(promptEl);

      container.getBoundingClientRect = vi.fn(
        () => ({ top: 100, bottom: 900 } as DOMRect)
      );
      promptEl.getBoundingClientRect = vi.fn(
        () => ({ top: 120, bottom: 200 } as DOMRect)
      );

      const onFirstPromptVisible = vi.fn();

      executeAbsoluteEdgeJump('top', {
        container,
        firstPromptId: 'first-msg',
        onFirstPromptVisible,
      });

      await vi.advanceTimersByTimeAsync(1600);

      expect(onFirstPromptVisible).toHaveBeenCalledWith(promptEl);
    });

    it('does not notify onFirstPromptVisible when first prompt is outside the top band (> 200px)', async () => {
      container.style.flexDirection = 'column';
      const promptEl = document.createElement('div');
      promptEl.setAttribute('data-chatgpt-search-unit-key', 'first-msg:user');
      promptEl.setAttribute('data-chatgpt-search-message-ids', 'first-msg');
      document.body.appendChild(promptEl);

      container.getBoundingClientRect = vi.fn(
        () => ({ top: 100, bottom: 900 } as DOMRect)
      );
      promptEl.getBoundingClientRect = vi.fn(
        () => ({ top: 400, bottom: 500 } as DOMRect) // 300px > 200px
      );

      const onFirstPromptVisible = vi.fn();

      executeAbsoluteEdgeJump('top', {
        container,
        firstPromptId: 'first-msg',
        onFirstPromptVisible,
      });

      await vi.advanceTimersByTimeAsync(1600);

      expect(onFirstPromptVisible).not.toHaveBeenCalled();
    });

    it('does not notify onFirstPromptVisible when first prompt is not mounted', async () => {
      container.style.flexDirection = 'column';
      const onFirstPromptVisible = vi.fn();

      executeAbsoluteEdgeJump('top', {
        container,
        firstPromptId: 'missing-msg',
        onFirstPromptVisible,
      });

      await vi.advanceTimersByTimeAsync(1600);

      expect(onFirstPromptVisible).not.toHaveBeenCalled();
    });

    it('settles cleanly on column-reverse bottom jump when scrollTop reaches 0', async () => {
      container.style.flexDirection = 'column-reverse';

      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(0);

      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(0);
    });

    it('re-asserts bottom target on subsequent attempt when displaced during settle delay in column-reverse layout', async () => {
      container.style.flexDirection = 'column-reverse';

      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(0);

      // Virtualizer or scroll-anchoring shifts scrollTop away from 0 during settle
      container.scrollTop = -300;

      // First settle delay completes (attempt 0). Loop notices displacement and re-asserts 0 on attempt 1.
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(0);

      // Second settle completes while container remains at 0
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(0);
    });


    it('does not pull the user back to the bottom after an upward wheel gesture', async () => {
      container.style.flexDirection = 'column';
      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(1200);

      container.scrollTop = 850;
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
      await vi.advanceTimersByTimeAsync(3100);
      expect(container.scrollTop).toBe(850);
    });

    it('does not pull the user back in column-reverse after wheel input', async () => {
      container.style.flexDirection = 'column-reverse';
      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(0);

      container.scrollTop = -350;
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
      await vi.advanceTimersByTimeAsync(3100);
      expect(container.scrollTop).toBe(-350);
    });

    it('cancels top-edge retries on a touch gesture', async () => {
      container.style.flexDirection = 'column';
      let height = 2000;
      Object.defineProperty(container, 'scrollHeight', {
        get: () => height,
        configurable: true,
      });
      executeAbsoluteEdgeJump('top', { container });
      expect(container.scrollTop).toBe(0);

      height = 2200; // Normally triggers another top-edge assertion.
      container.scrollTop = 250;
      container.dispatchEvent(new Event('touchmove', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(3100);
      expect(container.scrollTop).toBe(250);
    });

    it('cancels on a keyboard scroll gesture outside editable controls', async () => {
      container.style.flexDirection = 'column';
      executeAbsoluteEdgeJump('bottom', { container });
      container.scrollTop = 750;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(750);
    });

    it('keeps automatic correction for host scroll changes and unrelated input', async () => {
      container.style.flexDirection = 'column';
      executeAbsoluteEdgeJump('bottom', { container });
      container.scrollTop = 900;
      container.dispatchEvent(new Event('scroll'));
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(1200);
    });

    it('removes interruption listeners when the jump settles', async () => {
      container.style.flexDirection = 'column';
      const removeSpy = vi.spyOn(container, 'removeEventListener');
      executeAbsoluteEdgeJump('bottom', { container });
      await vi.advanceTimersByTimeAsync(1600);
      expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      removeSpy.mockRestore();
    });

    it('settles cleanly on standard layout bottom jump and re-asserts if displaced', async () => {
      container.style.flexDirection = 'column';

      executeAbsoluteEdgeJump('bottom', { container });
      expect(container.scrollTop).toBe(1200);

      // Displaced during settle delay
      container.scrollTop = 900;

      // Attempt 1 re-asserts 1200
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(1200);

      // Attempt 1 settle verified
      await vi.advanceTimersByTimeAsync(1600);
      expect(container.scrollTop).toBe(1200);
    });
  });
});
