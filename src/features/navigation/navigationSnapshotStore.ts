/**
 * Stores revision-safe, tab-scoped navigation snapshots by conversation key.
 */
import type { PromptFingerprintIndex } from './fingerprintIndex';

export interface ConversationNavigationSnapshot<TPrompt> {
  prompts: TPrompt[];
  fingerprintIndex: PromptFingerprintIndex[] | null;
  revision: number;
}

export interface NavigationSnapshotStore<TPrompt> {
  replacePrompts(conversationKey: string, prompts: TPrompt[]): number;
  completeFingerprintIndex(
    conversationKey: string,
    revision: number,
    fingerprintIndex: PromptFingerprintIndex[]
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
    const revision = (snapshots.get(conversationKey)?.revision ?? 0) + 1;

    snapshots.set(conversationKey, {
      prompts: structuredClone(prompts),
      fingerprintIndex: null,
      revision,
    });

    return revision;
  }

  function completeFingerprintIndex(
    conversationKey: string,
    revision: number,
    fingerprintIndex: PromptFingerprintIndex[]
  ): boolean {
    const snapshot = snapshots.get(conversationKey);

    if (!snapshot || snapshot.revision !== revision) return false;

    snapshot.fingerprintIndex = cloneFingerprintIndex(fingerprintIndex);
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
      revision,
    });

    return revision;
  }

  return {
    replacePrompts,
    completeFingerprintIndex,
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
    revision: snapshot.revision,
  };
}

/**
 * Clones the nested fingerprint arrays stored for each prompt.
 */
function cloneFingerprintIndex(
  fingerprintIndex: PromptFingerprintIndex[]
): PromptFingerprintIndex[] {
  return fingerprintIndex.map((entry) => ({
    promptIndex: entry.promptIndex,
    fingerprints: entry.fingerprints.map((fingerprint) => ({
      ...fingerprint,
    })),
  }));
}
