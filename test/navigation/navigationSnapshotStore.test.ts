/** Tests revision-safe tab-scoped conversation navigation snapshots. */
import { describe, expect, it } from 'vitest';
import { createNavigationSnapshotStore } from '@/features/navigation/navigationSnapshotStore';
import type { PromptFingerprintIndex } from '@/features/navigation/fingerprintIndex';

interface TestPrompt {
  id: string;
  text: string;
}

const fingerprintIndex: PromptFingerprintIndex[] = [
  {
    promptIndex: 0,
    fingerprints: [
      {
        responseId: 'response-1',
        sampleIndex: 0,
        textOffset: 0,
        probeText: 'Answer',
        verificationHash: 'hash',
        verificationLength: 6,
      },
    ],
  },
];

describe('conversation snapshot store', () => {
  it('stores prompts immediately and completes matching fingerprint work', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);

    expect(store.getSnapshot('conversation-1')).toMatchObject({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      fingerprintIndex: null,
      revision,
    });
    expect(
      store.completeFingerprintIndex(
        'conversation-1',
        revision,
        fingerprintIndex
      )
    ).toBe(true);
    expect(
      store.getSnapshot('conversation-1')?.fingerprintIndex
    ).toEqual(fingerprintIndex);
  });

  it('rejects stale asynchronous fingerprint results', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const staleRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Old prompt' },
    ]);
    const currentRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-2', text: 'New prompt' },
    ]);

    expect(currentRevision).toBeGreaterThan(staleRevision);
    expect(
      store.completeFingerprintIndex(
        'conversation-1',
        staleRevision,
        fingerprintIndex
      )
    ).toBe(false);
    expect(store.getSnapshot('conversation-1')?.fingerprintIndex).toBeNull();
  });

  it('returns detached prompt and fingerprint arrays', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);
    store.completeFingerprintIndex(
      'conversation-1',
      revision,
      fingerprintIndex
    );

    const snapshot = store.getSnapshot('conversation-1');
    if (snapshot?.prompts[0]) snapshot.prompts[0].text = 'Changed';
    snapshot?.prompts.push({ id: 'external', text: 'External' });
    snapshot?.fingerprintIndex?.push({
      promptIndex: 1,
      fingerprints: [],
    });
    snapshot?.fingerprintIndex?.[0]?.fingerprints.push({
      ...fingerprintIndex[0]!.fingerprints[0]!,
      responseId: 'external',
    });
    if (snapshot?.fingerprintIndex?.[0]?.fingerprints[0]) {
      snapshot.fingerprintIndex[0].fingerprints[0].probeText = 'Changed';
    }

    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      fingerprintIndex,
      revision,
    });
  });

  it('copies temporary-route snapshots with a new target revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const sourceRevision = store.replacePrompts('WEB:temporary', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);
    store.completeFingerprintIndex(
      'WEB:temporary',
      sourceRevision,
      fingerprintIndex
    );

    const targetRevision = store.copySnapshot(
      'WEB:temporary',
      'conversation-1'
    );

    expect(targetRevision).toBeGreaterThan(sourceRevision);
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      fingerprintIndex,
      revision: targetRevision,
    });
  });
});
