/**
 * Renders My Prompts autocomplete suggestions inside the React Shadow Root.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { promptAutocompleteViewController } from '@/features/myPrompts/promptAutocompleteView';

const MENU_GAP = 8;

/**
 * Connects the autocomplete view controller to the React component tree.
 *
 * @example
 * <PromptAutocompleteHost />
 */
export function PromptAutocompleteHost(): React.JSX.Element | null {
  const state = useSyncExternalStore(
    promptAutocompleteViewController.subscribe,
    promptAutocompleteViewController.getSnapshot
  );

  if (!state) return null;
  return <PromptAutocompleteMenu key={state.id} state={state} />;
}

interface PromptAutocompleteMenuProps {
  state: NonNullable<
    ReturnType<typeof promptAutocompleteViewController.getSnapshot>
  >;
}

function PromptAutocompleteMenu({
  state,
}: PromptAutocompleteMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const menuHeight = menu.offsetHeight;
    const preferredTop = state.position.anchorTop - menuHeight - MENU_GAP;
    const fallbackTop = Math.min(
      state.position.anchorBottom + MENU_GAP,
      state.position.viewportHeight - menuHeight - MENU_GAP
    );
    setTop(Math.max(MENU_GAP, preferredTop >= MENU_GAP ? preferredTop : fallbackTop));
  }, [state.position]);

  useLayoutEffect(() => {
    itemRefs.current[state.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  return (
    <div
      ref={menuRef}
      data-luna-toc-autocomplete="true"
      role="listbox"
      aria-label="My Prompts suggestions"
      className="fixed z-[1000000] max-h-[220px] overflow-y-auto rounded-lg border border-[var(--ct-border-autocomplete)] bg-[var(--ct-bg-autocomplete)] shadow-xl backdrop-blur-xl"
      style={{
        left: state.position.left,
        top: top ?? state.position.anchorTop,
        width: state.position.width,
        visibility: top === null ? 'hidden' : 'visible',
      }}
    >
      {state.prompts.map((prompt, index) => {
        const isSelected = index === state.selectedIndex;

        return (
          <div
            key={prompt.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            role="option"
            aria-selected={isSelected}
            className={`cursor-pointer border-b border-[var(--ct-border-autocomplete-item)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--ct-bg-item-hover)] ${
              isSelected ? 'bg-[var(--ct-bg-item-hover)]' : ''
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => promptAutocompleteViewController.select(index)}
          >
            <div className="mb-0.5 text-[13px] font-semibold text-[var(--ct-text-autocomplete-title)]">
              {prompt.title}
            </div>
            <div className="truncate text-[11px] text-[var(--ct-text-autocomplete-preview)]">
              {prompt.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
