/**
 * Produces text that can be compared across raw content and rendered UI.
 */

/**
 * Removes payloads that are visible differently in rendered Markdown.
 *
 * @example
 * stripMarkdownPayloads('[OpenAI](https://openai.com)') === 'OpenAI';
 */
export function stripMarkdownPayloads(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*]\[[^\]]*]/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\[[^\]]*]/g, '$1')
    .replace(/^[ \t]*\[[^\]]+]:\s+\S+.*$/gm, ' ')
    .replace(/^[ \t]*(?:```|~~~)[^\r\n]*$/gm, ' ')
    .replace(/(?:https?|ftp):\/\/[^\s<>)\]]+/giu, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/**
 * Collapses whitespace and trims comparable text.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Keeps Unicode letters and numbers while discarding formatting symbols.
 *
 * @example
 * normalizeComparableText('## **安装 Vite**') === '安装 Vite';
 */
export function normalizeComparableText(text: string): string {
  const textWithoutPayloads = stripMarkdownPayloads(text.normalize('NFKC'));
  const lettersAndNumbers = textWithoutPayloads.replace(
    /[^\p{L}\p{N}]+/gu,
    ' '
  );

  return normalizeWhitespace(lettersAndNumbers);
}
