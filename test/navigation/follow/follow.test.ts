/** @vitest-environment jsdom */
/** Tests Follow listener lifecycle, idempotency, stale disposer isolation, and DOM replacement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeFollow,
  isFollowing,
  keepFollowing,
  stopFollowing,
} from '@/navigation/follow/follow';

const BROWSE_EVENTS = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;

describe('follow listener lifecycle', () => {
  let list: HTMLDivElement;
  let chatArea: HTMLDivElement;
  let disposeActive: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    stopFollowing();
    document.body.innerHTML = `
      <div id="chat-area"></div>
      <div id="luna-toc-sidebar">
        <div id="navigator-list"></div>
      </div>
    `;
    list = document.getElementById('navigator-list') as HTMLDivElement;
    chatArea = document.getElementById('chat-area') as HTMLDivElement;
    disposeActive = undefined;
  });

  afterEach(() => {
    if (typeof disposeActive === 'function') {
      disposeActive();
    }
    stopFollowing();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('replaces prior listeners without duplicating when initializeFollow is called twice', () => {
    const addDocSpy = vi.spyOn(document, 'addEventListener');
    const remDocSpy = vi.spyOn(document, 'removeEventListener');
    const addListSpy = vi.spyOn(list, 'addEventListener');
    const remListSpy = vi.spyOn(list, 'removeEventListener');

    const disposeA = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    const disposeB = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    disposeActive = disposeB;

    expect(typeof disposeA).toBe('function');
    expect(typeof disposeB).toBe('function');

    // Second init must have removed first init's document scroll listener with capture: true
    expect(addDocSpy).toHaveBeenCalledTimes(2);
    expect(remDocSpy).toHaveBeenCalledTimes(1);
    expect(remDocSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      { capture: true }
    );

    // Second init must have removed all 4 browse listeners from #navigator-list before re-adding
    expect(addListSpy).toHaveBeenCalledTimes(8);
    expect(remListSpy).toHaveBeenCalledTimes(4);
    for (const eventName of BROWSE_EVENTS) {
      expect(remListSpy).toHaveBeenCalledWith(eventName, expect.any(Function));
    }
  });

  it('disposer removes the document scroll listener and all four navigator-list listeners', () => {
    const remDocSpy = vi.spyOn(document, 'removeEventListener');
    const remListSpy = vi.spyOn(list, 'removeEventListener');

    const dispose = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    expect(typeof dispose).toBe('function');

    // Active before disposal: chat scroll opens follow window; list wheel stops it
    chatArea.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(isFollowing()).toBe(true);
    list.dispatchEvent(new Event('wheel'));
    expect(isFollowing()).toBe(false);

    dispose!();

    expect(remDocSpy).toHaveBeenCalledTimes(1);
    expect(remDocSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      { capture: true }
    );
    expect(remListSpy).toHaveBeenCalledTimes(4);
    for (const eventName of BROWSE_EVENTS) {
      expect(remListSpy).toHaveBeenCalledWith(eventName, expect.any(Function));
    }

    // After disposal: chat scroll no longer opens follow window
    chatArea.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(isFollowing()).toBe(false);

    // After disposal: list wheel no longer stops an explicit keepFollowing window
    keepFollowing(1800);
    list.dispatchEvent(new Event('wheel'));
    expect(isFollowing()).toBe(true);
  });

  it('removes listeners from old navigator-list and binds new one on DOM replacement', () => {
    const oldList = list;
    const remOldListSpy = vi.spyOn(oldList, 'removeEventListener');

    initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    });

    // Replace #navigator-list DOM element
    const newList = document.createElement('div');
    newList.id = 'navigator-list';
    oldList.replaceWith(newList);

    const disposeB = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    disposeActive = disposeB;

    expect(remOldListSpy).toHaveBeenCalledTimes(4);

    // Old list no longer stops follow; new list does
    keepFollowing(1800);
    oldList.dispatchEvent(new Event('wheel'));
    expect(isFollowing()).toBe(true);

    newList.dispatchEvent(new Event('wheel'));
    expect(isFollowing()).toBe(false);
  });

  it('stale disposer A must not dispose newer initialization B, and double disposal is a no-op', () => {
    const remDocSpy = vi.spyOn(document, 'removeEventListener');
    const remListSpy = vi.spyOn(list, 'removeEventListener');

    const disposeA = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    const disposeB = initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector: '#luna-toc-sidebar',
    }) as unknown as (() => void) | undefined;
    disposeActive = disposeB;

    expect(typeof disposeA).toBe('function');
    expect(typeof disposeB).toBe('function');

    remDocSpy.mockClear();
    remListSpy.mockClear();

    // Stale disposer A must NOT remove B's listeners
    disposeA!();
    expect(remDocSpy).not.toHaveBeenCalled();
    expect(remListSpy).not.toHaveBeenCalled();

    // B's listeners remain active
    chatArea.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(isFollowing()).toBe(true);
    list.dispatchEvent(new Event('pointerdown'));
    expect(isFollowing()).toBe(false);

    // Disposing B removes B's listeners exactly once; second call is a safe no-op
    disposeB!();
    disposeB!();
    expect(remDocSpy).toHaveBeenCalledTimes(1);
    expect(remListSpy).toHaveBeenCalledTimes(4);
  });
});
