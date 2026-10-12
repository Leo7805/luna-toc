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

  it('returns empty array when user message or assistant turn is missing', () => {
    const outline = getPromptOutline(0, 'nonexistent-prompt');
    expect(outline).toEqual([]);
  });
});

function renderConversation(
  promptMessageId: string,
  headings: Array<[tagName: string, text: string]>
): void {
  const userWrapper = document.createElement('div');
  const userTurn = document.createElement('section');
  const userMessage = document.createElement('div');
  const assistantWrapper = document.createElement('div');
  const assistantTurn = document.createElement('section');
  const assistantMessage = document.createElement('div');
  const markdown = document.createElement('div');

  userTurn.dataset.turn = 'user';
  userMessage.dataset.messageAuthorRole = 'user';
  userMessage.dataset.messageId = promptMessageId;
  userMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `${promptMessageId}:user`
  );
  userMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    promptMessageId
  );

  assistantTurn.dataset.turn = 'assistant';
  assistantMessage.dataset.messageAuthorRole = 'assistant';
  assistantMessage.dataset.messageId = `response-${promptMessageId}`;
  assistantMessage.setAttribute(
    'data-chatgpt-search-unit-key',
    `response-${promptMessageId}:assistant`
  );
  assistantMessage.setAttribute(
    'data-chatgpt-search-message-ids',
    `response-${promptMessageId}`
  );
  markdown.className = 'markdown';

  headings.forEach(([tagName, text], index) => {
    const heading = document.createElement(tagName);
    heading.textContent = text;
    heading.dataset.sectionId = `section-${index}`;
    markdown.appendChild(heading);
  });

  userTurn.appendChild(userMessage);
  userWrapper.appendChild(userTurn);
  assistantMessage.appendChild(markdown);
  assistantTurn.appendChild(assistantMessage);
  assistantWrapper.appendChild(assistantTurn);
  document.body.append(userWrapper, assistantWrapper);
}
