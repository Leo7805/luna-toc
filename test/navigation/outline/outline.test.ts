/** @vitest-environment jsdom */
/** Tests Outline extraction descriptors and cache ownership. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPromptOutline,
  handlePromptNavigation,
  resetOutline,
  scheduleBuild,
  setPromptMessages,
  syncActivePrompt,
} from '@/navigation/outline/outline';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, host: 'chatgpt.com' },
    writable: true,
  });
  if (!globalThis.CSS) {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: {
        escape: (value: string) => value.replace(/["\\]/g, '\\$&'),
      },
    });
  }
});

afterEach(() => {
  resetOutline();
  document.body.textContent = '';
});

describe('prompt outlines', () => {
  it('distinguishes duplicate headings by level and occurrence', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [
      ['h2', 'Repeated'],
      ['h2', 'Repeated'],
      ['h3', 'Repeated'],
    ]);

    const outline = getPromptOutline(0);

    expect(
      outline.map(({ headingLevel, text, occurrence }) => ({
        headingLevel,
        text,
        occurrence,
      }))
    ).toEqual([
      { headingLevel: 2, text: 'Repeated', occurrence: 0 },
      { headingLevel: 2, text: 'Repeated', occurrence: 1 },
      { headingLevel: 3, text: 'Repeated', occurrence: 0 },
    ]);
  });

  it('invalidates an outline when the prompt index receives a new message ID', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [['h2', 'Original']]);
    handlePromptNavigation(0, null);
    scheduleBuild(0, 1);

    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });

    setPromptMessages([createMessage('prompt-b')]);

    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: true });
  });

  it('rejects a disconnected cache when the current Assistant has no headings', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [['h2', 'Temporary']]);
    handlePromptNavigation(0, null);
    scheduleBuild(0, 1);

    document.body.textContent = '';
    renderConversation('prompt-a', []);

    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: true });
  });
});

describe('outline build retry timer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetOutline();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules one 300ms retry when headings are missing and cancels immediately on resetOutline', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', []);
    handlePromptNavigation(0, null);

    scheduleBuild(0, 5);
    expect(vi.getTimerCount()).toBe(1);

    resetOutline();
    expect(vi.getTimerCount()).toBe(0);

    // Populate headings later; cancelled build must never run.
    renderConversation('prompt-a', [['h2', 'Late Heading']]);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the previous build timer immediately when starting a new build', () => {
    setPromptMessages([createMessage('prompt-a'), createMessage('prompt-b')]);
    renderConversation('prompt-a', []);
    handlePromptNavigation(0, null);
    scheduleBuild(0, 5);
    expect(vi.getTimerCount()).toBe(1);

    handlePromptNavigation(1, 0);
    scheduleBuild(1, 5);

    // Only the latest build's single timer remains.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels an obsolete build retry immediately when active prompt changes via syncActivePrompt', () => {
    setPromptMessages([createMessage('prompt-a'), createMessage('prompt-b')]);
    renderConversation('prompt-a', []);
    handlePromptNavigation(0, null);
    scheduleBuild(0, 5);
    expect(vi.getTimerCount()).toBe(1);

    syncActivePrompt(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending retry when cached outline reuse handles navigation', () => {
    setPromptMessages([createMessage('prompt-a'), createMessage('prompt-b')]);
    renderConversation('prompt-a', [['h2', 'Cached Heading']]);
    handlePromptNavigation(0, null);
    scheduleBuild(0, 1);

    // Start a pending retry on prompt 0 after cache exists (simulating an
    // obsolete retry still queued), then reuse prompt 0's cached outline.
    scheduleBuild(0, 5);
    // Clear headings before scheduling a retry on prompt 1, then switch back
    // to prompt 0 via cached reuse.
    handlePromptNavigation(1, 0);
    scheduleBuild(1, 5);
    expect(vi.getTimerCount()).toBe(1);

    // Cached reuse on prompt 0 (activeIndex === 0) must cancel prompt 1's retry.
    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves zero pending timers after successful retry completion', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', []);
    handlePromptNavigation(0, null);

    scheduleBuild(0, 5);
    expect(vi.getTimerCount()).toBe(1);

    // Headings mount before the first 300ms retry fires.
    document.body.textContent = '';
    renderConversation('prompt-a', [['h2', 'Mounted Heading']]);

    vi.advanceTimersByTime(300);
    expect(vi.getTimerCount()).toBe(0);
    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });
  });

  it('leaves zero pending timers after retry exhaustion', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', []);
    handlePromptNavigation(0, null);

    scheduleBuild(0, 3);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(300); // attempt 2 -> schedules attempt 3
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(300); // attempt 3 (final) -> exhausted
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accumulate timers across rapid start -> reset -> start sequences', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', []);

    for (let i = 0; i < 4; i += 1) {
      handlePromptNavigation(0, null);
      scheduleBuild(0, 5);
      expect(vi.getTimerCount()).toBe(1);
      resetOutline();
      expect(vi.getTimerCount()).toBe(0);
    }

    handlePromptNavigation(0, null);
    scheduleBuild(0, 5);
    expect(vi.getTimerCount()).toBe(1);
  });
});

function createMessage(id: string): NavigatorMessage {
  return {
    id,
    text: '',
    canMatchByText: true,
    createTime: 0,
  };
}

function renderConversation(
  promptMessageId: string,
  headings: Array<[tagName: string, text: string]>
): void {
  const userMessage = document.createElement('div');
  const assistantMessage = document.createElement('div');

  userMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `${promptMessageId}:user`
  );
  userMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    promptMessageId
  );

  assistantMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `response-${promptMessageId}:assistant`
  );
  assistantMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    `response-${promptMessageId}`
  );

  headings.forEach(([tagName, text], index) => {
    const heading = document.createElement(tagName);

    heading.textContent = text;
    heading.dataset.sectionId = `section-${index}`;
    assistantMessage.appendChild(heading);
  });

  document.body.append(userMessage, assistantMessage);
}
