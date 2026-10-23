/**
 * React component for the floating Moon/TOC sidebar toggle button.
 * Mounts within the existing React root and portals into a dedicated Light DOM container
 * attached to document.body, preserving 2D pointer dragging, viewport clamping, and persistence.
 */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  clearHideTimer,
  handleAutoHideEnter,
  isSidebarHidden,
  scheduleAutoHide,
  setSidebarHidden,
  subscribeSidebarHidden,
} from '@/features/sidebarVisibility';
import {
  initDrag,
  restorePosition,
  type ToggleButtonPosition,
} from '@/features/SidebarToggleButton';

const TOGGLE_CONTAINER_ID = 'luna-toc-toggle-container';

/**
 * Returns or creates the dedicated stable Light DOM mount node for the toggle button.
 * Uses display: contents to ensure no interference with CSS box model, positioning, or stacking.
 *
 * @returns {HTMLElement | null} The container element, or null if document.body is unavailable.
 */
export function getOrCreateToggleContainer(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  let container = document.getElementById(TOGGLE_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOGGLE_CONTAINER_ID;
    container.style.display = 'contents';
    document.body.appendChild(container);
  }

  return container;
}

/**
 * Floating Moon Button component.
 *
 * @returns {React.JSX.Element | null}
 */
export function SidebarToggleButton(): React.JSX.Element | null {
  const isHidden = useSyncExternalStore(
    subscribeSidebarHidden,
    isSidebarHidden,
    () => false
  );

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const positionRef = useRef<ToggleButtonPosition | null>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    // Restore saved session position on mount
    const restored = restorePosition(button);
    if (restored) {
      positionRef.current = restored;
    }

    // Attach drag and window resize listeners
    const cleanupDrag = initDrag(button, (newPosition) => {
      positionRef.current = newPosition;
    });

    const handleEnter = (): void => {
      handleAutoHideEnter();
    };

    const handleLeave = (): void => {
      scheduleAutoHide();
    };

    button.addEventListener('pointerenter', handleEnter);
    button.addEventListener('pointerleave', handleLeave);

    return () => {
      cleanupDrag();
      button.removeEventListener('pointerenter', handleEnter);
      button.removeEventListener('pointerleave', handleLeave);
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const button = buttonRef.current;
    if (!button) return;

    if (button.dataset.dragged === 'true') {
      event.preventDefault();
      button.dataset.dragged = 'false';
      return;
    }

    clearHideTimer();
    setSidebarHidden(!isSidebarHidden());
  };

  const handlePointerEnter = (): void => {
    handleAutoHideEnter();
  };

  const handlePointerLeave = (): void => {
    scheduleAutoHide();
  };

  const portalTarget = getOrCreateToggleContainer();
  if (!portalTarget) {
    return null;
  }

  // Preserve the restored or dragged position across subsequent React re-renders
  const currentStyle: React.CSSProperties | undefined = positionRef.current
    ? {
        left: `${positionRef.current.left}px`,
        top: `${positionRef.current.top}px`,
        right: 'auto',
        bottom: 'auto',
      }
    : undefined;

  return createPortal(
    <button
      ref={buttonRef}
      id="luna-toc-toggle-btn"
      type="button"
      className={
        isHidden ? 'luna-toc-sidebar-hidden' : 'luna-toc-sidebar-visible'
      }
      style={currentStyle}
      aria-label={isHidden ? 'Open sidebar' : 'Close sidebar'}
      aria-expanded={!isHidden}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <path
          fill="currentColor"
          d="M48 8A26 26 0 1 1 15 48C29 52 43 43 49 29C52 21 51 13 48 8Z"
        />
      </svg>
      <span className="toggle-sidebar-label" aria-hidden="true">
        TOC
      </span>
    </button>,
    portalTarget
  );
}
