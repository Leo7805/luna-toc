/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseUnrenderedBoldMarkdown,
  startMarkdownBoldRepair,
} from '@/platforms/chatgpt/markdownBoldRepair';

let stopRepair: (() => void) | undefined;

afterEach(() => {
  stopRepair?.();
  stopRepair = undefined;
  document.body.innerHTML = '';
});

function mountAssistant(markdown: string): HTMLElement {
  document.body.innerHTML =
    '<article data-chatgpt-search-unit-key="turn-1:assistant">' +
    '<div class="markdown">' +
    markdown +
    '</div></article>';

  return document.querySelector<HTMLElement>(
    '[data-chatgpt-search-unit-key$=":assistant"]'
  )!;
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('parseUnrenderedBoldMarkdown', () => {
  it('parses multiple complete pairs without changing surrounding text', () => {
    expect(parseUnrenderedBoldMarkdown('before **one** and **two** after')).toEqual([
      { text: 'before ', bold: false },
      { text: 'one', bold: true },
      { text: ' and ', bold: false },
      { text: 'two', bold: true },
      { text: ' after', bold: false },
    ]);
  });

  it('rejects unmatched, empty, whitespace-padded and triple-star markers', () => {
    expect(parseUnrenderedBoldMarkdown('unclosed **bold')).toBeNull();
    expect(parseUnrenderedBoldMarkdown('empty **** marker')).toBeNull();
    expect(parseUnrenderedBoldMarkdown('** padded **')).toBeNull();
    expect(parseUnrenderedBoldMarkdown('***triple***')).toBeNull();
  });

  it('does not parse escaped markers, inline code or math syntax', () => {
    const tick = String.fromCharCode(96);
    expect(parseUnrenderedBoldMarkdown('escaped \\**literal**')).toBeNull();
    expect(parseUnrenderedBoldMarkdown('code ' + tick + '**literal**' + tick)).toBeNull();
    expect(parseUnrenderedBoldMarkdown('**x = $a$**')).toBeNull();
    expect(parseUnrenderedBoldMarkdown('**x = \\(a+b\\)**')).toBeNull();
  });

  it('does not interpret malformed nested double-star markers as bold', () => {
    expect(parseUnrenderedBoldMarkdown('**outer ** inner**')).toBeNull();
  });
});

describe('startMarkdownBoldRepair', () => {
  it('repairs paired bold markers in assistant Markdown as real strong elements', () => {
    const assistant = mountAssistant(
      '<p>This is **bold** and also **strong**.</p>'
    );

    stopRepair = startMarkdownBoldRepair();

    const strong = assistant.querySelectorAll(
      'strong[data-luna-toc-markdown-bold="true"]'
    );
    expect(strong).toHaveLength(2);
    expect(strong[0]?.textContent).toBe('bold');
    expect(strong[1]?.textContent).toBe('strong');
    expect(assistant.textContent).toBe('This is bold and also strong.');
  });

  it('preserves code, math, escaped markers and unmatched markers', () => {
    const tick = String.fromCharCode(96);
    const assistant = mountAssistant(
      '<p id="mixed">Inline ' +
        tick +
        '**inline code**' +
        tick +
        ' and **visible bold**; escaped \\**literal**; unclosed **tail</p>' +
        '<code>**code element**</code>' +
        '<pre>**code block**</pre>' +
        '<span class="katex">**math content**</span>' +
        '<p>**x = $a$**</p>'
    );

    stopRepair = startMarkdownBoldRepair();

    expect(
      assistant.querySelectorAll('strong[data-luna-toc-markdown-bold="true"]')
    ).toHaveLength(1);
    expect(assistant.querySelector('#mixed')?.textContent).toBe(
      'Inline ' +
        tick +
        '**inline code**' +
        tick +
        ' and visible bold; escaped \\**literal**; unclosed **tail'
    );
    expect(assistant.querySelector('code')?.textContent).toBe('**code element**');
    expect(assistant.querySelector('pre')?.textContent).toBe('**code block**');
    expect(assistant.querySelector('.katex')?.textContent).toBe('**math content**');
    expect(assistant.querySelectorAll('p')[1]?.textContent).toBe('**x = $a$**');
  });

  it('does not modify user text or ordinary page text outside assistant Markdown', () => {
    document.body.innerHTML =
      '<div data-message-author-role="user"><div class="markdown">**user text**</div></div>' +
      '<p>**ordinary page text**</p>' +
      '<article data-chatgpt-search-unit-key="answer:assistant"><p>**outside markdown**</p></article>';

    stopRepair = startMarkdownBoldRepair();

    expect(document.querySelector('[data-message-author-role="user"]')?.textContent)
      .toBe('**user text**');
    expect(document.querySelector('body > p')?.textContent)
      .toBe('**ordinary page text**');
    expect(document.querySelector('article p')?.textContent)
      .toBe('**outside markdown**');
  });

  it('repairs a complete marker pair after a streamed text node is updated', async () => {
    const assistant = mountAssistant('<p>**incomplete');
    const textNode = assistant.querySelector('p')?.firstChild as Text;

    stopRepair = startMarkdownBoldRepair();
    expect(assistant.querySelector('strong')).toBeNull();

    textNode.data = '**complete**';
    await flushMutations();

    expect(assistant.querySelector('strong')?.textContent).toBe('complete');
  });

  it('repairs newly mounted assistant answers and remains idempotent', async () => {
    stopRepair = startMarkdownBoldRepair();

    const assistant = document.createElement('article');
    assistant.setAttribute('data-chatgpt-search-unit-key', 'later:assistant');
    const markdown = document.createElement('div');
    markdown.className = 'markdown';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Added **later**';
    markdown.appendChild(paragraph);
    assistant.appendChild(markdown);
    document.body.appendChild(assistant);

    await flushMutations();
    await flushMutations();

    expect(assistant.querySelectorAll('strong[data-luna-toc-markdown-bold="true"]'))
      .toHaveLength(1);
    expect(assistant.textContent).toBe('Added later');
  });

  it('leaves already-rendered strong content untouched', () => {
    const assistant = mountAssistant(
      '<p><strong>**already strong**</strong> and **new bold**</p>'
    );

    stopRepair = startMarkdownBoldRepair();

    expect(assistant.querySelector('strong')?.textContent).toBe('**already strong**');
    expect(
      assistant.querySelectorAll('strong[data-luna-toc-markdown-bold="true"]')
    ).toHaveLength(1);
  });

  it('does not join marker pairs split across separate text nodes', () => {
    const assistant = mountAssistant('<p id="split"></p>');
    const paragraph = assistant.querySelector('#split')!;
    paragraph.append(
      document.createTextNode('**split'),
      document.createTextNode(' across nodes**')
    );

    stopRepair = startMarkdownBoldRepair();

    expect(paragraph.textContent).toBe('**split across nodes**');
    expect(paragraph.querySelector('strong')).toBeNull();
  });
});
