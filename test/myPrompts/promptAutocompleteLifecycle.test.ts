/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initAutocomplete,
  initializePromptAutocomplete,
  resetAutocompleteForTesting,
} from '@/features/myPrompts/promptAutocomplete';
import { promptAutocompleteViewController } from '@/features/myPrompts/promptAutocompleteView';

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
