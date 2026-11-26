/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initAutocomplete,
  initializePromptAutocomplete,
  resetAutocompleteForTesting,
} from '@/features/myPrompts/promptAutocomplete';
import { promptAutocompleteViewController } from '@/features/myPrompts/promptAutocompleteView';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageMap } from '@/features/myPrompts/promptUsageStore';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

function triggerComposerInput(composer: HTMLTextAreaElement, value: string): void {
  composer.value = value;
  composer.selectionStart = value.length;
  composer.selectionEnd = value.length;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
}

function makePrompt(id: string, title: string, content: string): SavedPrompt {
  return { id, title, content, createdAt: 1, updatedAt: 1 };
}

describe('promptAutocomplete lifecycle and idempotency', () => {
  let composer: HTMLTextAreaElement;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        origin: 'https://chatgpt.com',
        href: 'https://chatgpt.com/',
      },
    });
    document.body.innerHTML = '';
    composer = document.createElement('textarea');
    composer.className = 'ProseMirror';
    composer.setAttribute('contenteditable', 'true');
    document.body.appendChild(composer);
  });

  afterEach(() => {
    resetAutocompleteForTesting();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('is idempotent on duplicate initAutocomplete calls without registering duplicate listeners', async () => {
    const getMyPromptsSpy = vi.fn().mockResolvedValue([
      { id: '1', title: 'test', content: 'test content', createdAt: 1, updatedAt: 1 },
    ]);

    initializePromptAutocomplete({
      getMyPrompts: getMyPromptsSpy,
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });

    // Call initAutocomplete multiple times
    initAutocomplete();
    initAutocomplete();
    initAutocomplete();

    // Set composer content with trigger //test
    composer.value = '//test';
    composer.selectionStart = 6;
    composer.selectionEnd = 6;

    composer.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for microtasks to resolve
    await Promise.resolve();
    await Promise.resolve();

    // Verified: getMyPrompts should be invoked exactly once, not 3 times
    expect(getMyPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates pending in-flight queries when resetAutocompleteForTesting is invoked', async () => {
    let resolvePrompts!: (prompts: any[]) => void;
    const delayedGetMyPrompts = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompts = resolve;
        })
    );

    const showSpy = vi.spyOn(promptAutocompleteViewController, 'show');

    initializePromptAutocomplete({
      getMyPrompts: delayedGetMyPrompts,
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });

    initAutocomplete();

    composer.value = '//test';
    composer.selectionStart = 6;
    composer.selectionEnd = 6;

    composer.dispatchEvent(new Event('input', { bubbles: true }));
    expect(delayedGetMyPrompts).toHaveBeenCalledTimes(1);

    // Now reset autocomplete before in-flight Promise resolves
    resetAutocompleteForTesting();

    // Now resolve the in-flight promise
    resolvePrompts([
      { id: '1', title: 'test', content: 'test content', createdAt: 1, updatedAt: 1 },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    // Verify show was never called because requestVersion was invalidated
    expect(showSpy).not.toHaveBeenCalled();
    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();
  });

  it('removes document listeners and cleans up state on reset', () => {
    const getMyPromptsSpy = vi.fn().mockResolvedValue([]);

    initializePromptAutocomplete({
      getMyPrompts: getMyPromptsSpy,
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });

    initAutocomplete();
    resetAutocompleteForTesting();

    composer.value = '//test';
    composer.selectionStart = 6;
    composer.selectionEnd = 6;
    composer.dispatchEvent(new Event('input', { bubbles: true }));

    expect(getMyPromptsSpy).not.toHaveBeenCalled();
  });
});

