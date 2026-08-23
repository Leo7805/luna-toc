/** Tests comparable text shared by derived and observed fingerprints. */
import { describe, expect, it } from 'vitest';
import {
  normalizeComparableText,
  normalizeWhitespace,
  stripMarkdownPayloads,
} from '@/navigation/fingerprint/comparableText';

describe('comparable text', () => {
  it('keeps Unicode letters and numbers while removing formatting symbols', () => {
    expect(
      normalizeComparableText(
        '## **安装 Vite 2**\n> _Fast_ — `const value = 1;`'
      )
    ).toBe('安装 Vite 2 Fast const value 1');
  });

  it('keeps link labels while removing link destinations and plain URLs', () => {
    expect(
      normalizeComparableText(
        'Read [OpenAI](https://openai.com/docs) or https://example.com now'
      )
    ).toBe('Read OpenAI or now');
  });

  it('removes Markdown images and their payloads', () => {
    expect(
      normalizeComparableText(
        'Before ![diagram](https://example.com/image.png) after'
      )
    ).toBe('Before after');
  });

  it('removes code fences but keeps code identifiers and numbers', () => {
    expect(
      normalizeComparableText('```ts\nconst total = value + 2;\n```')
    ).toBe('const total value 2');
  });

  it('normalizes full-width characters and whitespace', () => {
    expect(normalizeComparableText('ＡＢＣ　１２３\n测试')).toBe(
      'ABC 123 测试'
    );
    expect(normalizeWhitespace(' one\n\t two ')).toBe('one two');
  });

  it('produces the same text for raw Markdown and rendered text', () => {
    const rawMarkdown =
      '## **Install [Vite](https://vite.dev)** with `npm 10`';
    const renderedText = 'Install Vite with npm 10';

    expect(normalizeComparableText(rawMarkdown)).toBe(
      normalizeComparableText(renderedText)
    );
  });

  it('returns empty text when content contains only symbols', () => {
    expect(normalizeComparableText('*** --- ### +++')).toBe('');
  });

  it('removes reference payloads and raw HTML wrappers', () => {
    const text = stripMarkdownPayloads(
      '<strong>[Docs][docs]</strong>\n[docs]: https://example.com'
    );

    expect(normalizeComparableText(text)).toBe('Docs');
  });
});
