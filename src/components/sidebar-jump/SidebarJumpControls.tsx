/**
 * React portal host for the LunaTOC sidebar jump and view-mode controls.
 * Mounts within the existing React root and portals into the dedicated Light DOM
 * `.navigator-jump-controls` cluster in the sidebar shell.
 */
import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { navigatorController } from '@/navigation/navigatorController';
import { scrollNavigatorListToEdge } from '@/features/sidebar/jumpToEdgeControls';

/**
 * Inner component rendering the Top, Toggle View, and Bottom buttons.
 *
 * @param {Object} props
 * @param {boolean} props.isMyPrompts Whether the sidebar is in My Prompts mode.
 * @returns {React.JSX.Element}
 */
export function SidebarJumpControlsBar({
  isMyPrompts,
}: {
  isMyPrompts: boolean;
}): React.JSX.Element {
  const handleTopClick = (): void => {
    if (isMyPrompts) {
      scrollNavigatorListToEdge('top', 'smooth');
      return;
    }
    navigatorController.jumpToEdge('top');
  };

  const handleTopDoubleClick = (): void => {
    if (isMyPrompts) {
      scrollNavigatorListToEdge('top', 'auto');
      return;
    }
    navigatorController.jumpToAbsoluteEdge('top');
  };

  const handleToggleViewMode = (): void => {
    sidebarController.toggleViewMode();
  };

  const handleBottomClick = (): void => {
    if (isMyPrompts) {
      scrollNavigatorListToEdge('bottom', 'smooth');
      return;
    }
    navigatorController.jumpToEdge('bottom');
  };

  const handleBottomDoubleClick = (): void => {
    if (isMyPrompts) {
      scrollNavigatorListToEdge('bottom', 'auto');
      return;
    }
    navigatorController.jumpToLastPrompt();
  };

  return (
    <>
      <button
        className="navigator-icon-btn"
        id="jump-chat-top-btn"
        type="button"
        aria-label="Jump to top"
        onClick={handleTopClick}
        onDoubleClick={handleTopDoubleClick}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 5h12M12 19V9M7 14l5-5 5 5" />
        </svg>
      </button>

      <button
        className={`navigator-icon-btn ${
          isMyPrompts ? 'mode-myprompts-active' : ''
        }`}
        id="toggle-view-mode-btn"
        type="button"
        aria-label={
          isMyPrompts ? 'Switch to Table of Contents' : 'Switch to My Prompts'
        }
        title={
          isMyPrompts ? 'Switch to Table of Contents' : 'Switch to My Prompts'
        }
        onClick={handleToggleViewMode}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="15 2 6 13 11 13 9 22 18 11 13 11 15 2" />
        </svg>
      </button>

      <button
        className="navigator-icon-btn"
        id="jump-chat-bottom-btn"
        type="button"
        aria-label="Jump to bottom"
        onClick={handleBottomClick}
        onDoubleClick={handleBottomDoubleClick}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 19h12M12 5v10M7 10l5 5 5-5" />
        </svg>
      </button>
    </>
  );
}

/**
 * Top-level React portal host for the sidebar jump controls.
 * Subscribes to sidebar DOM readiness and view mode updates before portaling
 * into the dedicated Light DOM `.navigator-jump-controls` container.
 *
 * @returns {React.JSX.Element | null}
 */
export function SidebarJumpControls(): React.JSX.Element | null {
  const isReady = useSyncExternalStore(
    sidebarController.subscribeReady,
    sidebarController.getReadySnapshot
  );
  const viewSnapshot = useSyncExternalStore(
    sidebarController.subscribeView,
    sidebarController.getViewSnapshot
  );

  if (!isReady) {
    return null;
  }

  const container = document.querySelector<HTMLElement>(
    '.navigator-jump-controls'
  );
  if (!container) {
    return null;
  }

  return createPortal(
    <SidebarJumpControlsBar
      isMyPrompts={viewSnapshot.viewMode === 'myPrompts'}
    />,
    container
  );
}
