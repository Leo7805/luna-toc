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
      isComplete: false,
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
      isComplete: false,
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
      isComplete: false,
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
      isComplete: false,
    });
  });

  it('correctly handles empty prompt lists', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-empty', []);

    expect(revision).toBe(1);
    expect(store.getSnapshot('conversation-empty')).toEqual({
      prompts: [],
      revision: 1,
      isComplete: false,
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
      isComplete: false,
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
      isComplete: false,
    });
  });

  it('manages and preserves completeness metadata', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    expect(store.isComplete('conv-1')).toBe(false);

    // setComplete before prompts exist
    store.setComplete('conv-1', true);
    expect(store.isComplete('conv-1')).toBe(true);

    // replacePrompts preserves existing isComplete=true
    store.replacePrompts('conv-1', [{ id: 'p-1', text: 'One' }]);
    expect(store.isComplete('conv-1')).toBe(true);
    expect(store.getSnapshot('conv-1')?.isComplete).toBe(true);

    // copySnapshot copies isComplete=true
    store.copySnapshot('conv-1', 'conv-2');
    expect(store.isComplete('conv-2')).toBe(true);
    expect(store.getSnapshot('conv-2')?.isComplete).toBe(true);

    // explicit setComplete false
    store.setComplete('conv-1', false);
    expect(store.isComplete('conv-1')).toBe(false);
  });
  it('evicts old snapshots and clears explicitly deleted conversation entries', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    for (let index = 0; index < 10; index += 1) {
      store.replacePrompts('conv-' + index, [{ id: 'p-' + index, text: 'test' }]);
    }
    expect(store.getSnapshot('conv-0')).toBeNull();
    expect(store.getSnapshot('conv-9')).not.toBeNull();
    store.deleteConversation('conv-9');
    expect(store.getSnapshot('conv-9')).toBeNull();
    store.clear();
    expect(store.getSnapshot('conv-8')).toBeNull();
  });
});
