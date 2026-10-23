/**
 * React portal host for the LunaTOC sidebar status banner.
 * Mounts within the existing React root and portals into the dedicated Light DOM
 * #luna-toc-status slot in the sidebar shell.
 */
import React, { useLayoutEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { sidebarController } from '@/features/sidebar/sidebarController';
import {
  getStatusSnapshot,
  subscribeStatus,
  type SidebarStatusSnapshot,
} from '@/navigation/ui/sidebarStatus';

/**
 * Renders the status banner content and toggles active styling on the mount container.
 *
 * @param {Object} props
 * @param {SidebarStatusSnapshot} props.status
 * @param {HTMLElement} props.container
 * @returns {React.JSX.Element | null}
 */
function SidebarStatusBar({
  status,
  container,
}: {
  status: SidebarStatusSnapshot;
  container: HTMLElement;
}): React.JSX.Element | null {
  useLayoutEffect(() => {
    container.classList.toggle(
      'navigator-status-active',
      status.state !== 'idle'
    );
    return () => {
      container.classList.remove('navigator-status-active');
    };
  }, [container, status.state]);

  if (status.state === 'idle') {
    return null;
  }

  return (
    <>
      {status.text}
      {status.state === 'jumping' && (
        <span className="jumping-dots" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
      )}
    </>
  );
}

/**
 * Top-level React portal host for the sidebar status banner.
 * Subscribes to sidebar DOM readiness and status state updates before portaling
 * into the dedicated Light DOM #luna-toc-status slot.
 *
 * @returns {React.JSX.Element | null}
 */
export function SidebarStatus(): React.JSX.Element | null {
  const isReady = useSyncExternalStore(
    sidebarController.subscribeReady,
    sidebarController.getReadySnapshot
  );
  const status = useSyncExternalStore(subscribeStatus, getStatusSnapshot);

  if (!isReady) {
    return null;
  }

  const container = document.getElementById('luna-toc-status');
  if (!container) {
    return null;
  }

  return createPortal(
    <SidebarStatusBar status={status} container={container} />,
    container
  );
}
