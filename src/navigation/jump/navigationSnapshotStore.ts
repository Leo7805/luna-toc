/**
 * Stores revision-safe, tab-scoped navigation snapshots by conversation key.
 */

export interface ConversationNavigationSnapshot<TPrompt> {
  prompts: TPrompt[];
  revision: number;
}

export interface NavigationSnapshotStore<TPrompt> {
  replacePrompts(conversationKey: string, prompts: TPrompt[]): number;
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

    snapshots.set(conversationKey, {
      prompts: structuredClone(prompts),
      revision,
    });

    return revision;
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
      revision,
    });

    return revision;
  }

  return {
    replacePrompts,
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
    revision: snapshot.revision,
  };
}
