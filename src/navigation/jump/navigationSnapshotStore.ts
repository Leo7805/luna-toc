/**
 * Stores revision-safe, tab-scoped navigation snapshots by conversation key.
 */

export interface ConversationNavigationSnapshot<TPrompt> {
  prompts: TPrompt[];
  revision: number;
  isComplete: boolean;
}

export interface NavigationSnapshotStore<TPrompt> {
  replacePrompts(
    conversationKey: string,
    prompts: TPrompt[],
    isComplete?: boolean
  ): number;
  setComplete(conversationKey: string, isComplete: boolean): void;
  isComplete(conversationKey: string): boolean;
  getSnapshot(
    conversationKey: string
  ): ConversationNavigationSnapshot<TPrompt> | null;
  copySnapshot(
    sourceConversationKey: string,
    targetConversationKey: string
  ): number | null;
  deleteConversation(conversationKey: string): void;
  clear(): void;
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
  const MAX_SNAPSHOTS = 8;
  const snapshots = new Map<
    string,
    ConversationNavigationSnapshot<TPrompt>
  >();

  function saveSnapshot(key: string, snapshot: ConversationNavigationSnapshot<TPrompt>): void {
    snapshots.delete(key);
    snapshots.set(key, snapshot);
    if (snapshots.size > MAX_SNAPSHOTS) {
      const oldestKey = snapshots.keys().next().value;
      if (oldestKey) snapshots.delete(oldestKey);
    }
  }

  function replacePrompts(
    conversationKey: string,
    prompts: TPrompt[],
    isComplete?: boolean
  ): number {
    const previousSnapshot = snapshots.get(conversationKey);
    const revision = (previousSnapshot?.revision ?? 0) + 1;
    const nextIsComplete =
      isComplete !== undefined
        ? isComplete
        : (previousSnapshot?.isComplete ?? false);

    saveSnapshot(conversationKey, {
      prompts: structuredClone(prompts),
      revision,
      isComplete: nextIsComplete,
    });

    return revision;
  }

  function setComplete(conversationKey: string, isComplete: boolean): void {
    const previousSnapshot = snapshots.get(conversationKey);
    if (previousSnapshot) {
      previousSnapshot.isComplete = isComplete;
    } else {
      saveSnapshot(conversationKey, {
        prompts: [],
        revision: 1,
        isComplete,
      });
    }
  }

  function isComplete(conversationKey: string): boolean {
    const snapshot = snapshots.get(conversationKey);
    return snapshot?.isComplete === true;
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

    saveSnapshot(targetConversationKey, {
      prompts: structuredClone(sourceSnapshot.prompts),
      revision,
      isComplete: sourceSnapshot.isComplete ?? false,
    });

    return revision;
  }

  return {
    replacePrompts,
    setComplete,
    isComplete,
    getSnapshot,
    copySnapshot,
    deleteConversation: (conversationKey) => { snapshots.delete(conversationKey); },
    clear: () => { snapshots.clear(); },
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
    isComplete: snapshot.isComplete ?? false,
  };
}
