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
  it('offers rename and restore only when an alias is present', () => {
    const rename = vi.fn();
    const restore = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => [prompt],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: rename,
      onRestorePrompt: restore,
      isRenamed: () => true,
    });
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map((item) => item.label))
      .toEqual(['复制文字', '添加tips', '回到顶部', '回到底部', '修改文字', '恢复原文']);
    promptContextMenuController.select('rename-toc');
    expect(rename).toHaveBeenCalledWith(prompt);
    renderer.render();
    document.querySelector<HTMLElement>('.navigator-item')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('restore-toc');
    expect(restore).toHaveBeenCalledWith(prompt);
  });
});