describe('promptAutocomplete async storage error handling (Finding #4C.2)', () => {
  let composer: HTMLTextAreaElement;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        origin: 'https://chatgpt.com',
        href: 'https://chatgpt.com/',
      },
    });
    document.body.innerHTML = '';
    composer = document.createElement('textarea');
    composer.className = 'ProseMirror';
    composer.setAttribute('contenteditable', 'true');
    document.body.appendChild(composer);
  });

  afterEach(() => {
    resetAutocompleteForTesting();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('Test A: closes stale menu and stops intercepting keys when getMyPrompts rejects', async () => {
    const prompts = [
      makePrompt('p-1', 'Test Alpha', 'Alpha body'),
      makePrompt('p-2', 'Test Beta', 'Beta body'),
    ];
    let shouldFail = false;
    const recordPromptUse = vi.fn().mockResolvedValue(undefined);

    initializePromptAutocomplete({
      getMyPrompts: vi.fn(() =>
        shouldFail
          ? Promise.reject(new Error('Storage hydration failed'))
          : Promise.resolve(prompts)
      ),
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse,
    });
    initAutocomplete();

    // Open menu with valid prompts
    triggerComposerInput(composer, '//te');
    await flushMicrotasks();
    expect(promptAutocompleteViewController.getSnapshot()?.prompts).toHaveLength(2);

    // Next input fails to read prompts -> stale menu must close cleanly
    shouldFail = true;
    triggerComposerInput(composer, '//tes');
    await flushMicrotasks();

    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();
    expect(composer.value).toBe('//tes');

    // Keyboard navigation and selection keys are no longer intercepted
    for (const key of ['ArrowDown', 'Enter', 'Tab']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      composer.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(recordPromptUse).not.toHaveBeenCalled();
  });

  it('Test B: closes current menu and preserves typing when getPromptUsage rejects', async () => {
    const prompts = [makePrompt('p-1', 'Test Alpha', 'Alpha body')];
    let failUsage = false;

    initializePromptAutocomplete({
      getMyPrompts: vi.fn().mockResolvedValue(prompts),
      getPromptUsage: vi.fn(() =>
        failUsage
          ? Promise.reject(new Error('Usage read failed'))
          : Promise.resolve<PromptUsageMap>({})
      ),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });
    initAutocomplete();

    triggerComposerInput(composer, '//te');
    await flushMicrotasks();
    expect(promptAutocompleteViewController.getSnapshot()?.prompts).toHaveLength(1);

    failUsage = true;
    triggerComposerInput(composer, '//tes');
    await flushMicrotasks();

    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();
    expect(composer.value).toBe('//tes');
  });

  it('Test C: older failed request does not close or replace a newer valid menu', async () => {
    const promptB = makePrompt('p-b', 'Beta Prompt', 'Beta content');
    let rejectRequestA!: (error: Error) => void;
    let resolveRequestB!: (prompts: SavedPrompt[]) => void;
    let callCount = 0;

    initializePromptAutocomplete({
      getMyPrompts: vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<SavedPrompt[]>((_resolve, reject) => {
            rejectRequestA = reject;
          });
        }
        return new Promise<SavedPrompt[]>((resolve) => {
          resolveRequestB = resolve;
        });
      }),
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });
    initAutocomplete();

    // Start Request A (pending), then Request B (resolves)
    triggerComposerInput(composer, '//a');
    triggerComposerInput(composer, '//b');
    resolveRequestB([promptB]);
    await flushMicrotasks();

    expect(
      promptAutocompleteViewController.getSnapshot()?.prompts.map((p) => p.id)
    ).toEqual(['p-b']);

    // Now older Request A fails -> must NOT close or disturb Request B's menu
    rejectRequestA(new Error('Stale Request A failed'));
    await flushMicrotasks();

    expect(
      promptAutocompleteViewController.getSnapshot()?.prompts.map((p) => p.id)
    ).toEqual(['p-b']);

    // Request B's menu remains interactive and usable
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(composer.value).toBe('Beta content');
  });

  it('Test D: recovers normally on a subsequent successful request with unchanged keyboard navigation', async () => {
    const prompts = [
      makePrompt('p-1', 'Test One', 'First body'),
      makePrompt('p-2', 'Test Two', 'Second body'),
    ];
    let shouldFail = true;
    const recordPromptUse = vi.fn().mockResolvedValue(undefined);

    initializePromptAutocomplete({
      getMyPrompts: vi.fn(() =>
        shouldFail
          ? Promise.reject(new Error('Transient failure'))
          : Promise.resolve(prompts)
      ),
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse,
    });
    initAutocomplete();

    // Initial failure leaves menu closed
    triggerComposerInput(composer, '//te');
    await flushMicrotasks();
    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();

    // Restore valid storage and trigger new request
    shouldFail = false;
    triggerComposerInput(composer, '//tes');
    await flushMicrotasks();

    expect(
      promptAutocompleteViewController.getSnapshot()?.prompts.map((p) => p.id)
    ).toEqual(['p-1', 'p-2']);

    // ArrowDown moves selection to second item, Enter inserts it
    const arrowDown = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(arrowDown);
    expect(arrowDown.defaultPrevented).toBe(true);
    expect(promptAutocompleteViewController.getSnapshot()?.selectedIndex).toBe(1);

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(composer.value).toBe('Second body');
    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();
    expect(recordPromptUse).toHaveBeenCalledWith('p-2');
  });

  it('Test E: stale failure after normal menu closure leaves menu closed with no stale state', async () => {
    let rejectPending!: (error: Error) => void;

    initializePromptAutocomplete({
      getMyPrompts: vi.fn(
        () =>
          new Promise<SavedPrompt[]>((_resolve, reject) => {
            rejectPending = reject;
          })
      ),
      getPromptUsage: vi.fn().mockResolvedValue({}),
      recordPromptUse: vi.fn().mockResolvedValue(undefined),
    });
    initAutocomplete();

    // Start request, then clear trigger context to close menu normally
    triggerComposerInput(composer, '//pending');
    triggerComposerInput(composer, 'plain typing');
    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();

    // Earlier pending request rejects after closure
    rejectPending(new Error('Stale rejection after close'));
    await flushMicrotasks();

    expect(promptAutocompleteViewController.getSnapshot()).toBeNull();
    expect(composer.value).toBe('plain typing');
  });
});
