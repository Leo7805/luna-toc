/** Tests revision-safe tab-scoped conversation navigation snapshots. */
import { describe, expect, it } from 'vitest';
import { createNavigationSnapshotStore } from '@/navigation/jump/navigationSnapshotStore';

interface TestPrompt {
  id: string;
  text: string;
}

describe('conversation snapshot store', () => {
  it('saves and retrieves prompt snapshots for a conversation', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);

    expect(revision).toBe(1);
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      revision: 1,
    });
  });

  it('replaces existing snapshots and increments revision counter', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const firstRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'First' },
    ]);
    const secondRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-2', text: 'Second' },
    ]);

    expect(firstRevision).toBe(1);
    expect(secondRevision).toBe(2);
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-2', text: 'Second' }],
      revision: 2,
    });
  });

  it('maintains strict isolation between different conversation keys', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    store.replacePrompts('conversation-1', [{ id: 'p1', text: 'Conv 1' }]);
    store.replacePrompts('conversation-2', [{ id: 'p2', text: 'Conv 2' }]);

    expect(store.getSnapshot('conversation-1')?.prompts).toEqual([
      { id: 'p1', text: 'Conv 1' },
    ]);
    expect(store.getSnapshot('conversation-2')?.prompts).toEqual([
      { id: 'p2', text: 'Conv 2' },
    ]);
    expect(store.getSnapshot('conversation-nonexistent')).toBeNull();
  });

  it('copies snapshots between route keys with a bumped revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const sourceRevision = store.replacePrompts('WEB:temporary', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);

    const targetRevision = store.copySnapshot(
      'WEB:temporary',
      'conversation-1'
    );

    expect(targetRevision).toBeGreaterThan(sourceRevision);
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      revision: targetRevision,
    });

    // Copying from unknown source returns null
    expect(store.copySnapshot('unknown-source', 'conversation-2')).toBeNull();
  });

  it('preserves higher target revision when copying snapshot into existing key', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    store.replacePrompts('source', [{ id: 'p1', text: 'Source' }]); // rev 1
    store.replacePrompts('target', [{ id: 'p2', text: 'Target 1' }]); // rev 1
    store.replacePrompts('target', [{ id: 'p3', text: 'Target 2' }]); // rev 2

    const copiedRevision = store.copySnapshot('source', 'target');
    expect(copiedRevision).toBe(3);
    expect(store.getSnapshot('target')).toEqual({
      prompts: [{ id: 'p1', text: 'Source' }],
      revision: 3,
    });
  });

  it('correctly handles empty prompt lists', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-empty', []);

    expect(revision).toBe(1);
    expect(store.getSnapshot('conversation-empty')).toEqual({
      prompts: [],
      revision: 1,
    });
  });

  it('prevents external mutation via defensive copying on input and output', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const originalInput = [{ id: 'prompt-1', text: 'Original text' }];

    const revision = store.replacePrompts('conversation-1', originalInput);

    // Mutate input array and nested object after storing
    originalInput[0]!.text = 'Mutated input';
    originalInput.push({ id: 'prompt-2', text: 'Pushed input' });

    // Store snapshot should remain unchanged
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Original text' }],
      revision,
    });

    // Mutate retrieved snapshot output
    const snapshot = store.getSnapshot('conversation-1');
    if (snapshot?.prompts[0]) {
      snapshot.prompts[0].text = 'Mutated output';
    }
    snapshot?.prompts.push({ id: 'prompt-3', text: 'Pushed output' });

    // Subsequent retrieval should still be unpolluted
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Original text' }],
      revision,
    });
  });
});
