/**
 * Stores revision-safe, tab-scoped navigation snapshots by conversation key.
 */
import {
  mergeFingerprintRecords,
  upsertFingerprintRecord,
  type NavigationFingerprintIndex,
  type ResponseFingerprintRecord,
} from './fingerprint/index';
import {
  mergeSegmentIndexes,
  upsertResponseSegments,
  type NavigationSegmentIndex,
  type ResponseSegmentFingerprint,
} from './fingerprint/segments';

export interface ConversationNavigationSnapshot<TPrompt> {
  prompts: TPrompt[];
  fingerprintIndex: NavigationFingerprintIndex | null;
  segmentIndex: NavigationSegmentIndex | null;
  revision: number;
}

export interface NavigationSnapshotStore<TPrompt> {
  replacePrompts(conversationKey: string, prompts: TPrompt[]): number;
  completeFingerprintIndex(
    conversationKey: string,
    revision: number,
    fingerprintIndex: NavigationFingerprintIndex
  ): boolean;
  upsertFingerprintRecord(
    conversationKey: string,
    revision: number,
    fingerprintRecord: ResponseFingerprintRecord
  ): boolean;
  completeSegmentIndex(
    conversationKey: string,
    revision: number,
    segmentIndex: NavigationSegmentIndex
  ): boolean;
  upsertResponseSegments(
    conversationKey: string,
    revision: number,
    segments: ResponseSegmentFingerprint[]
  ): boolean;
  getSnapshot(
    conversationKey: string
  ): ConversationNavigationSnapshot<TPrompt> | null;
  copySnapshot(
    sourceConversationKey: string,
    targetConversationKey: string
  ): number | null;
}

/**
 * Creates an in-memory navigation snapshot store for one Content Script.
 *
 * @example
 * const store = createNavigationSnapshotStore<MyPrompt>();
 * const revision = store.replacePrompts('conversation-1', prompts);
 */
export function createNavigationSnapshotStore<
  TPrompt
