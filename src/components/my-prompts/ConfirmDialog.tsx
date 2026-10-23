/**
 * Renders a React confirmation and message dialog for My Prompts actions.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  closePromptModal,
  promptDialogController,
  type PromptDialogOptions,
  type PromptDialogRequest,
} from '@/features/myPrompts/promptDialogController';
import { getReactPortalContainer } from '@/reactHost/portalContainer';

export {
  closePromptModal,
  promptDialogController,
  type PromptDialogOptions,
  type PromptDialogRequest,
};

/**
 * Mounts the prompt dialog host in the React component tree.
 *
 * @returns {React.JSX.Element | null}
 *
 * @example
 * <ConfirmDialogHost />
 */
export function ConfirmDialogHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(
    promptDialogController.subscribe,
    promptDialogController.getSnapshot
  );

  useEffect(() => {
    return () => {
      // Clean up any pending promise if the host is unmounted.
      if (promptDialogController.getSnapshot()) {
        closePromptModal(false);
      }
    };
  }, []);

  if (!request) return null;

  return <ConfirmDialog key={request.id} request={request} />;
}

interface ConfirmDialogProps {
  request: PromptDialogRequest;
}

function ConfirmDialog({ request }: ConfirmDialogProps): React.JSX.Element {
  const isConfirm = Boolean(request.confirm);
  const confirmText = request.confirmText || 'OK';
  const cancelText = request.cancelText || 'Cancel';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          closePromptModal(false);
        }
      }}
    >
      <DialogContent
        portalContainer={getReactPortalContainer()}
        showCloseButton={true}
        overlayClassName="z-[var(--ct-z-modal,1100)] bg-black/65 backdrop-blur-sm"
        className="z-[var(--ct-z-modal,1100)] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] sm:max-w-[420px] flex-col gap-0 overflow-hidden border border-border bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
      >
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-lg font-semibold text-primary">
            {request.title}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4">
          <DialogDescription className="text-sm text-popover-foreground leading-relaxed whitespace-pre-wrap">
            {request.message}
          </DialogDescription>
        </div>

        <DialogFooter className="flex flex-row justify-end gap-3 border-t border-border bg-muted/30 px-5 py-3">
          {isConfirm && (
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => closePromptModal(false)}
            >
              {cancelText}
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            className="cursor-pointer"
            autoFocus
            onClick={() => closePromptModal(true)}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
