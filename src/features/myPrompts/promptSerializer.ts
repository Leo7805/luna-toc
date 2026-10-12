/**
 * Serializes and deserializes saved prompts to and from Markdown format.
 */
import type { SavedPrompt } from './promptStore';

/**
 * Returns a Markdown fence that does not occur in the prompt content.
 * @param {string} content
 * @returns {string}
 */
function getMarkdownFence(content: string): string {
  const backtickRuns = content.match(/`+/g) || [];
  const longestRun = backtickRuns.reduce(
    (length, run) => Math.max(length, run.length),
    0
  );
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/**
 * Formats prompts as editable Markdown sections.
 * @param {Array<SavedPrompt>} prompts List of saved prompts to serialize.
 * @returns {string} Markdown document string containing prompt sections.
 * @example
 * ```ts
 * const markdown = formatPromptsAsMarkdown([
 *   { id: '1', title: 'Summary', content: 'Summarize this.', createdAt: 0, updatedAt: 0 }
 * ]);
 * ```
 */
export function formatPromptsAsMarkdown(prompts: SavedPrompt[]): string {
  return prompts
    .map(({ title, content }) => {
      const fence = getMarkdownFence(content);
      const closingNewline = content.endsWith('\n') ? '' : '\n';
      return `# ${title}\n\n${fence}prompt\n${content}${closingNewline}${fence}`;
    })
    .join('\n\n');
}

/**
 * Parses prompt sections from the Markdown format created by the exporter.
 * @param {string} markdown Raw Markdown content to parse.
 * @returns {Array<Pick<SavedPrompt, 'title' | 'content'>>} Array of parsed prompt titles and contents.
 * @example
 * ```ts
 * const items = parseMarkdownPrompts('# My Title\n\n```prompt\nHello\n```');
 * ```
 */
export function parseMarkdownPrompts(
  markdown: string
): Array<Pick<SavedPrompt, 'title' | 'content'>> {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const prompts: Array<Pick<SavedPrompt, 'title' | 'content'>> = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('# ')) continue;

    const title = lines[index].slice(2).trim();
    index += 1;
    while (lines[index] === '') index += 1;

    const openingFence = lines[index]?.match(/^(`{3,})prompt\s*$/);
    if (!title || !openingFence) continue;

    const fence = openingFence[1];
    const contentLines = [];
    index += 1;

    while (index < lines.length && lines[index] !== fence) {
      contentLines.push(lines[index]);
      index += 1;
    }

    if (index === lines.length) break;

    const content = contentLines.join('\n');
    if (content.trim()) {
      prompts.push({ title, content });
    }
  }

  return prompts;
}
