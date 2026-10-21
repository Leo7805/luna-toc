/** @vitest-environment jsdom */
/** Confirms TOC-created prompt provenance persists and unadd deletes one record. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializePromptLibrary, removeMyPrompt, showDialog } from '@/features/myPrompts/promptLibrary';
import { promptEditorController } from '@/features/myPrompts/promptEditor';
import type { PromptStore, SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageStore } from '@/features/myPrompts/promptUsageStore';

let entries: SavedPrompt[];
let store: PromptStore;
const removedUsage = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  entries = [];
  removedUsage.mockClear();
  store = {
    getAll: async () => entries.map((p) => ({ ...p })),
    saveAll: async (prompts) => { entries = prompts.map((p) => ({ ...p })); },
    update: async (transform) => {
      entries = transform(entries.map((p) => ({ ...p })));
    },
    subscribe: () => () => {},
  };
  const usage: PromptUsageStore = {
    getAll: async () => ({}),
    recordUse: async () => {},
    remove: removedUsage,
    clear: async () => {},
  };
  initializePromptLibrary({
    promptsStore: store,
    promptUsageStore: usage,
    insertIntoChatGPTInput: () => {},
  });
});

describe('saved TOC prompt lifecycle', () => {
  it('persists origin when submitting from the TOC editor', async () => {
    const onSave = vi.fn();
    showDialog({ title: 'Original title', content: 'Original content', sourceMessageId: 'msg-42' }, onSave);
    const request = promptEditorController.getSnapshot()!;
    await request.onSubmit({ title: 'Edited title', content: 'Edited content' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Edited title',
      content: 'Edited content',
      sourceMessageId: 'msg-42',
    });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('deletes only the selected saved prompt and retains unrelated entries', async () => {
    entries = [
      { id: 'from-toc', sourceMessageId: 'msg-42', title: 'One', content: 'Same', createdAt: 1, updatedAt: 1 },
      { id: 'manual', title: 'Two', content: 'Same', createdAt: 1, updatedAt: 1 },
    ];
    await removeMyPrompt('from-toc');
    expect(entries.map((p) => p.id)).toEqual(['manual']);
    expect(removedUsage).toHaveBeenCalledWith('from-toc');
  });

  it('rejects removal when saved prompt was already deleted', async () => {
    entries = [{ id: 'existing', title: 'Keep', content: 'Something', createdAt: 1, updatedAt: 1 }];
    await expect(removeMyPrompt('missing')).rejects.toThrow('no longer exists');
    expect(entries.map((p) => p.id)).toEqual(['existing']);
  });
});
