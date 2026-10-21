/** @vitest-environment jsdom */
/**
  * Tests pure data operations of the mount queue and error handling for unsupported platforms.
  */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectNewMounts,
  findTargetInQueue,
  queueSidebarIndices,
  seedMountQueue,
  type MountQueue,
} from '@/navigation/jump/mountQueue';

describe('mountQueue', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'chatgpt.com' },
      writable: true,
    });
    document.body.innerHTML = '';
  });
  it('seeds queue and detects new mounts on ChatGPT', () => {
    // Uses default jsdom location (which resolves to ChatGPT in our tests or we simulate DOM)
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
      <div data-chatgpt-search-unit-key="msg-2:user" data-chatgpt-search-message-ids="msg-2">Prompt 2</div>
    `;

    const prompts = [
      { id: 'msg-1' },
      { id: 'msg-2' },
      { id: 'msg-3' },
    ];

    const queue = seedMountQueue(prompts);
    expect(queue.size).toBe(2);
    expect(queue.has('msg-1:user')).toBe(true);
    expect(queue.has('msg-2:user')).toBe(true);
    expect(queueSidebarIndices(queue)).toEqual([0, 1]);

    // Simulate new element mounting
    const newEl = document.createElement('div');
    newEl.setAttribute('data-chatgpt-search-unit-key', 'msg-3:user');
    newEl.setAttribute('data-chatgpt-search-message-ids', 'msg-3');
    newEl.textContent = 'Prompt 3';
    document.body.appendChild(newEl);

    const fresh = detectNewMounts(queue, prompts);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].unitKey).toBe('msg-3:user');
    expect(fresh[0].sidebarIdx).toBe(2);
  });

  it('finds target in queue by message id and fallback index', () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="msg-1:user" data-chatgpt-search-message-ids="msg-1">Prompt 1</div>
    `;

    const queue: MountQueue = new Map();
    const fallbackEl = document.createElement('div');
    queue.set('placeholder:user', {
      unitKey: 'placeholder:user',
      sidebarIdx: 5,
      element: fallbackEl,
    });

    // Fast path: found in mounted DOM by id
    const foundById = findTargetInQueue(queue, 'msg-1', 0);
    expect(foundById?.getAttribute('data-chatgpt-search-message-ids')).toBe('msg-1');

    // Fallback path: not in mounted DOM by id, matched by sidebar index in queue
    const foundByIndex = findTargetInQueue(queue, 'unmounted-id', 5);
    expect(foundByIndex).toBe(fallbackEl);

    // Not found
    expect(findTargetInQueue(queue, 'missing', 99)).toBeNull();
  });

  it('rejects a host that is no longer registered', () => {
    const originalHost = window.location.host;
    try {
      Object.defineProperty(window, 'location', {
        value: { host: 'copilot.microsoft.com' },
        writable: true,
      });

      expect(() => seedMountQueue([{ id: 'prompt-1' }])).toThrow(
        'LunaTOC: no platform registered for host "copilot.microsoft.com"'
      );
      expect(() => detectNewMounts(new Map(), [{ id: 'prompt-1' }])).toThrow(
        'LunaTOC: no platform registered for host "copilot.microsoft.com"'
      );
    } finally {
      Object.defineProperty(window, 'location', {
        value: { host: originalHost },
        writable: true,
      });
    }
  });
});
