/** @vitest-environment jsdom */
/**
 * Tests observable behavior of loadUntilMountedViaViewport through its public entry point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUntilMountedViaViewport } from '@/navigation/jump/viewportWalker';

describe('viewportWalker', () => {
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
    container.scrollTop = 0;
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns target element immediately when it is already in the seed queue', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
      <div data-chatgpt-search-unit-key="msg-2:user" data-chatgpt-search-message-ids="msg-2">Prompt 2</div>
    `;

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const hit = await loadUntilMountedViaViewport(
      'msg-1',
      0,
      prompts,
      container
    );

    expect(hit).not.toBeNull();
    expect(hit?.getAttribute('data-chatgpt-search-message-ids')).toBe('msg-1');
  });

  it('returns null immediately when the mount queue cannot be seeded', async () => {
    // No mounted messages in DOM
    const prompts = [{ id: 'msg-1' }];
    const hit = await loadUntilMountedViaViewport(
      'msg-1',
      0,
      prompts,
      container
    );

    expect(hit).toBeNull();
  });

  it('returns null when the cancellation predicate returns true', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const hit = await loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container,
      'jump-1',
      () => true
    );

    expect(hit).toBeNull();
  });

  it('steps scroll container toward unmounted target and finds it when mounted', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Initial step should advance scrollTop
    expect(container.scrollTop).toBeGreaterThanOrEqual(0);

    // Mount the target message
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    msg2El.textContent = 'Prompt 2';
    document.body.appendChild(msg2El);

    // Advance timers so MutationObserver and debounce execute
    await vi.advanceTimersByTimeAsync(50);

    const hit = await promise;
    expect(hit).not.toBeNull();
    expect(hit?.getAttribute('data-chatgpt-search-message-ids')).toBe('msg-2');
  });
});