>(): NavigationSnapshotStore<TPrompt> {
  const snapshots = new Map<
    string,
    ConversationNavigationSnapshot<TPrompt>
  >();

  function replacePrompts(
    conversationKey: string,
    prompts: TPrompt[]
  ): number {
    const previousSnapshot = snapshots.get(conversationKey);
    const revision = (previousSnapshot?.revision ?? 0) + 1;
    const observedRecords =
      previousSnapshot?.fingerprintIndex?.filter(
        ({ quality }) => quality === 'observed'
      ) || [];
    const observedSegments =
      previousSnapshot?.segmentIndex?.filter(
        ({ quality }) => quality === 'observed'
      ) || [];

    snapshots.set(conversationKey, {
      prompts: structuredClone(prompts),
      fingerprintIndex:
        observedRecords.length > 0
          ? cloneFingerprintIndex(observedRecords)
          : null,
      segmentIndex:
        observedSegments.length > 0
          ? cloneSegmentIndex(observedSegments)
          : null,
      revision,
    });

    return revision;
  }

  function completeSegmentIndex(
    conversationKey: string,
    revision: number,
    segmentIndex: NavigationSegmentIndex
  ): boolean {
    const snapshot = snapshots.get(conversationKey);
    if (!snapshot || snapshot.revision !== revision) return false;

    const responseIds = new Set(
      segmentIndex.map(({ responseId }) => responseId)
    );
    const observedSegments = (snapshot.segmentIndex || []).filter(
      ({ responseId, quality }) =>
        quality === 'observed' && responseIds.has(responseId)
    );
    snapshot.segmentIndex = mergeSegmentIndexes(
      observedSegments,
      segmentIndex
    );
    return true;
  }

  function upsertSnapshotResponseSegments(
    conversationKey: string,
    revision: number,
    segments: ResponseSegmentFingerprint[]
  ): boolean {
    const snapshot = snapshots.get(conversationKey);
    if (!snapshot || snapshot.revision !== revision) return false;

    snapshot.segmentIndex = upsertResponseSegments(
      snapshot.segmentIndex || [],
      segments
    );
    return true;
  }

  function completeFingerprintIndex(
    conversationKey: string,
    revision: number,
    fingerprintIndex: NavigationFingerprintIndex
  ): boolean {
    const snapshot = snapshots.get(conversationKey);

    if (!snapshot || snapshot.revision !== revision) return false;

    const currentResponseIds = new Set(
      fingerprintIndex.map(({ responseId }) => responseId)
    );
    const currentObservedRecords = (snapshot.fingerprintIndex || []).filter(
      ({ responseId, quality }) =>
        quality === 'observed' && currentResponseIds.has(responseId)
    );

    snapshot.fingerprintIndex = mergeFingerprintRecords(
      currentObservedRecords,
      fingerprintIndex
    );
    return true;
  }

  function upsertSnapshotFingerprintRecord(
    conversationKey: string,
    revision: number,
    fingerprintRecord: ResponseFingerprintRecord
  ): boolean {
    const snapshot = snapshots.get(conversationKey);

    if (!snapshot || snapshot.revision !== revision) return false;

    snapshot.fingerprintIndex = upsertFingerprintRecord(
      snapshot.fingerprintIndex || [],
      fingerprintRecord
    );
    return true;
  }

  function getSnapshot(
    conversationKey: string
  ): ConversationNavigationSnapshot<TPrompt> | null {
    const snapshot = snapshots.get(conversationKey);

    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  function copySnapshot(
    sourceConversationKey: string,
    targetConversationKey: string
  ): number | null {
    const sourceSnapshot = snapshots.get(sourceConversationKey);

    if (!sourceSnapshot) return null;

    const revision =
      Math.max(
        sourceSnapshot.revision,
        snapshots.get(targetConversationKey)?.revision ?? 0
      ) + 1;

    snapshots.set(targetConversationKey, {
      prompts: structuredClone(sourceSnapshot.prompts),
      fingerprintIndex: sourceSnapshot.fingerprintIndex
        ? cloneFingerprintIndex(sourceSnapshot.fingerprintIndex)
        : null,
      segmentIndex: sourceSnapshot.segmentIndex
        ? cloneSegmentIndex(sourceSnapshot.segmentIndex)
        : null,
      revision,
    });

    return revision;
  }

  return {
    replacePrompts,
    completeFingerprintIndex,
    upsertFingerprintRecord: upsertSnapshotFingerprintRecord,
    completeSegmentIndex,
    upsertResponseSegments: upsertSnapshotResponseSegments,
    getSnapshot,
    copySnapshot,
  };
}

/**
 * Returns a detached snapshot so callers cannot mutate cached array state.
 */
function cloneSnapshot<TPrompt>(
  snapshot: ConversationNavigationSnapshot<TPrompt>
): ConversationNavigationSnapshot<TPrompt> {
  return {
    prompts: structuredClone(snapshot.prompts),
    fingerprintIndex: snapshot.fingerprintIndex
      ? cloneFingerprintIndex(snapshot.fingerprintIndex)
      : null,
    segmentIndex: snapshot.segmentIndex
      ? cloneSegmentIndex(snapshot.segmentIndex)
      : null,
    revision: snapshot.revision,
  };
}

function cloneSegmentIndex(
  segmentIndex: NavigationSegmentIndex
): NavigationSegmentIndex {
  return segmentIndex.map((segment) => ({ ...segment }));
}

/**
 * Clones response records and their nested fingerprint arrays.
 */
function cloneFingerprintIndex(
  fingerprintIndex: NavigationFingerprintIndex
): NavigationFingerprintIndex {
  return fingerprintIndex.map((record) => ({
    responseId: record.responseId,
    promptIndex: record.promptIndex,
    quality: record.quality,
    fingerprints: record.fingerprints.map((fingerprint) => ({
      ...fingerprint,
    })),
  }));
}
