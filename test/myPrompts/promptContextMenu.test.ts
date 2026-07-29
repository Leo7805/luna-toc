/** Tests the My Prompts context-menu state controller. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';

afterEach(() => {
  promptContextMenuController.close();
});

describe('prompt context-menu controller', () => {
  it('closes the menu before selecting an item', () => {
    const selectItem = vi.fn();
    const onClose = vi.fn();
    promptContextMenuController.show(
      { left: 10, top: 20 },
      [],
      selectItem,
      onClose
    );

    promptContextMenuController.select('clear-all');

    expect(promptContextMenuController.getSnapshot()).toBeNull();
    expect(selectItem).toHaveBeenCalledWith('clear-all');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
