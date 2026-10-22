/** Provides an accessible React dialog for editing TOC display labels. */
import { useId, useState, useSyncExternalStore } from 'react';
import type { SubmitEvent } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tocRenameEditorController } from '@/features/conversationPrompts/tocRenameEditor';
import { getReactPortalContainer } from '@/reactHost/portalContainer';

/** Connects the rename editor to the shared Shadow DOM React host. */
export function TocRenameDialogHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(
    tocRenameEditorController.subscribe,
    tocRenameEditorController.getSnapshot
  );
  if (!request) return null;
  return <TocRenameDialog key={request.id} value={request.value} onSubmit={request.onSubmit} />;
}

function TocRenameDialog({ value, onSubmit }: {
  value: string;
  onSubmit: (value: string) => Promise<void>;
}): React.JSX.Element {
  const inputId = useId();
  const [text, setText] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const label = text.trim();
    if (!label || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      await onSubmit(label);
      tocRenameEditorController.close();
    } catch {
      setError('保存失败，请检查扩展存储状态后重试。');
      setIsSaving(false);
    }
  };
  return <Dialog open onOpenChange={(open) => {
    if (!open && !isSaving) tocRenameEditorController.close();
  }}>
    <DialogContent
      portalContainer={getReactPortalContainer()}
      overlayClassName="z-[var(--ct-z-modal,1100)] bg-black/65 backdrop-blur-sm"
      className="z-[var(--ct-z-modal,1100)] w-[calc(100vw-2rem)] max-w-120 border border-border bg-popover/95 p-0 shadow-2xl"
    >
      <DialogHeader className="border-b border-border px-5 py-4 pr-12">
        <DialogTitle className="text-lg text-primary">修改目录文字</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4 px-5 py-4">
        <Label htmlFor={inputId}>目录显示文字（不修改 ChatGPT 原始提问）</Label>
        <Input id={inputId} autoFocus required maxLength={240}
          value={text} disabled={isSaving}
          onChange={(event) => setText(event.currentTarget.value)}
          className="bg-background text-foreground" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSaving}
            onClick={tocRenameEditorController.close}>取消</Button>
          <Button type="submit" disabled={!text.trim() || isSaving}>
            {isSaving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
