/** Tests unified pointer and keyboard selection for prompt autocomplete. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptAutocompleteViewController } from '@/features/myPrompts/promptAutocompleteView';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const prompts: SavedPrompt[] = [
  {
    id: 'first',
    title: 'First',
    content: 'First prompt',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'second',
    title: 'Second',
    content: 'Second prompt',
    createdAt: 2,
    updatedAt: 2,
  },
];

afterEach(() => {
  promptAutocompleteViewController.close();
});

describe('prompt autocomplete view controller', () => {
  it('uses the most recent interaction mode for one selected item', () => {
    const onSelectedIndexChange = vi.fn();
    promptAutocompleteViewController.show(
      prompts,
      0,
      {
        left: 0,
        width: 320,
        anchorTop: 100,
        anchorBottom: 120,
        viewportHeight: 800,
      },
      vi.fn(),
      onSelectedIndexChange
    );

    promptAutocompleteViewController.setSelectedIndex(1, 'pointer');
    expect(promptAutocompleteViewController.getSnapshot()).toMatchObject({
      selectedIndex: 1,
      interactionMode: 'pointer',
    });

    promptAutocompleteViewController.setSelectedIndex(0);
    expect(promptAutocompleteViewController.getSnapshot()).toMatchObject({
      selectedIndex: 0,
      interactionMode: 'keyboard',
    });
    expect(onSelectedIndexChange).toHaveBeenNthCalledWith(1, 1);
    expect(onSelectedIndexChange).toHaveBeenNthCalledWith(2, 0);
  });
});
