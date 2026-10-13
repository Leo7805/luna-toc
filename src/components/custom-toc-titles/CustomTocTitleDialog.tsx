/**
 * Renders the modal dialog for renaming a Prompt Navigator Item.
 */
import { useId, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCustomTitle, removeCustomTitle, setCustomTitle } from '@/features/customTocTitles/customTocTitleStore';
import { getReactPortalContainer } from '@/reactHost/portalContainer';

export interface OpenCustomTocTitleDialogOptions {
  messageId: string;
  originalPrompt: string;
  onUpdated?: () => void;
}

type RenameRequest = OpenCustomTocTitleDialogOptions & { id: number };

let currentRequest: RenameRequest | null = null;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

/** Opens the rename dialog for a given message. */
export function openCustomTocTitleDialog(options: OpenCustomTocTitleDialogOptions): void {
  currentRequest = { id: Date.now(), ...options };
  notify();
}

/** Closes the active rename dialog. */
export function closeCustomTocTitleDialog(): void {
  if (!currentRequest) return;
  currentRequest = null;
  notify();
}

/** Mounts the dialog in the React host. */
export function CustomTocTitleDialogHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => currentRequest
  );
  return request ? <CustomTocTitleDialog key={request.id} request={request} /> : null;
}

function CustomTocTitleDialog({ request }: { request: RenameRequest }): React.JSX.Element {
  const inputId = useId();
  const existingTitle = getCustomTitle(request.messageId) ?? '';
  const [title, setTitle] = useState(existingTitle);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (action: () => Promise<void>): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await action();
      request.onUpdated?.();
      closeCustomTocTitleDialog();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = (e: FormEvent): void => {
    e.preventDefault();
    void submit(() => setCustomTitle(request.messageId, title));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && closeCustomTocTitleDialog()}>
      <DialogContent
        portalContainer={getReactPortalContainer()}
        overlayClassName="z-[var(--ct-z-modal,1100)] bg-black/65 backdrop-blur-sm"
        className="z-[var(--ct-z-modal,1100)] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-105 flex-col gap-0 overflow-hidden border border-border bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
      >
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold text-foreground">Rename TOC Item</DialogTitle>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSave}>
          <div className="grid gap-3 px-5 py-4">
            <div className="grid gap-1">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Original Prompt
              </span>
              <p className="line-clamp-2 text-xs text-muted-foreground/80 italic break-words">
                {request.originalPrompt}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={inputId} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                TOC Title
              </Label>
              <Input
                id={inputId}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="Enter custom title…"
                className="bg-background text-foreground placeholder:text-muted-foreground/50 dark:bg-background"
                autoFocus
                disabled={submitting}
              />
            </div>
          </div>

          <DialogFooter className="m-0 flex items-center justify-between border-t border-border bg-popover/95 px-5 py-3">
            <div>
              {existingTitle ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void submit(() => removeCustomTitle(request.messageId))}
                  disabled={submitting}
                  className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset to Default
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeCustomTocTitleDialog} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary/85">
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
