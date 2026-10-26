/** @vitest-environment jsdom */
/** Verifies aliases change TOC presentation but not prompt identity or copy text. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';

const prompt: NavigatorMessage = {
  id: 'message-1',
  text: 'Original ChatGPT question',
  createTime: 1,
  canMatchByText: true,
};

beforeEach(() => {
  document.body.innerHTML = '<div id="navigator-list"></div><div class="navigator-hint"></div>';
  promptContextMenuController.close();
});

describe('renamed TOC entries', () => {
  it('shows aliases, searches both strings, navigates by the original message', () => {
    const onClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: onClick,
      getDisplayText: () => 'Short heading',
    });
    renderer.render();
    const row = document.querySelector<HTMLElement>('.navigator-item')!;
    expect(row.textContent).toContain('Short heading');
    row.click();
    expect(onClick).toHaveBeenCalledWith(prompt, 0);
    expect(prompt.text).toBe('Original ChatGPT question');
    renderer.setSearchQuery('Original ChatGPT');
    expect(document.querySelectorAll('.navigator-item')).toHaveLength(1);
    renderer.setSearchQuery('Short');
    expect(document.querySelectorAll('.navigator-item')).toHaveLength(1);
  });
  it('places inline rename third and keeps restore only for renamed entries', async () => {
    const rename = vi.fn(async () => undefined);
    const restore = vi.fn();
    const onItemClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick,
      onRenamePrompt: rename,
      onRestorePrompt: restore,
      isRenamed: () => true,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map((item) => item.label))
      .toEqual(['复制文字', '添加Tips', '编辑文字', '恢复原文']);
    promptContextMenuController.select('rename-toc');
    const input = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe(prompt.text);
    input.click();
    expect(onItemClick).not.toHaveBeenCalled();
    input.value = 'Custom display title';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(prompt, 'Custom display title'));
    await vi.waitFor(() => expect(document.querySelector('.navigator-item-inline-input')).toBeNull());
    expect(prompt.text).toBe('Original ChatGPT question');
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('restore-toc');
    expect(restore).toHaveBeenCalledWith(prompt);
  });

  it('cancels with Escape, saves on blur, and preserves the original message', async () => {
    let alias: string | null = null;
    const rename = vi.fn(async (_message: NavigatorMessage, label: string) => { alias = label; });
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: rename,
      getDisplayText: () => alias ?? prompt.text,
    });
    renderer.render();
    const open = (): HTMLTextAreaElement => {
      document.querySelector<HTMLElement>('.navigator-item')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      promptContextMenuController.select('rename-toc');
      return document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    };
    let input = open();
    input.value = 'Do not save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(rename).not.toHaveBeenCalled();
    expect(document.querySelector('.navigator-item-text')?.textContent).toBe(prompt.text);
    input = open();
    input.value = 'Saved when blurred';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(prompt, 'Saved when blurred'));
    await vi.waitFor(() => expect(document.querySelector('.navigator-item-text')?.textContent)
      .toBe('Saved when blurred'));
  });

  it('preserves drafts over navigation renders and allows retry on rejected saves', async () => {
    const rename = vi.fn()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: rename,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('rename-toc');
    let input = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    input.value = 'Retained draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    renderer.render();
    input = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    expect(input.value).toBe('Retained draft');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe('保存失败，请重试'));
    input = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    expect(input.value).toBe('Retained draft');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(document.querySelector('.navigator-item-inline-input')).toBeNull());
  });

  it('expands the textarea to the full wrapped text on open and during edits', async () => {
    const longText = 'A long line that should wrap naturally in the directory '.repeat(5);
    const renderer = createTocListRenderer({
      getMessages: () => [{ ...prompt, text: longText }],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: async () => undefined,
    });
    const height = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true, get() { return this.value.length > 160 ? 180 : 60; },
    });
    try {
      renderer.render();
      document.querySelector<HTMLElement>('.navigator-item')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(promptContextMenuController.getSnapshot()?.items[2]?.label).toBe('编辑文字');
      promptContextMenuController.select('rename-toc');
      const editor = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
      expect(editor.tagName).toBe('TEXTAREA');
      expect(editor.value).toBe(longText);
      expect(editor.rows).toBe(1);
      expect(editor.getAttribute('aria-multiline')).toBe('true');
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(editor.style.height).toBe('182px');
      editor.value = 'Short title';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      expect(editor.style.height).toBe('62px');
    } finally {
      if (height) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', height);
      else delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('supports Shift+Enter for a line break and Enter to save', async () => {
    const rename = vi.fn(async () => undefined);
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: rename,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('rename-toc');
    const editor = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    const multiline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(multiline);
    expect(multiline.defaultPrevented).toBe(false);
    expect(rename).not.toHaveBeenCalled();
    editor.value = 'First line\nSecond line';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(prompt, 'First line\nSecond line'));
  });

  it('closes the editor when the conversation is reset without saving', () => {
    const rename = vi.fn(async () => undefined);
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: rename,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('rename-toc');
    const input = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    input.value = 'Unsaved';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    renderer.resetList();
    renderer.render();
    expect(document.querySelector('.navigator-item-inline-input')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });
  it('preserves an editor draft when saving fails', async () => {
    let displayed = 'Old alias';
    const rename = vi.fn(async () => { throw new Error('storage unavailable'); });
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      getDisplayText: () => displayed,
      isRenamed: () => true,
      onRenamePrompt: rename,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('rename-toc');
    const editor = document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')!;
    displayed = 'Updated elsewhere';
    renderer.render();
    editor.value = 'My draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(prompt, 'My draft'));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain('保存失败'));
    expect(document.querySelector<HTMLTextAreaElement>('.navigator-item-inline-input')?.value)
      .toBe('My draft');
  });

  it('shows a restore error without changing the current view', async () => {
    let label = 'Alias at menu open';
    const restore = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      getDisplayText: () => label,
      isRenamed: () => true,
      onRestorePrompt: restore,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    label = 'Updated';
    promptContextMenuController.select('restore-toc');
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(prompt));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain('恢复原文失败'));
  });

});
