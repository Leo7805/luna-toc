/**
 * Renders the React create/edit dialog for saved My Prompts entries.
 */
import { useId, useState, useSyncExternalStore } from 'react';
import type { SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  promptEditorController,
  type PromptEditorValues,
} from '@/features/myPrompts/promptEditor';
import { getReactPortalContainer } from '@/reactHost/reactHost';

/**
 * Connects the prompt editor controller to the React component tree.
 *
 * @example
 * <PromptEditorDialogHost />
 */
export function PromptEditorDialogHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(
    promptEditorController.subscribe,
    promptEditorController.getSnapshot
  );

  if (!request) return null;

  return (
    <PromptEditorDialog
      key={request.id}
      item={request.item}
      onSubmit={request.onSubmit}
    />
  );
}

interface PromptEditorDialogProps {
  item: {
    id?: string;
    title?: string;
    content?: string;
  } | null;
  onSubmit: (values: PromptEditorValues) => Promise<void>;
}

function PromptEditorDialog({
  item,
  onSubmit,
}: PromptEditorDialogProps): React.JSX.Element {
  const titleId = useId();
  const contentId = useId();
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isNew = !item?.id;

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const values = {
      title: title.trim(),
      content: content.trim(),
    };
    if (!values.title || !values.content || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(values);
      promptEditorController.close();
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) promptEditorController.close();
      }}
    >
      <DialogContent
        portalContainer={getReactPortalContainer()}
        overlayClassName="z-[var(--ct-z-modal,1100)] bg-black/65 backdrop-blur-sm"
        className="z-[var(--ct-z-modal,1100)] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-120 sm:max-w-120 flex-col gap-0 overflow-hidden border border-border bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
      >
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-lg text-primary">
            {isNew ? 'Create Custom Prompt' : 'Edit Custom Prompt'}
          </DialogTitle>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="grid gap-1.5">
              <Label
                htmlFor={titleId}
                className="text-xs tracking-wide text-muted-foreground uppercase"
              >
                Title
              </Label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="e.g. Code Review Helper"
                className="bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 dark:bg-background"
                autoFocus
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor={contentId}
                className="text-xs tracking-wide text-muted-foreground uppercase"
              >
                Prompt Content
              </Label>
              <Textarea
                id={contentId}
                value={content}
                onChange={(event) => setContent(event.currentTarget.value)}
                placeholder="Type or paste your prompt content here..."
                className="min-h-[180px] max-h-[50dvh] resize-y overflow-auto bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 dark:bg-background"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <DialogFooter className="m-0 shrink-0 rounded-none border-t border-border bg-popover/95 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={promptEditorController.close}
              disabled={isSubmitting}
              className="cursor-pointer border-border bg-secondary text-secondary-foreground hover:border-primary hover:bg-secondary/80 active:translate-y-px dark:bg-secondary dark:hover:bg-secondary/80"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full cursor-pointer bg-primary text-primary-foreground hover:bg-primary/85 hover:shadow-md active:translate-y-px sm:w-auto sm:min-w-20"
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
