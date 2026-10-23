/**
 * Renders the main content list for My Prompts, including filtering by search
 * query, sorting, and empty state messaging.
 */
import { useMemo } from 'react';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import { sortMyPrompts, type SortMode } from '@/features/myPrompts/promptSorter';
import { MyPromptsItemRow } from './MyPromptsItemRow';

export interface MyPromptsPanelProps {
  prompts: SavedPrompt[];
  searchQuery: string;
  sortMode: SortMode;
  onEdit: (prompt: SavedPrompt) => void;
  onDelete: (prompt: SavedPrompt) => void;
  onSelect: (prompt: SavedPrompt) => void;
}

/**
 * List container and empty state renderer for My Prompts.
 *
 * @param {MyPromptsPanelProps} props
 * @returns {React.JSX.Element}
 */
export function MyPromptsPanel({
  prompts,
  searchQuery,
  sortMode,
  onEdit,
  onDelete,
  onSelect,
}: MyPromptsPanelProps): React.JSX.Element {
  const query = searchQuery.trim().toLowerCase();

  const filteredPrompts = useMemo(() => {
    let result = prompts;
    if (query) {
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query)
      );
    }
    return sortMyPrompts(result, sortMode);
  }, [prompts, query, sortMode]);

  if (filteredPrompts.length === 0) {
    return (
      <p className="navigator-hint">
        {query
          ? 'No matching prompts.'
          : 'No prompts saved yet. Click + to add one, or right-click any prompt in the TOC list.'}
      </p>
    );
  }

  return (
    <div className="my-prompts-items-container">
      {filteredPrompts.map((prompt) => (
        <MyPromptsItemRow
          key={prompt.id}
          prompt={prompt}
          onEdit={onEdit}
          onDelete={onDelete}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
