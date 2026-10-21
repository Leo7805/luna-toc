/** @vitest-environment jsdom */
/** Ensures the toolbar's empty reveal footprint can be repositioned vertically. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clampJumpControlsBottom,
  initializeJumpControlsPosition,
} from '@/features/sidebar/jumpControlsPosition';

afterEach(() => {
  sessionStorage.removeItem('chatToc:jumpControlsBottom');
  document.body.textContent = '';
});

function setup(): { sidebar: HTMLElement; rail: HTMLElement; button: HTMLElement } {
  document.body.innerHTML = `
    <aside id="luna-toc-sidebar">
      <div class="navigator-jump-controls"><button id="jump-chat-top-btn"></button></div>
    </aside>
  `;
  const sidebar = document.getElementById('luna-toc-sidebar')!;
  const rail = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
  const button = document.getElementById('jump-chat-top-btn')!;
  Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(rail, 'offsetHeight', { configurable: true, value: 132 });
  return { sidebar, rail, button };
}

describe('jump controls vertical repositioning', () => {
  it('clamps to the available height', () => {
    expect(clampJumpControlsBottom(5, 800, 132)).toBe(12);
    expect(clampJumpControlsBottom(5000, 800, 132)).toBe(656);
    expect(clampJumpControlsBottom(122.7, 800, 132)).toBe(123);
  });

  it('drags by the blank rail without consuming button interactions', () => {
    const { sidebar, rail, button } = setup();
    const dispose = initializeJumpControlsPosition(sidebar);
    expect(rail.style.bottom).toBe('12px');
    expect(rail.getAttribute('role')).toBe('slider');

    button.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientY: 600,
    }));
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientY: 400,
    }));
    expect(rail.style.bottom).toBe('12px');

    rail.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientY: 600,
    }));
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientY: 500,
    }));
    expect(rail.style.bottom).toBe('112px');
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(sessionStorage.getItem('chatToc:jumpControlsBottom')).toBe('112');

    rail.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    expect(rail.style.bottom).toBe('122px');
    dispose();
  });

  it('restores the position and constrains it on resize', () => {
    const { sidebar, rail } = setup();
    sessionStorage.setItem('chatToc:jumpControlsBottom', '170');
    const dispose = initializeJumpControlsPosition(sidebar);
    expect(rail.style.bottom).toBe('170px');
    Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 200 });
    window.dispatchEvent(new Event('resize'));
    expect(rail.style.bottom).toBe('56px');
    dispose();
  });
});
