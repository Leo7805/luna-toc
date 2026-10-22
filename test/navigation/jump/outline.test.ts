/** @vitest-environment jsdom */
/** Tests Outline extraction descriptors and cache ownership. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPromptOutline,
  handlePromptNavigation,
  collapsePromptOutline,
  createPromptItem,
  resetOutline,
  scheduleBuild,
  setPromptMessages,
} from '@/navigation/jump/outline';
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

  it('renders three outline indentation levels with missing native ranks', () => {
    setPromptMessages([createMessage('prompt-three-levels')]);
    renderConversation('prompt-three-levels', [
      ['h2', 'First'],
      ['h4', 'Second without H3'],
      ['h6', 'Third without H5'],
    ]);

    const item = document.createElement('div');
    document.body.append(item);
    const { outlineList } = createPromptItem({
      item, index: 0, messageId: 'prompt-three-levels',
    });
    item.appendChild(outlineList);
    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: true });
    scheduleBuild(0, 1);
    const rows = [...outlineList.querySelectorAll<HTMLElement>('.navigator-outline-item')];
    expect(rows.map((row) => row.dataset.level)).toEqual(['1', '2', '3']);
    expect(rows.map((row) => row.textContent))
      .toEqual(['First', 'Second without H3', 'Third without H5']);
  });

  it('collapses the previous answer when another prompt is selected', () => {
    setPromptMessages([createMessage('prompt-first'), createMessage('prompt-second')]);
    renderConversation('prompt-first', [['h2', 'First heading']]);
    const first = document.createElement('div');
    document.body.append(first);
    const firstList = createPromptItem({ item: first, index: 0, messageId: 'prompt-first' }).outlineList;
    first.append(firstList);
    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: true });
    scheduleBuild(0, 1);
    expect(firstList.hidden).toBe(false);
    handlePromptNavigation(1, 0);
    expect(firstList.hidden).toBe(true);
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

  it('shows no triangle and expands/collapses on repeated row clicks', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [['h2', 'First heading']]);

    const item = document.createElement('div');
    document.body.appendChild(item);
    const { outlineList } = createPromptItem({
      item,
      index: 0,
      messageId: 'prompt-a',
    });
    item.append(outlineList);

    expect(item.querySelector('.navigator-outline-indicator')).toBeNull();
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: true });
    scheduleBuild(0, 1);

    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(outlineList.hidden).toBe(false);
    expect(outlineList.textContent).toContain('First heading');

    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(outlineList.hidden).toBe(true);
  });

  it('preserves an explicit expand request while row clicks can collapse it', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [['h2', 'Cached heading']]);
    const item = document.createElement('div');
    document.body.appendChild(item);
    const { outlineList } = createPromptItem({
      item, index: 0, messageId: 'prompt-a',
    });
    item.append(outlineList);

    expect(handlePromptNavigation(0, null, 'expand')).toEqual({ shouldBuild: true });
    scheduleBuild(0, 1);
    expect(item.getAttribute('aria-expanded')).toBe('true');

    expect(handlePromptNavigation(0, 0, 'expand')).toEqual({ shouldBuild: false });
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(outlineList.textContent).toContain('Cached heading');

    // Clicking the same directory row again collapses or expands.
    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(handlePromptNavigation(0, 0, 'expand')).toEqual({ shouldBuild: false });
    expect(item.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses only the selected outline while preserving cached headings for reopen', () => {
    setPromptMessages([createMessage('prompt-a')]);
    renderConversation('prompt-a', [['h2', 'Cached first heading']]);
    const item = document.createElement('div');
    document.body.appendChild(item);
    const outlineList = createPromptItem({ item, index: 0, messageId: 'prompt-a' }).outlineList;
    item.append(outlineList);
    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: true });
    scheduleBuild(0, 1);
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(outlineList.hidden).toBe(false);

    collapsePromptOutline(0);
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(outlineList.hidden).toBe(true);
    expect(outlineList.querySelectorAll('.navigator-outline-item')).toHaveLength(0);

    // A normal next click reopens cached headings without rebuilding or jumping.
    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: false });
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(outlineList.textContent).toContain('Cached first heading');
  });

  it('cancels a pending outline build when the same row is clicked again', () => {
    setPromptMessages([createMessage('pending-prompt')]);
    const item = document.createElement('div');
    document.body.appendChild(item);
    const { outlineList } = createPromptItem({
      item, index: 0, messageId: 'pending-prompt',
    });
    item.appendChild(outlineList);

    expect(handlePromptNavigation(0, null)).toEqual({ shouldBuild: true });
    expect(handlePromptNavigation(0, 0)).toEqual({ shouldBuild: false });

    renderConversation('pending-prompt', [['h2', 'Arrived too late']]);
    scheduleBuild(0, 1);
    expect(item.getAttribute('aria-expanded')).toBe('false');
    expect(outlineList.hidden).toBe(true);
  });

  it('keeps an outline expansion pending until a virtualized answer mounts', () => {
    vi.useFakeTimers();
    try {
      setPromptMessages([createMessage('prompt-a')]);
      const item = document.createElement('div');
      document.body.appendChild(item);
      const { outlineList } = createPromptItem({
        item, index: 0, messageId: 'prompt-a',
      });
      item.append(outlineList);

      expect(handlePromptNavigation(0, null, 'expand')).toEqual({ shouldBuild: true });
      scheduleBuild(0, 3);
      expect(item.getAttribute('aria-expanded')).toBe('false');
      expect(handlePromptNavigation(0, null, 'expand')).toEqual({ shouldBuild: false });

      renderConversation('prompt-a', [['h2', 'Late heading']]);
      vi.advanceTimersByTime(300);

      expect(item.getAttribute('aria-expanded')).toBe('true');
      expect(outlineList.textContent).toContain('Late heading');
    } finally {
      vi.useRealTimers();
    }
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
