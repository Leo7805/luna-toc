/** @vitest-environment jsdom */
/** Ensures edge-triggered navigation controls follow pointer height. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clampJumpControlsTop,
  initializeJumpControlsPosition,
  placeJumpControlsAtPointer,
} from '@/features/sidebar/jumpControlsPosition';

afterEach(() => { document.body.textContent = ''; sessionStorage.clear(); });

function setup(): { sidebar: HTMLElement; rail: HTMLElement } {
  document.body.innerHTML = `
    <aside id="luna-toc-sidebar">
      <div class="navigator-jump-controls">
        <button id="jump-chat-top-btn"></button>
        <button id="toggle-view-mode-btn"></button>
        <button id="jump-chat-bottom-btn"></button>
      </div>
    </aside>
  `;
  const sidebar = document.getElementById('luna-toc-sidebar')!;
  const rail = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
  Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(rail, 'offsetHeight', { configurable: true, value: 132 });
  return { sidebar, rail };
}

describe('jump control pointer positioning', () => {
  it('centers at cursor height and clamps to the viewport', () => {
    expect(clampJumpControlsTop(5, 800, 132)).toBe(12);
    expect(clampJumpControlsTop(400, 800, 132)).toBe(334);
    expect(clampJumpControlsTop(5000, 800, 132)).toBe(656);
  });
  it('updates top position and clears obsolete fixed placement', () => {
    const { sidebar, rail } = setup();
    sessionStorage.setItem('chatToc:jumpControlsBottom', '170');
    const dispose = initializeJumpControlsPosition(sidebar);
    expect(rail.style.top).toBe('334px');
    expect(sessionStorage.getItem('chatToc:jumpControlsBottom')).toBeNull();
    placeJumpControlsAtPointer(sidebar, 100);
    expect(rail.style.top).toBe('34px');
    expect(rail.style.bottom).toBe('auto');
    placeJumpControlsAtPointer(sidebar, 740);
    expect(rail.style.top).toBe('656px');
    Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 200 });
    window.dispatchEvent(new Event('resize'));
    expect(rail.style.top).toBe('56px');
    dispose();
  });
});
