/** @vitest-environment jsdom */
/** Tests heading extraction, hierarchy levels, and duplicate disambiguation. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPromptOutline } from '@/navigation/jump/headingExtractor';

describe('headingExtractor', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, host: 'chatgpt.com' },
      writable: true,
    });
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  it('normalizes base heading level to 1 and child heading level to 2', () => {
    renderConversation('prompt-1', [
      ['h2', 'Main Heading'],
      ['h3', 'Sub Heading'],
      ['h4', 'Deep Sub Heading (Excluded)'],
      ['h2', 'Another Main'],
    ]);

    const outline = getPromptOutline(0, 'prompt-1');

    expect(outline.map(({ level, headingLevel, text }) => ({
      level,
      headingLevel,
      text,
    }))).toEqual([
      { level: 1, headingLevel: 2, text: 'Main Heading' },
      { level: 2, headingLevel: 3, text: 'Sub Heading' },
      { level: 1, headingLevel: 2, text: 'Another Main' },
    ]);
  });

  it('tracks occurrence indices for duplicate headings at the same level', () => {
    renderConversation('prompt-2', [
      ['h3', 'Setup'],
      ['h3', 'Setup'],
      ['h3', 'Setup'],
    ]);

    const outline = getPromptOutline(0, 'prompt-2');

    expect(outline.map(({ text, occurrence }) => ({ text, occurrence }))).toEqual([
      { text: 'Setup', occurrence: 0 },
      { text: 'Setup', occurrence: 1 },
      { text: 'Setup', occurrence: 2 },
    ]);
  });

  it('filters out headings with empty text', () => {
    renderConversation('prompt-3', [
      ['h2', '   '],
      ['h2', 'Valid Heading'],
      ['h2', ''],
    ]);

    const outline = getPromptOutline(0, 'prompt-3');

    expect(outline.map(({ text }) => text)).toEqual(['Valid Heading']);
  });

  it('returns empty array when user message or assistant message is missing', () => {
    const outline = getPromptOutline(0, 'nonexistent-prompt');
    expect(outline).toEqual([]);
  });

  it('extracts outline for a direct user -> assistant sequence', () => {
    renderConversation('prompt-basic', [
      ['h2', 'Overview'],
      ['h3', 'Deep Dive'],
    ]);

    const outline = getPromptOutline(0, 'prompt-basic');
    expect(outline.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Overview', level: 1 },
      { text: 'Deep Dive', level: 2 },
    ]);
  });

  it('isolates headings across multiple turns (user1 -> assistant1 -> user2 -> assistant2)', () => {
    const user1 = renderUserMessage('prompt-1');
    const assistant1 = renderAssistantMessage('response-1', [
      ['h2', 'Assistant 1 Heading'],
    ]);
    const user2 = renderUserMessage('prompt-2');
    const assistant2 = renderAssistantMessage('response-2', [
      ['h2', 'Assistant 2 Heading'],
    ]);

    document.body.append(user1, assistant1, user2, assistant2);

    const outline1 = getPromptOutline(0, 'prompt-1');
    const outline2 = getPromptOutline(1, 'prompt-2');

    expect(outline1.map(({ text }) => text)).toEqual(['Assistant 1 Heading']);
    expect(outline2.map(({ text }) => text)).toEqual(['Assistant 2 Heading']);
  });

  it('returns empty array when user is immediately followed by another user message (user1 -> user2)', () => {
    const user1 = renderUserMessage('prompt-unanswered');
    const user2 = renderUserMessage('prompt-answered');
    const assistant2 = renderAssistantMessage('response-2', [
      ['h2', 'Response 2 Heading'],
    ]);

    document.body.append(user1, user2, assistant2);

    const outline1 = getPromptOutline(0, 'prompt-unanswered');
    const outline2 = getPromptOutline(1, 'prompt-answered');

    expect(outline1).toEqual([]);
    expect(outline2.map(({ text }) => text)).toEqual(['Response 2 Heading']);
  });

  it('excludes accessibility-only heading when assistant has no content headings', () => {
    const user = renderUserMessage('prompt-sr-only-1');
    const assistant = document.createElement('div');
    assistant.setAttribute(
      'data-chatgpt-search-unit-key',
      'response-prompt-sr-only-1:assistant'
    );
    assistant.setAttribute(
      'data-chatgpt-search-message-ids',
      'response-prompt-sr-only-1'
    );
    assistant.innerHTML = `
      <h5 class="sr-only">ChatGPT said:</h5>
      <p>Normal answer without headings.</p>
    `;
    document.body.append(user, assistant);

    const outline = getPromptOutline(0, 'prompt-sr-only-1');
    expect(outline).toEqual([]);
  });

  it('excludes accessibility heading while preserving real content headings', () => {
    const user = renderUserMessage('prompt-sr-only-2');
    const assistant = document.createElement('div');
    assistant.setAttribute(
      'data-chatgpt-search-unit-key',
      'response-prompt-sr-only-2:assistant'
    );
    assistant.setAttribute(
      'data-chatgpt-search-message-ids',
      'response-prompt-sr-only-2'
    );
    assistant.innerHTML = `
      <h5 class="sr-only">ChatGPT said:</h5>
      <h2>Real Section</h2>
      <h3>Details</h3>
    `;
    document.body.append(user, assistant);

    const outline = getPromptOutline(0, 'prompt-sr-only-2');
    expect(outline.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Real Section', level: 1 },
      { text: 'Details', level: 2 },
    ]);
  });

  it('does not filter out a visible heading merely because of its text', () => {
    const user = renderUserMessage('prompt-sr-only-3');
    const assistant = document.createElement('div');
    assistant.setAttribute(
      'data-chatgpt-search-unit-key',
      'response-prompt-sr-only-3:assistant'
    );
    assistant.setAttribute(
      'data-chatgpt-search-message-ids',
      'response-prompt-sr-only-3'
    );
    assistant.innerHTML = `
      <h2>ChatGPT said:</h2>
      <p>Discussion about what ChatGPT said.</p>
    `;
    document.body.append(user, assistant);

    const outline = getPromptOutline(0, 'prompt-sr-only-3');
    expect(outline.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'ChatGPT said:', level: 1 },
    ]);
  });
});

function renderUserMessage(promptMessageId: string): HTMLElement {
  const userMessage = document.createElement('div');
  userMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `${promptMessageId}:user`
  );
  userMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    promptMessageId
  );
  return userMessage;
}

function renderAssistantMessage(
  responseId: string,
  headings: Array<[tagName: string, text: string]>
): HTMLElement {
  const assistantMessage = document.createElement('div');
  assistantMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `${responseId}:assistant`
  );
  assistantMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    responseId
  );

  headings.forEach(([tagName, text], index) => {
    const heading = document.createElement(tagName);
    heading.textContent = text;
    heading.dataset.sectionId = `section-${index}`;
    assistantMessage.appendChild(heading);
  });

  return assistantMessage;
}

function renderConversation(
  promptMessageId: string,
  headings: Array<[tagName: string, text: string]>
): void {
  const user = renderUserMessage(promptMessageId);
  const assistant = renderAssistantMessage(`response-${promptMessageId}`, headings);
  document.body.append(user, assistant);
}
