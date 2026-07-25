/** @vitest-environment jsdom */
/** Tests Outline extraction descriptors and cache ownership. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPromptOutline,
  handlePromptNavigation,
  resetOutline,
  scheduleBuild,
  setPromptMessages,
} from '@/features/navigation/outline';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

beforeEach(() => {
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
  assistantTurn.dataset.turn = 'assistant';
  assistantMessage.dataset.messageAuthorRole = 'assistant';
  assistantMessage.dataset.messageId = `response-${promptMessageId}`;
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
