/**
 * Renders the React create/edit dialog for saved My Prompts entries.
 */
import { useId, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {isNew ? 'Create Custom Prompt' : 'Edit Custom Prompt'}
          </DialogTitle>
          <DialogDescription>
            Save reusable instructions for quick access in ChatGPT.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor={titleId}>Title</Label>
            <Input
              id={titleId}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="e.g. Code Review Helper"
              autoFocus
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={contentId}>Prompt Content</Label>
            <Textarea
              id={contentId}
              value={content}
              onChange={(event) => setContent(event.currentTarget.value)}
              placeholder="Type or paste your prompt content here..."
              className="min-h-32 resize-y"
              required
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={promptEditorController.close}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
