/** Tests the TOC rename dialog's imperative state bridge. */
import { describe, expect, it, vi } from 'vitest';
import { tocRenameEditorController } from '@/features/conversationPrompts/tocRenameEditor';

describe('TOC rename editor', () => {
  it('notifies subscribers and closes without rewriting content', () => {
    const listener = vi.fn();
    const unsubscribe = tocRenameEditorController.subscribe(listener);
    tocRenameEditorController.open('Original question', async () => undefined);
    expect(tocRenameEditorController.getSnapshot()?.value).toBe('Original question');
    tocRenameEditorController.close();
    expect(tocRenameEditorController.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
