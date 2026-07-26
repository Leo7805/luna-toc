/**
 * Renders the static LunaTOC sidebar structure used by legacy feature modules.
 */
export interface SidebarShellProps {
  title: string;
  emptyHint: string;
}

/**
 * Provides stable DOM IDs and classes while sidebar features migrate to React.
 *
 * @example
 * <SidebarShell title="Conversation" emptyHint="Waiting for prompts..." />
 */
export function SidebarShell({
  title,
  emptyHint,
}: SidebarShellProps) {
  return (
    <>
      <div id="navigator-resizer" />
      <div className="navigator-topbar">
        <div className="navigator-header">
          <button
            className="navigator-icon-btn navigator-header-icon-btn luna-toc-sidebar-pin-btn"
            id="luna-toc-sidebar-pin-btn"
            type="button"
            aria-label="Enable sidebar auto-hide"
            aria-pressed="true"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
            </svg>
          </button>
          <button id="navigator-title" type="button" aria-label="Reset TOC view">
            {title}
          </button>
          <button
            className="navigator-icon-btn navigator-header-icon-btn"
            id="search-toggle-btn"
            type="button"
            aria-label="Toggle search"
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
        </div>
        <p className="navigator-hint">{emptyHint}</p>
        <input
          id="navigator-search"
          type="search"
          placeholder="Search prompts..."
          autoComplete="off"
        />
        <div id="myprompts-toolbar-container" />
      </div>
      <div className="navigator-jump-controls">
        <button
          className="navigator-icon-btn"
          id="jump-chat-top-btn"
          type="button"
          aria-label="Jump to top"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 5h12M12 19V9M7 14l5-5 5 5" />
          </svg>
        </button>
        <button
          className="navigator-icon-btn"
          id="toggle-view-mode-btn"
          type="button"
          aria-label="Switch to My Prompts"
          title="Switch to My Prompts"
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
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 19h12M12 5v10M7 10l5 5 5-5" />
          </svg>
        </button>
      </div>
      <div id="navigator-list" />
    </>
  );
}
