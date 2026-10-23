/**
 * Toolbar for My Prompts panel, offering sort mode selection, Markdown
 * import/export actions, and a button to create new saved prompts.
 */
import type { SortMode } from '@/features/myPrompts/promptSorter';

export interface MyPromptsToolbarProps {
  sortMode: SortMode;
  onSortChange: (sortMode: SortMode) => void;
  onAddNew: () => void;
  onExport: () => void;
  onImport: () => void;
}

/**
 * Renders the toolbar containing sorting controls, import/export buttons,
 * and the add prompt button.
 *
 * @param {MyPromptsToolbarProps} props
 * @returns {React.JSX.Element}
 */
export function MyPromptsToolbar({
  sortMode,
  onSortChange,
  onAddNew,
  onExport,
  onImport,
}: MyPromptsToolbarProps): React.JSX.Element {
  return (
    <div className="my-prompts-sort-bar">
      <div className="sort-bar-left">
        <svg
          className="sort-icon"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="15" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="18" y2="18" />
        </svg>
        <select
          id="myprompt-sort-select"
          className="my-prompts-sort-select"
          aria-label="Sort prompts by"
          value={sortMode}
          onChange={(event) => onSortChange(event.target.value as SortMode)}
        >
          <option value="updated_desc">Newest Modified</option>
          <option value="updated_asc">Oldest Modified</option>
          <option value="name_asc">Title (A-Z)</option>
          <option value="name_desc">Title (Z-A)</option>
        </select>
      </div>
      <div className="my-prompts-toolbar-actions">
        <button
          id="myprompt-import-btn"
          className="myprompt-canvas-btn"
          type="button"
          aria-label="Import prompts"
          title="Import prompts"
          onClick={onImport}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <button
          id="myprompt-export-btn"
          className="myprompt-canvas-btn"
          type="button"
          aria-label="Export prompts"
          title="Export prompts"
          onClick={onExport}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button
          id="myprompt-add-new-btn"
          type="button"
          aria-label="Add prompt"
          title="Add prompt"
          onClick={onAddNew}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
