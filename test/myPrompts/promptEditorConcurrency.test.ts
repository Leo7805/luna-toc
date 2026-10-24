/** @vitest-environment jsdom */
/** Exercises single-tab editor saves and repeated submissions. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializePromptLibrary, showDialog,
} from '@/features/myPrompts/promptLibrary';
import { promptEditorController } from '@/features/myPrompts/promptEditor';
import type { PromptStore, SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageStore } from '@/features/myPrompts/promptUsageStore';
import { setActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';

const first: SavedPrompt = {
  id: 'prompt-1', ownerId: 'account-1', title: 'Old title', content: 'old content',
  createdAt: 1, updatedAt: 1,
};
let saved: SavedPrompt[];
const clone = (rows: SavedPrompt[]): SavedPrompt[] => rows.map((row) => ({ ...row }));

beforeEach(() => {
  setActiveConversationOwner('account-1');
  document.body.innerHTML = '';
  saved = clone([first]);
  const store: PromptStore = {
    clearAll: vi.fn(async () => {}),
    getAll: async () => clone(saved),
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
  setActiveConversationOwner(null);
});

describe('My Prompts editor saves', () => {
  it('updates a prompt using its stable ID', async () => {
    showDialog(first);
    await promptEditorController.getSnapshot()!.onSubmit({
      title: 'Edited title', content: 'Edited content',
    });
    expect(saved[0].title).toBe('Edited title');
    expect(saved[0].content).toBe('Edited content');
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
