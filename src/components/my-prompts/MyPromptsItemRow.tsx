/**
 * Renders an individual prompt item row within the My Prompts list, supporting
 * click-to-insert, edit, delete, hover preview tooltips, and context menu actions.
 */
import { useRef, useState } from 'react';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import { previewTooltip } from '@/features/tooltip';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import { myPrompts } from '@/features/myPrompts/myPrompts';

export interface MyPromptsItemRowProps {
  prompt: SavedPrompt;
  onEdit: (prompt: SavedPrompt) => void;
  onDelete: (prompt: SavedPrompt) => void;
  onSelect: (prompt: SavedPrompt) => void;
}

/**
 * Single prompt item row inside the My Prompts list.
 *
 * @param {MyPromptsItemRowProps} props
 * @returns {React.JSX.Element}
 */
export function MyPromptsItemRow({
  prompt,
  onEdit,
  onDelete,
  onSelect,
}: MyPromptsItemRowProps): React.JSX.Element {
  const [isContextActive, setIsContextActive] = useState(false);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const handleClick = (): void => {
    previewTooltip.hide();
    onSelect(prompt);
  };

  const handleMouseEnter = (event: React.MouseEvent<HTMLDivElement>): void => {
    previewTooltip.show(
      {
        title: prompt.title,
        content: prompt.content,
      },
      event.nativeEvent,
      mainRef.current ?? undefined
    );
  };

  const handleMouseLeave = (): void => {
    previewTooltip.hide();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    previewTooltip.hide();
    setIsContextActive(true);

    promptContextMenuController.show(
      { left: event.clientX, top: event.clientY },
      [{ id: 'copy-prompt', label: 'Copy Prompt', icon: 'copy' }],
      (itemId) => {
        if (itemId === 'copy-prompt') {
          void myPrompts.copyPromptText(prompt.content, 'Copy Prompt');
        }
      },
      () => {
        setIsContextActive(false);
      }
    );
  };

  const handleEditClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    previewTooltip.hide();
    onEdit(prompt);
  };

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    previewTooltip.hide();
    onDelete(prompt);
  };

  return (
    <div
      className={`navigator-item my-prompts-item-row${
        isContextActive ? ' my-prompts-item-context-active' : ''
      }`}
      data-prompt-id={prompt.id}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={mainRef} className="navigator-item-main">
        <span className="navigator-item-text my-prompts-item-title">
          {prompt.title}
        </span>
        <div className="my-prompts-item-actions">
          <button
            className="myprompt-action-btn edit-myprompt-btn"
            type="button"
            aria-label="Edit prompt"
            title="Edit prompt"
            onClick={handleEditClick}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="myprompt-action-btn delete-myprompt-btn"
            type="button"
            aria-label="Delete prompt"
            title="Delete prompt"
            onClick={handleDeleteClick}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
