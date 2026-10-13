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

  it('ingests newly mounted prompts post-frame, detects target, and prevents further downward writes', async () => {
    // Initial mounted prompt: #1 (index 0)
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

    const prompts = Array.from({ length: 12 }, (_, i) => ({
      id: `msg-${i + 1}`,
    }));
    // Target is prompt #9 (index 8)
    const promise = loadUntilMountedViaViewport(
      'msg-9',
      8,
      prompts,
      container
    );

    // Initial step 0 writes scrollTop = 200
    expect(container.scrollTop).toBe(200);

    // After frame 0, ChatGPT mounts prompts #7, #8, #9, #10
    const msg7El = document.createElement('div');
    msg7El.setAttribute('data-chatgpt-search-unit-key', 'msg-7:user');
    msg7El.setAttribute('data-chatgpt-search-message-ids', 'msg-7');
    document.body.appendChild(msg7El);

    const msg8El = document.createElement('div');
    msg8El.setAttribute('data-chatgpt-search-unit-key', 'msg-8:user');
    msg8El.setAttribute('data-chatgpt-search-message-ids', 'msg-8');
    document.body.appendChild(msg8El);

    const msg9El = document.createElement('div');
    msg9El.setAttribute('data-chatgpt-search-unit-key', 'msg-9:user');
    msg9El.setAttribute('data-chatgpt-search-message-ids', 'msg-9');
    document.body.appendChild(msg9El);

    const msg10El = document.createElement('div');
    msg10El.setAttribute('data-chatgpt-search-unit-key', 'msg-10:user');
    msg10El.setAttribute('data-chatgpt-search-message-ids', 'msg-10');
    document.body.appendChild(msg10El);

    // Advance frame for step 0
    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBe(msg9El);
    // Verifies that step 1 (which would have written scrollTop = 400) was prevented
    expect(container.scrollTop).toBe(200);
  });

  it('recomputes direction toward target when current mounted frontier has overshot', async () => {
    // Initial mounted prompt: #1 (index 0)
    const msg1El = document.createElement('div');
    msg1El.setAttribute('data-chatgpt-search-unit-key', 'msg-1:user');
    msg1El.setAttribute('data-chatgpt-search-message-ids', 'msg-1');
    document.body.appendChild(msg1El);

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

    const prompts = Array.from({ length: 25 }, (_, i) => ({
      id: `msg-${i + 1}`,
    }));
    // Target is prompt #9 (index 8)
    const promise = loadUntilMountedViaViewport(
      'msg-9',
      8,
      prompts,
      container
    );

    // Initial step 0 writes scrollTop = 200 (downward)
    expect(container.scrollTop).toBe(200);

    // Simulate fast movement where #1 unmounts, and ChatGPT mounts turns #15–#20 (indices 14–19)
    // while target #9 is not yet resolved
    msg1El.remove();

    for (let i = 15; i <= 20; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-chatgpt-search-unit-key', `msg-${i}:user`);
      el.setAttribute('data-chatgpt-search-message-ids', `msg-${i}`);
      document.body.appendChild(el);
    }

    // Advance frame 0: the loop ingests #15–#20, prunes unmounted #1,
    // recomputes direction to -1 (upward toward target #9),
    // and continues because physical movement occurred in step 0.
    // On the next iteration (step 1), it writes scrollTop in the reversed direction!
    await vi.advanceTimersByTimeAsync(20);

    // Step 1 should have moved in the reversed direction: 200 + (-1 * 200) = 0!
    expect(container.scrollTop).toBe(0);
    expect(container.scrollTop).not.toBe(400); // Did NOT continue downward to 400!

    // Now mount target #9
    const msg9El = document.createElement('div');
    msg9El.setAttribute('data-chatgpt-search-unit-key', 'msg-9:user');
    msg9El.setAttribute('data-chatgpt-search-message-ids', 'msg-9');
    document.body.appendChild(msg9El);

    await vi.advanceTimersByTimeAsync(20);
    const hit = await promise;
    expect(hit).toBe(msg9El);
  });

  it('terminates immediately and performs zero additional scroll writes when cancelled while awaiting rAF', async () => {
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

    let cancelled = false;
    const prompts = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i + 1}`,
    }));
    const promise = loadUntilMountedViaViewport(
      'msg-9',
      8,
      prompts,
      container,
      'jump-cancel',
      () => cancelled
    );

    // Step 0 performed one write
    expect(container.scrollTop).toBe(200);

    // Cancel while awaiting rAF
    cancelled = true;

    // Resume rAF
    await vi.advanceTimersByTimeAsync(20);

    const hit = await promise;
    expect(hit).toBeNull();
    // Zero additional viewport writes performed (scrollTop stays at 200, does not become 400)
    expect(container.scrollTop).toBe(200);
  });
});
