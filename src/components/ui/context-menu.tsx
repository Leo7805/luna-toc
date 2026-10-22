/**
 * Provides a reusable floating context menu for LunaTOC feature surfaces.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkPlusIcon,
  ClipboardIcon,
  CopyIcon,
  ListCollapseIcon,
  PencilLineIcon,
  Trash2Icon,
} from 'lucide-react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: 'clipboard' | 'copy' | 'trash' | 'bookmark-plus' | 'pencil-line' | 'arrow-up' | 'arrow-down' | 'list-collapse';
  variant?: 'default' | 'destructive';
  disabled?: boolean;
}

interface ContextMenuProps {
  ariaLabel: string;
  items: ContextMenuItem[];
  position: { left: number; top: number };
  onClose: () => void;
  onSelect: (itemId: string) => void;
}

const MENU_GAP = 8;
const MENU_WIDTH = 220;

/** Fits a measured popup inside the visible viewport without assuming its height. */
export function fitContextMenuPosition(
  desired: { left: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: Math.max(MENU_GAP, Math.min(desired.left, viewport.width - size.width - MENU_GAP)),
    top: Math.max(MENU_GAP, Math.min(desired.top, viewport.height - size.height - MENU_GAP)),
  };
}

function ContextMenuIcon({
  icon,
}: Pick<ContextMenuItem, 'icon'>): React.JSX.Element | null {
  if (!icon) return null;
  const Icon =
    icon === 'list-collapse'
      ? ListCollapseIcon
    : icon === 'arrow-down'
      ? ArrowDownIcon
      : icon === 'arrow-up'
        ? ArrowUpIcon
      : icon === 'trash'
        ? Trash2Icon
      : icon === 'clipboard'
        ? ClipboardIcon
        : icon === 'bookmark-plus'
          ? BookmarkPlusIcon
          : icon === 'pencil-line'
            ? PencilLineIcon
            : CopyIcon;
  return <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />;
}

/**
 * Renders a positioned context menu and closes it on outside click or Escape.
 *
 * @example
 * <ContextMenu ariaLabel="Actions" items={items} position={position} onClose={close} onSelect={select} />
 */
export function ContextMenu({
  ariaLabel,
  items,
  position,
  onClose,
  onSelect,
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current || event.composedPath().includes(menuRef.current)) {
        return;
      }
      onClose();
    };
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const update = (): void => {
      const fitted = fitContextMenuPosition(
        position,
        { width: menu.offsetWidth || MENU_WIDTH, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      menu.style.left = `${fitted.left}px`;
      menu.style.top = `${fitted.top}px`;
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [position.left, position.top, items.length]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[var(--ct-z-popover,1020)] w-55 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
      style={{
        left: Math.max(MENU_GAP, Math.min(position.left, window.innerWidth - MENU_WIDTH - MENU_GAP)),
        top: MENU_GAP,
        maxHeight: `calc(100vh - ${2 * MENU_GAP}px)`,
        maxWidth: `calc(100vw - ${2 * MENU_GAP}px)`,
      }}
    >
      {items.map((item) => {
        const isDestructive = item.variant === 'destructive';
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isDestructive
                ? 'cursor-pointer text-red-600 hover:bg-red-500/10 hover:text-red-700 focus-visible:bg-red-500/10 dark:text-red-400 dark:hover:text-red-300'
                : 'cursor-pointer text-foreground hover:bg-muted focus-visible:bg-muted'
            }`}
            onClick={() => onSelect(item.id)}
          >
            <ContextMenuIcon icon={item.icon} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
