/** @vitest-environment jsdom */
/** Tests outline cache retention, invalidation on message ID change, and connectedness checks. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cachePromptOutline,
  clearOutlineCache,
  getCachedEntries,
  getPromptMessageId,
  getReusablePromptOutline,
  setPromptMessages,
} from '@/navigation/jump/outlineCache';
import type { OutlineEntry } from '@/navigation/jump/headingExtractor';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

function createHeadingEntry(text: string, isConnected = true): OutlineEntry {
  const element = document.createElement('h2');
  element.textContent = text;
  element.dataset.sectionId = 'sec-0';
  if (isConnected) {
    document.body.appendChild(element);
  }
  return {
    level: 1,
    headingLevel: 2,
    text,
    occurrence: 0,
    element,
    sectionId: 'sec-0',
  };
}

function createMessage(id: string): NavigatorMessage {
  return {
    id,
    text: '',
    canMatchByText: true,
    createTime: 0,
  };
}

describe('outlineCache', () => {
  afterEach(() => {
    clearOutlineCache();
    document.body.textContent = '';
  });

  it('stores and retrieves cached entries when prompt message ID exists', () => {
    setPromptMessages([createMessage('msg-1')]);
    expect(getPromptMessageId(0)).toBe('msg-1');

    const entry = createHeadingEntry('Title');
    const cached = cachePromptOutline(0, [entry]);

    expect(cached).toBe(true);
    expect(getCachedEntries(0)).toEqual([entry]);
  });

  it('reuses cache when elements remain connected', () => {
    setPromptMessages([createMessage('msg-1')]);
    const entry = createHeadingEntry('Connected Heading', true);
    cachePromptOutline(0, [entry]);

    const refreshFn = vi.fn();
    const reusable = getReusablePromptOutline(0, refreshFn);

    expect(reusable).not.toBeNull();
    expect(reusable?.entries).toEqual([entry]);
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('refreshes cache when heading elements become disconnected', () => {
    setPromptMessages([createMessage('msg-1')]);
    const staleEntry = createHeadingEntry('Stale Heading', false); // disconnected
    cachePromptOutline(0, [staleEntry]);

    const freshEntry = createHeadingEntry('Fresh Heading', true);
    const refreshFn = vi.fn(() => [freshEntry]);
    const reusable = getReusablePromptOutline(0, refreshFn);

    expect(refreshFn).toHaveBeenCalledOnce();
    expect(reusable?.entries).toEqual([freshEntry]);
    expect(getCachedEntries(0)).toEqual([freshEntry]);
  });

  it('invalidates cache and returns invalidated indices when prompt receives a different message ID', () => {
    setPromptMessages([createMessage('msg-original')]);
    const entry = createHeadingEntry('Original', true);
    cachePromptOutline(0, [entry]);

    const invalidated = setPromptMessages([createMessage('msg-updated')]);

    expect(invalidated).toEqual([0]);
    expect(getCachedEntries(0)).toEqual([]);
  });

  it('invalidates connected headings when assistant answer changes', () => {
    setPromptMessages([{ ...createMessage('prompt-1'), answerId: 'answer-1' }]);
    cachePromptOutline(0, [createHeadingEntry('Old answer')]);
    const invalidated = setPromptMessages([
      { ...createMessage('prompt-1'), answerId: 'answer-2' },
    ]);
    expect(invalidated).toEqual([0]);
    expect(getCachedEntries(0)).toEqual([]);
  });

  it('clears all cached entries and message IDs on clearOutlineCache', () => {
    setPromptMessages([createMessage('msg-1')]);
    cachePromptOutline(0, [createHeadingEntry('Heading')]);

    clearOutlineCache();

    expect(getPromptMessageId(0)).toBeNull();
    expect(getCachedEntries(0)).toEqual([]);
  });
});
