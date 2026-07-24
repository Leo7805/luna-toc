/** Tests revision-safe tab-scoped conversation navigation snapshots. */
import { describe, expect, it } from 'vitest';
import { createNavigationSnapshotStore } from '@/features/navigation/navigationSnapshotStore';
import type {
  NavigationFingerprintIndex,
  ResponseFingerprintRecord,
} from '@/features/navigation/fingerprint/index';

interface TestPrompt {
  id: string;
  text: string;
}

const fingerprintIndex: NavigationFingerprintIndex = [
  {
    responseId: 'response-1',
    promptIndex: 0,
    quality: 'derived',
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
const segmentIndex = [
  {
    responseId: 'response-1',
    promptIndex: 0,
    segmentIndex: 0,
    segmentCount: 1,
    positionRatio: 0,
    probeText: 'Answer',
    verificationHash: 'segment-hash',
    verificationLength: 6,
    quality: 'derived' as const,
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
      segmentIndex: null,
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

  it('stores segments only for the matching revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const staleRevision = store.replacePrompts('conversation-1', []);
    const revision = store.replacePrompts('conversation-1', []);

    expect(
      store.completeSegmentIndex(
        'conversation-1',
        staleRevision,
        segmentIndex
      )
    ).toBe(false);
    expect(
      store.completeSegmentIndex(
        'conversation-1',
        revision,
        segmentIndex
      )
    ).toBe(true);
    expect(store.getSnapshot('conversation-1')?.segmentIndex).toEqual(
      segmentIndex
    );
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
    store.completeSegmentIndex('conversation-1', revision, segmentIndex);

    const snapshot = store.getSnapshot('conversation-1');
    if (snapshot?.prompts[0]) snapshot.prompts[0].text = 'Changed';
    snapshot?.prompts.push({ id: 'external', text: 'External' });
    snapshot?.fingerprintIndex?.push({
      responseId: 'external',
      promptIndex: 1,
      quality: 'observed',
      fingerprints: [],
    });
    snapshot?.fingerprintIndex?.[0]?.fingerprints.push({
      ...fingerprintIndex[0]!.fingerprints[0]!,
      responseId: 'external',
    });
    if (snapshot?.segmentIndex?.[0]) {
      snapshot.segmentIndex[0].probeText = 'Changed segment';
    }
    if (snapshot?.fingerprintIndex?.[0]?.fingerprints[0]) {
      snapshot.fingerprintIndex[0].fingerprints[0].probeText = 'Changed';
    }

    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      fingerprintIndex,
      segmentIndex,
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
    store.completeSegmentIndex(
      'WEB:temporary',
      sourceRevision,
      segmentIndex
    );

    const targetRevision = store.copySnapshot(
      'WEB:temporary',
      'conversation-1'
    );

    expect(targetRevision).toBeGreaterThan(sourceRevision);
    expect(store.getSnapshot('conversation-1')).toEqual({
      prompts: [{ id: 'prompt-1', text: 'Prompt' }],
      fingerprintIndex,
      segmentIndex,
      revision: targetRevision,
    });
  });

  it('keeps observed data when a derived build completes later', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const revision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);
    const observedRecord: ResponseFingerprintRecord = {
      ...fingerprintIndex[0]!,
      quality: 'observed',
      fingerprints: fingerprintIndex[0]!.fingerprints.map((fingerprint) => ({
        ...fingerprint,
        probeText: 'Observed',
      })),
    };

    expect(
      store.upsertFingerprintRecord(
        'conversation-1',
        revision,
        observedRecord
      )
    ).toBe(true);
    expect(
      store.completeFingerprintIndex(
        'conversation-1',
        revision,
        fingerprintIndex
      )
    ).toBe(true);
    expect(store.getSnapshot('conversation-1')?.fingerprintIndex).toEqual([
      observedRecord,
    ]);
  });

  it('preserves observed records across a new prompt revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const firstRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
    ]);
    const observedRecord: ResponseFingerprintRecord = {
      ...fingerprintIndex[0]!,
      quality: 'observed',
    };
    store.completeFingerprintIndex(
      'conversation-1',
      firstRevision,
      fingerprintIndex
    );
    store.upsertFingerprintRecord(
      'conversation-1',
      firstRevision,
      observedRecord
    );

    const nextRevision = store.replacePrompts('conversation-1', [
      { id: 'prompt-1', text: 'Prompt' },
      { id: 'prompt-2', text: 'New prompt' },
    ]);

    expect(store.getSnapshot('conversation-1')?.fingerprintIndex).toEqual([
      observedRecord,
    ]);
    store.completeFingerprintIndex(
      'conversation-1',
      nextRevision,
      fingerprintIndex
    );
    expect(store.getSnapshot('conversation-1')?.fingerprintIndex).toEqual([
      observedRecord,
    ]);
  });

  it('removes observed records absent from the completed revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const firstRevision = store.replacePrompts('conversation-1', []);
    store.upsertFingerprintRecord(
      'conversation-1',
      firstRevision,
      {
        ...fingerprintIndex[0]!,
        quality: 'observed',
      }
    );
    const nextRevision = store.replacePrompts('conversation-1', []);

    store.completeFingerprintIndex('conversation-1', nextRevision, []);

    expect(store.getSnapshot('conversation-1')?.fingerprintIndex).toEqual([]);
  });

  it('rejects observed records for a stale snapshot revision', () => {
    const store = createNavigationSnapshotStore<TestPrompt>();
    const staleRevision = store.replacePrompts('conversation-1', []);
    store.replacePrompts('conversation-1', []);

    expect(
      store.upsertFingerprintRecord(
        'conversation-1',
        staleRevision,
        {
          ...fingerprintIndex[0]!,
          quality: 'observed',
        }
      )
    ).toBe(false);
  });
});
