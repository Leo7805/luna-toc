/**
 * React portal host for My Prompts. Subscribes to sidebar view state and
 * prompt collection updates, portaling the Toolbar and Panel into the Light DOM
 * containers within the sidebar shell when My Prompts view is active.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import { previewTooltip } from '@/features/tooltip';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import type { SortMode } from '@/features/myPrompts/promptSorter';
import { MyPromptsToolbar } from './MyPromptsToolbar';
import { MyPromptsPanel } from './MyPromptsPanel';

/**
 * Top-level React portal host for the My Prompts panel.
 *
 * @returns {React.JSX.Element | null}
 */
export function MyPromptsView(): React.JSX.Element | null {
  const viewState = useSyncExternalStore(
    sidebarController.subscribeView,
    sidebarController.getViewSnapshot
  );

  const prompts = useSyncExternalStore(
    myPrompts.onPromptsChanged,
    myPrompts.getMyPromptsSnapshot
  );

  const [sortMode, setSortMode] = useState<SortMode>('updated_desc');

  useEffect(() => {
    sidebarController.setMyPromptsCount(prompts.length);
  }, [prompts.length]);

  useEffect(() => {
    if (viewState.viewMode !== 'myPrompts') {
      return;
    }

    const list = document.getElementById('myprompts-list');
    if (!list) return;

    const handleContextMenu = (event: MouseEvent): void => {
      if (!prompts.length) return;

      const target = event.target;
      const targetElement =
        target instanceof Element
          ? target
          : target instanceof Node
          ? target.parentElement
          : null;

      if (targetElement?.closest('.my-prompts-item-row')) {
        return;
      }

      event.preventDefault();
      previewTooltip.hide();
      promptContextMenuController.show(
        { left: event.clientX, top: event.clientY },
        [
          {
            id: 'clear-all',
            label: 'Clear all My Prompts',
            icon: 'trash',
            variant: 'destructive',
          },
        ],
        (itemId) => {
          if (itemId === 'clear-all') {
            void myPrompts.clearAllMyPrompts();
          }
        }
      );
    };

    list.addEventListener('contextmenu', handleContextMenu);
    return () => {
      list.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [viewState.viewMode, prompts.length]);

  if (viewState.viewMode !== 'myPrompts') {
    return null;
  }

  const toolbarContainer = document.getElementById('myprompts-toolbar-container');
  const listContainer = document.getElementById('myprompts-list');

  if (!toolbarContainer || !listContainer) {
    return null;
  }

  const handleAddNew = (): void => {
    myPrompts.showDialog(null);
  };

  const handleEdit = (prompt: SavedPrompt): void => {
    myPrompts.showDialog(prompt);
  };

  const handleDelete = (prompt: SavedPrompt): void => {
    void myPrompts.deletePrompt(prompt);
  };

  const handleSelect = (prompt: SavedPrompt): void => {
    myPrompts.insertIntoChatGPTInput(prompt.content);
  };

  const handleExport = (): void => {
    void myPrompts.exportMyPrompts();
  };

  const handleImport = (): void => {
    myPrompts.importMyPrompts();
  };

  return (
    <>
      {createPortal(
        <MyPromptsToolbar
          sortMode={sortMode}
          onSortChange={setSortMode}
          onAddNew={handleAddNew}
          onExport={handleExport}
          onImport={handleImport}
        />,
        toolbarContainer
      )}
      {createPortal(
        <MyPromptsPanel
          prompts={prompts}
          searchQuery={viewState.searchQuery}
          sortMode={sortMode}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSelect={handleSelect}
        />,
        listContainer
      )}
    </>
  );
}
