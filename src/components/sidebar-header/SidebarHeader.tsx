/**
 * React portal host for the LunaTOC sidebar header and search bar.
 * Mounts within the existing React root and portals into the dedicated Light DOM
 * header and search slots in the sidebar topbar.
 */
import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { SidebarHeaderBar } from './SidebarHeaderBar';
import { SidebarSearchBar } from './SidebarSearchBar';

/**
 * Top-level React portal host for the sidebar header and search UI.
 * Subscribes to sidebar DOM and controller readiness before resolving portal
 * target slots in the Light DOM.
 *
 * @returns {React.JSX.Element | null}
 */
export function SidebarHeader(): React.JSX.Element | null {
  const isReady = useSyncExternalStore(
    sidebarController.subscribeReady,
    sidebarController.getReadySnapshot
  );

  if (!isReady) {
    return null;
  }

  const headerContainer = document.getElementById('navigator-header');
  const searchContainer = document.getElementById('navigator-search-container');

  if (!headerContainer || !searchContainer) {
    return null;
  }

  return (
    <>
      {createPortal(<SidebarHeaderBar />, headerContainer)}
      {createPortal(<SidebarSearchBar />, searchContainer)}
    </>
  );
}
