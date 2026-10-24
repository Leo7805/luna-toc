/**
 * Renders the shared TOC Filter context menu inside the isolated React Shadow DOM root.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu';
import {
  closeTocFilterMenu,
  getTocFilterMenuSnapshot,
  getTocFilterMode,
  setTocFilterMode,
  subscribeTocFilter,
  subscribeTocFilterMenu,
  type TocFilterMode,
} from '@/features/tocFilter/tocFilterStore';

const FILTER_MENU_OPTIONS: Array<{ id: TocFilterMode; label: string }> = [
  { id: 'all', label: 'All prompts' },
  { id: 'renamed', label: 'Renamed only' },
  { id: 'bookmarked', label: 'Bookmarked only' },
  { id: 'renamed_or_bookmarked', label: 'Renamed or bookmarked' },
];

/**
 * Connects the TOC filter menu store to the React component tree.
 *
 * @example
 * <TocFilterContextMenuHost />
 */
export function TocFilterContextMenuHost(): React.JSX.Element | null {
  const menuState = useSyncExternalStore(
    subscribeTocFilterMenu,
    getTocFilterMenuSnapshot
  );

  const activeMode = useSyncExternalStore(
    subscribeTocFilter,
    getTocFilterMode
  );

  if (!menuState || !menuState.isOpen) {
    return null;
  }

  return (
    <TocFilterContextMenu
      activeMode={activeMode}
      position={menuState.position}
    />
  );
}

interface TocFilterContextMenuProps {
  activeMode: TocFilterMode;
  position: { left: number; top: number };
}

function TocFilterContextMenu({
  activeMode,
  position,
}: TocFilterContextMenuProps): React.JSX.Element {
  useEffect(() => {
    const host = document.getElementById('luna-toc-react-host');
    host?.setAttribute('data-luna-toc-context-menu-open', 'true');
    return () => {
      host?.removeAttribute('data-luna-toc-context-menu-open');
    };
  }, []);

  const items: ContextMenuItem[] = FILTER_MENU_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    selected: activeMode === option.id,
  }));

  const handleSelect = (itemId: string): void => {
    setTocFilterMode(itemId as TocFilterMode);
    closeTocFilterMenu();
  };

  return (
    <ContextMenu
      ariaLabel="Filter prompts"
      items={items}
      position={position}
      onClose={closeTocFilterMenu}
      onSelect={handleSelect}
    />
  );
}
