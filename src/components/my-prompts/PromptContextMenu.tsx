/**
 * Connects My Prompts context-menu requests to the shared menu component.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { ContextMenu } from '@/components/ui/context-menu';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';

/**
 * Connects the prompt context-menu controller to the React component tree.
 *
 * @example
 * <PromptContextMenuHost />
 */
export function PromptContextMenuHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(
    promptContextMenuController.subscribe,
    promptContextMenuController.getSnapshot
  );

  if (!request) return null;

  return <PromptContextMenu key={request.id} request={request} />;
}

interface PromptContextMenuProps {
  request: NonNullable<
    ReturnType<typeof promptContextMenuController.getSnapshot>
  >;
}

function PromptContextMenu({ request }: PromptContextMenuProps): React.JSX.Element {
  useEffect(() => {
    const host = document.getElementById('luna-toc-react-host');
    host?.setAttribute('data-luna-toc-context-menu-open', 'true');
    return () => {
      host?.removeAttribute('data-luna-toc-context-menu-open');
    };
  }, []);

  return (
    <ContextMenu
      ariaLabel="My Prompts actions"
      items={request.items}
      position={request.position}
      onClose={promptContextMenuController.close}
      onSelect={promptContextMenuController.select}
    />
  );
}
