/**
 * Provides a reusable floating context menu for LunaTOC feature surfaces.
 */
import { useEffect, useRef } from 'react';
import { ClipboardIcon, CopyIcon, Trash2Icon } from 'lucide-react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon: 'clipboard' | 'copy' | 'trash';
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

function ContextMenuIcon({
  icon,
}: Pick<ContextMenuItem, 'icon'>): React.JSX.Element {
  const Icon =
    icon === 'trash'
      ? Trash2Icon
      : icon === 'clipboard'
        ? ClipboardIcon
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

  const left = Math.min(
    position.left,
    window.innerWidth - MENU_WIDTH - MENU_GAP
  );
  const top = Math.min(position.top, window.innerHeight - 52 - MENU_GAP);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[var(--ct-z-popover,1020)] w-55 rounded-lg border border-border bg-popover p-1 shadow-xl"
      style={{
        left: Math.max(MENU_GAP, left),
        top: Math.max(MENU_GAP, top),
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
