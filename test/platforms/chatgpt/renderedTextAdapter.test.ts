/** @vitest-environment jsdom */
/** Tests ChatGPT DOM conversion to generic rendered Assistant text blocks. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChatGptObservedResponseSegments,
  getAssistantBlockId,
  getAssistantMarkdownText,
  getRenderedAssistantTextBlocks,
} from '@/platforms/chatgpt/renderedTextAdapter';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
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

  it('passes only owned Markdown containers to observed segmentation', async () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="assistant-1">
        <div class="markdown">Visible response text</div>
        <div data-message-author-role="tool">
          <div class="markdown">Tool output</div>
        </div>
      </div>
    `;
    const assistant = document.querySelector<HTMLElement>(
      '[data-message-author-role="assistant"]'
    )!;
    const markdown = assistant.querySelector<HTMLElement>('.markdown')!;
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 600 },
    });
    markdown.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 200,
        height: 100,
      }) as DOMRect;
    const textNode = markdown.firstChild as Text;
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let endOffset = 0;
      return {
        setStart: () => {},
        setEnd: (_node: Node, offset: number) => {
          endOffset = offset;
        },
        getBoundingClientRect: () =>
          ({
            top: 100,
            bottom:
              100 + (endOffset / Math.max(1, textNode.length)) * 100,
          }) as DOMRect,
      } as unknown as Range;
    });

    const segments = await createChatGptObservedResponseSegments({
      assistantElement: assistant,
      promptIndex: 2,
      scrollContainer: container,
    });

    expect(segments).toMatchObject([
      {
        responseId: 'assistant-1',
        promptIndex: 2,
        quality: 'observed',
        viewportWidth: 900,
        viewportHeight: 600,
      },
    ]);
    expect(segments[0]?.probeText).toContain('Visible');
    expect(segments[0]?.probeText).not.toContain('Tool');
  });
});
