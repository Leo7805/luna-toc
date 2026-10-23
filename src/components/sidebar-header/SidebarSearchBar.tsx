/**
 * Renders the expandable sidebar search input for filtering TOC messages
 * and saved prompts.
 */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { sidebarController } from '@/features/sidebar/sidebarController';

/**
 * Expandable search bar component.
 *
 * @returns {React.JSX.Element}
 */
export function SidebarSearchBar(): React.JSX.Element {
  const headerState = useSyncExternalStore(
    sidebarController.subscribeHeader,
    sidebarController.getHeaderSnapshot
  );

  const { isSearchOpen, searchQuery } = headerState;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleNativeInput = (event: Event): void => {
      sidebarController.setSearchQuery(
        (event.target as HTMLInputElement).value
      );
    };

    input.addEventListener('input', handleNativeInput);
    return () => {
      input.removeEventListener('input', handleNativeInput);
    };
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    sidebarController.setSearchQuery(event.target.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      sidebarController.closeSearch(true);
    }
  };

  return (
    <input
      ref={inputRef}
      id="navigator-search"
      type="search"
      placeholder="Search prompts..."
      autoComplete="off"
      data-react-managed="true"
      style={{ display: isSearchOpen ? 'block' : 'none' }}
      value={searchQuery}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
}
