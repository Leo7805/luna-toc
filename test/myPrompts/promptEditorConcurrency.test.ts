/** @vitest-environment jsdom */
/** Exercises the real editor's stale-data guard, not only a synthetic store transform. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializePromptLibrary, showDialog,
} from '@/features/myPrompts/promptLibrary';
import { promptEditorController } from '@/features/myPrompts/promptEditor';
import type { PromptStore, SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageStore } from '@/features/myPrompts/promptUsageStore';

const first: SavedPrompt = {
  id: 'prompt-1', title: 'Old title', content: 'old content',
  createdAt: 1, updatedAt: 1,
};
let saved: SavedPrompt[];
const clone = (rows: SavedPrompt[]): SavedPrompt[] => rows.map((row) => ({ ...row }));

beforeEach(() => {
  document.body.innerHTML = '';
  saved = clone([first]);
  const store: PromptStore = {
    getAll: async () => clone(saved),
    saveAll: async (next) => { saved = clone(next); },
    update: async (transform) => {
      saved = clone(transform(clone(saved)));
    },
    subscribe: () => () => {},
  };
  const usage = {
    getAll: async () => ({}),
    recordUse: async () => {},
    remove: async () => {},
    clear: async () => {},
    reconcile: async () => {},
  } satisfies PromptUsageStore;
  initializePromptLibrary({
    promptsStore: store, promptUsageStore: usage,
    insertIntoChatGPTInput: vi.fn(),
  });
});

afterEach(() => {
  promptEditorController.close();
  document.body.innerHTML = '';
});

describe('My Prompts editor stale record protection', () => {
  it('blocks and explains an edit started before another tab changed the prompt', async () => {
    showDialog(first);
    saved[0].title = 'Changed in other tab';
    saved[0].updatedAt = 2;
    const submit = promptEditorController.getSnapshot()!.onSubmit({
      title: 'My stale edit', content: 'changed',
    });
    await vi.waitFor(() => expect(document.querySelector('#myprompt-message-confirm')).not.toBeNull());
    expect(document.querySelector('#chat-toc-myprompt-message-modal')?.textContent)
      .toContain('其他标签页修改');
    (document.querySelector('#myprompt-message-confirm') as HTMLButtonElement).click();
    await expect(submit).rejects.toThrow('其他标签页');
    expect(saved[0].title).toBe('Changed in other tab');
  });

  it('uses the same ID for retrying the same new-prompt editor submission', async () => {
    showDialog(null);
    const submit = promptEditorController.getSnapshot()!.onSubmit;
    await submit({ title: 'Created once', content: 'Text' });
    await submit({ title: 'Created once', content: 'Text' });
    expect(saved.filter((p) => p.title === 'Created once')).toHaveLength(1);
    expect(saved).toHaveLength(2);
  });

  it('still supports a partial editor item that only supplies an ID', async () => {
    showDialog({ id: 'prompt-1' });
    await promptEditorController.getSnapshot()!.onSubmit({
      title: 'Updated', content: 'Updated content',
    });
    expect(saved[0].title).toBe('Updated');
  });
});
