/** @vitest-environment jsdom */
/** Tests ChatGPT DOM conversion to generic rendered Assistant text blocks. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getAssistantBlockId,
  getAssistantMarkdownText,
  getRenderedAssistantTextBlocks,
} from '@/platforms/chatgpt/renderedTextAdapter';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ChatGPT rendered text adapter', () => {
  it('extracts mounted Assistant Markdown in DOM order', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">
        <div class="markdown">User prompt</div>
      </div>
      <section data-turn="assistant">
        <div data-message-author-role="assistant" data-message-id="assistant-1">
          <div class="markdown"><p>First answer</p></div>
        </div>
      </section>
      <section data-turn="assistant">
        <div data-message-author-role="assistant" data-message-id="assistant-2">
          <div class="markdown"><p>Second answer</p></div>
        </div>
      </section>
    `;

    expect(getRenderedAssistantTextBlocks()).toEqual([
      { id: 'assistant-1', text: 'First answer' },
      { id: 'assistant-2', text: 'Second answer' },
    ]);
  });

  it('joins multiple top-level Markdown blocks for one Assistant message', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="assistant-1">
        <div class="markdown">Short preface</div>
        <div class="markdown">
          <h2>Heading</h2>
          <p>Final answer</p>
        </div>
      </div>
    `;

    expect(getRenderedAssistantTextBlocks()).toEqual([
      {
        id: 'assistant-1',
        text: 'Short preface\nHeading\n          Final answer',
      },
    ]);
  });

  it('excludes nested tool Markdown, attachments, and image content', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="assistant-1">
        <div class="attachment">report.pdf</div>
        <img alt="Generated image" />
        <div data-message-author-role="tool">
          <div class="markdown">Tool output</div>
        </div>
        <div class="markdown">Visible answer</div>
      </div>
      <div data-message-author-role="assistant" data-message-id="tool-only">
        <div data-message-author-role="tool">
          <div class="markdown">Only tool output</div>
        </div>
      </div>
    `;

    expect(getRenderedAssistantTextBlocks()).toEqual([
      { id: 'assistant-1', text: 'Visible answer' },
    ]);
  });

  it('ignores empty Markdown and Assistant nodes without Markdown', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="empty">
        <div class="markdown">   </div>
      </div>
      <div data-message-author-role="assistant" data-message-id="image-only">
        <img alt="Image" />
      </div>
    `;

    expect(getRenderedAssistantTextBlocks()).toEqual([]);
  });

  it('uses an ancestor message ID before the scan fallback ID', () => {
    document.body.innerHTML = `
      <section data-message-id="ancestor-id">
        <div data-message-author-role="assistant">
          <div class="markdown">Answer</div>
        </div>
      </section>
      <div data-message-author-role="assistant">
        <div class="markdown">Fallback answer</div>
      </div>
    `;
    const assistants = document.querySelectorAll<HTMLElement>(
      '[data-message-author-role="assistant"]'
    );

    expect(getAssistantBlockId(assistants[0]!, 0)).toBe('ancestor-id');
    expect(getAssistantBlockId(assistants[1]!, 1)).toBe(
      'chatgpt-assistant-1'
    );
  });

  it('does not count nested Markdown containers twice', () => {
    const assistant = document.createElement('div');
    assistant.dataset.messageAuthorRole = 'assistant';
    assistant.innerHTML = `
      <div class="markdown">
        Outer text
        <div class="markdown">Nested text</div>
      </div>
    `;

    expect(getAssistantMarkdownText(assistant)).toContain('Outer text');
    expect(
      getAssistantMarkdownText(assistant).match(/Nested text/g)
    ).toHaveLength(1);
  });
});
