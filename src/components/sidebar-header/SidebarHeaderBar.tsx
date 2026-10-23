/**
 * Renders the top header bar of the LunaTOC sidebar, including the auto-hide pin
 * button, the conversation / section title, and the search toggle button.
 */
import React, { useSyncExternalStore } from 'react';
import {
  isSidebarPinned,
  subscribeSidebarPinned,
  toggleSidebarPinned,
} from '@/features/sidebarVisibility';
import { sidebarController } from '@/features/sidebar/sidebarController';

/**
 * Top header bar component.
 *
 * @returns {React.JSX.Element}
 */
export function SidebarHeaderBar(): React.JSX.Element {
  const isPinned = useSyncExternalStore(
    subscribeSidebarPinned,
    isSidebarPinned
  );

  const headerState = useSyncExternalStore(
    sidebarController.subscribeHeader,
    sidebarController.getHeaderSnapshot
  );

  const { viewMode, title, isSearchDisabled } = headerState;

  const handleTitleClick = (): void => {
    sidebarController.handleTitleClick();
  };

  const handleToggleSearch = (): void => {
    sidebarController.toggleSearch();
  };

  const handleTogglePin = (): void => {
    toggleSidebarPinned();
  };

  return (
    <>
      <button
        className={`navigator-icon-btn navigator-header-icon-btn luna-toc-sidebar-pin-btn ${
          isPinned ? 'luna-toc-sidebar-pin-active' : ''
        }`}
        id="luna-toc-sidebar-pin-btn"
        type="button"
        aria-label={isPinned ? 'Enable sidebar auto-hide' : 'Pin sidebar open'}
        aria-pressed={isPinned}
        onClick={handleTogglePin}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
        </svg>
      </button>

      <button
        id="navigator-title"
        type="button"
        aria-label={viewMode === 'myPrompts' ? 'My Prompts' : 'Reset TOC view'}
        data-tooltip={title}
        data-tooltip-overflow-only="true"
        onClick={handleTitleClick}
      >
        {title}
      </button>

      <button
        className="navigator-icon-btn navigator-header-icon-btn"
        id="search-toggle-btn"
        type="button"
        aria-label="Toggle search"
        disabled={isSearchDisabled}
        aria-disabled={isSearchDisabled}
        onClick={handleToggleSearch}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </>
  );
}
