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

  it('returns target element immediately when it is already in the seed queue (zero writes)', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
      <div data-chatgpt-search-unit-key="msg-2:user" data-chatgpt-search-message-ids="msg-2">Prompt 2</div>
    `;

    const initialScrollTop = container.scrollTop;
    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const hit = await loadUntilMountedViaViewport(
      'msg-1',
      0,
      prompts,
      container
    );

    expect(hit).not.toBeNull();
    expect(hit?.getAttribute('data-chatgpt-search-message-ids')).toBe('msg-1');
    expect(container.scrollTop).toBe(initialScrollTop);
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

  it('keeps fast-scrolling through long assistant content without 500ms waits or settle path', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    Object.defineProperty(window, 'innerHeight', {
      value: 200,
      configurable: true,
    });

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Initial write at attempt 0
    expect(container.scrollTop).toBe(200);

    // Advance frame for attempt 0 -> advances to attempt 1
    await vi.advanceTimersByTimeAsync(20);
    expect(container.scrollTop).toBe(400);

    // Advance frame for attempt 1 -> advances to attempt 2
    await vi.advanceTimersByTimeAsync(20);
    expect(container.scrollTop).toBe(600);

    // Advance frame for attempt 2 -> advances to attempt 3
    await vi.advanceTimersByTimeAsync(20);
    expect(container.scrollTop).toBe(800);

    // Target mounts at attempt 3
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    document.body.appendChild(msg2El);

    // Advance frame
    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg2El);
  });

  it('stops walk and prevents next viewport write when passive observer detects target asynchronously', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    Object.defineProperty(window, 'innerHeight', {
      value: 200,
      configurable: true,
    });

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Step 0 was written
    expect(container.scrollTop).toBe(200);

    // While waiting for the frame, DOM mutation asynchronously mounts msg-2
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    document.body.appendChild(msg2El);

    // Advance frame
    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg2El);
    // Verifies that step 1 (which would have written scrollTop = 400) was prevented!
    expect(container.scrollTop).toBe(200);
  });

  it('returns target immediately when it is detected after a frame yield', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    Object.defineProperty(window, 'innerHeight', {
      value: 200,
      configurable: true,
    });

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Advance frame for step 0
    await vi.advanceTimersByTimeAsync(20);
    expect(container.scrollTop).toBe(400);

    // Mount target
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    document.body.appendChild(msg2El);

    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg2El);
  });

  it('enters boundary waiting when requested scroll cannot move scrollTop toward target', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    // Set scrollHeight = clientHeight so container cannot scroll further (stalled at boundary)
    Object.defineProperty(container, 'scrollHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    container.scrollTop = 0;

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Fast-walk attempts step, but container cannot scroll (physical delta is 0).
    // Enters handleBoundaryOrBackfillStall and boundary wait.
    // At t = 100ms into boundary wait, target mounts:
    await vi.advanceTimersByTimeAsync(100);
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    document.body.appendChild(msg2El);

    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg2El);
  });

  it('resumes fast walking when boundary expands while stalled', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    // Initially at boundary (maxScrollTop = 0)
    Object.defineProperty(container, 'scrollHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    container.scrollTop = 0;

    Object.defineProperty(window, 'innerHeight', {
      value: 200,
      configurable: true,
    });

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }, { id: 'msg-3' }];
    const promise = loadUntilMountedViaViewport(
      'msg-3',
      2,
      prompts,
      container
    );

    // Stalls at boundary. Enters boundary wait.
    await vi.advanceTimersByTimeAsync(80);

    // ChatGPT expands scrollHeight (backfill loaded turns) and adds a turn to DOM
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    const intermediateEl = document.createElement('div');
    intermediateEl.textContent = 'Expanded content';
    document.body.appendChild(intermediateEl);

    // Let boundary debounce complete
    await vi.advanceTimersByTimeAsync(20);

    // Fast walking should now resume because physical scrolling can move!
    // Step should advance scrollTop:
    await vi.advanceTimersByTimeAsync(40);
    expect(container.scrollTop).toBeGreaterThan(0);

    // Now target mounts
    const msg3El = document.createElement('div');
    msg3El.setAttribute('data-chatgpt-search-unit-key', 'msg-3:user');
    msg3El.setAttribute('data-chatgpt-search-message-ids', 'msg-3');
    document.body.appendChild(msg3El);

    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg3El);
  });

  it('terminates cleanly and disconnects observer when cancelled during fast walking or boundary wait', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    let cancelled = false;
    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container,
      'jump-1',
      () => cancelled
    );

    // Cancel while walking
    cancelled = true;
    await vi.advanceTimersByTimeAsync(50);

    const hit = await promise;
    expect(hit).toBeNull();
  });

  it('continues fast-scrolling beyond 30 viewport steps until target is reached without hitting arbitrary cap', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    Object.defineProperty(container, 'scrollHeight', {
      value: 20000,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 200,
      configurable: true,
    });

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Advance through 35 healthy viewport steps (past the old 30-attempt cap)
    for (let step = 0; step < 35; step++) {
      await vi.advanceTimersByTimeAsync(20);
    }

    // At step 35, scrollTop should be well past 30 * 200px = 6000px
    expect(container.scrollTop).toBeGreaterThan(6000);

    // Now mount the target at step 36
    const msg2El = document.createElement('div');
    msg2El.setAttribute('data-chatgpt-search-unit-key', 'msg-2:user');
    msg2El.setAttribute('data-chatgpt-search-message-ids', 'msg-2');
    document.body.appendChild(msg2El);

    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg2El);
  });

  it('terminates naturally when physical boundary is reached and backfill is exhausted', async () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    // Container is at boundary and cannot scroll
    Object.defineProperty(container, 'scrollHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    container.scrollTop = 0;

    const prompts = [{ id: 'msg-1' }, { id: 'msg-2' }];
    const promise = loadUntilMountedViaViewport(
      'msg-2',
      1,
      prompts,
      container
    );

    // Advance beyond boundary wait (5 flick writes * 10ms + 1500ms timeout)
    await vi.advanceTimersByTimeAsync(1600);

    const hit = await promise;
    expect(hit).toBeNull();
  });
});
