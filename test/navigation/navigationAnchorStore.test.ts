/** Tests memory and persisted virtual-navigation anchor caching. */
import { describe, expect, it } from 'vitest';
import {
  createNavigationAnchorStore,
  type NavigationAnchorInput,
  type NavigationAnchorStorage,
  type PersistentNavigationAnchorCache,
} from '@/features/navigation/navigationAnchorStore';

const DAY_MS = 24 * 60 * 60 * 1_000;

function createInput(
  overrides: Partial<NavigationAnchorInput> = {}
): NavigationAnchorInput {
  return {
    conversationKey: 'conversation-1',
    promptId: 'prompt-1',
    promptIndex: 1,
    scrollTop: 450,
    scrollHeight: 1_100,
    viewportWidth: 1_280,
    viewportHeight: 100,
    ...overrides,
  };
}

function createMemoryStorage(
  initialValue?: unknown
): NavigationAnchorStorage & {
  value: unknown;
  writeCount: number;
} {
  return {
    value: initialValue,
    writeCount: 0,
    async read() {
      return this.value;
    },
    async write(value) {
      this.value = structuredClone(value);
      this.writeCount += 1;
    },
  };
}

describe('navigation anchor store', () => {
  it('keeps observations in memory without writing persistent storage', () => {
    const storage = createMemoryStorage();
    const store = createNavigationAnchorStore({ storage, now: () => 100 });

    store.recordObservation(createInput());

    expect(store.getObservedAnchors('conversation-1')).toEqual([
      expect.objectContaining({
        promptId: 'prompt-1',
        promptIndex: 1,
        scrollProgress: 0.45,
        updatedAt: 100,
      }),
    ]);
    expect(storage.writeCount).toBe(0);
  });

  it('persists and reloads only confirmed anchors', async () => {
    const storage = createMemoryStorage();
    const firstStore = createNavigationAnchorStore({
      storage,
      now: () => 200,
    });
    await firstStore.recordConfirmed(createInput());
    const secondStore = createNavigationAnchorStore({
      storage,
      now: () => 300,
    });

    await expect(
      secondStore.findConfirmed({
        conversationKey: 'conversation-1',
        promptId: 'prompt-1',
        promptIndex: 1,
        viewportWidth: 1_280,
      })
    ).resolves.toMatchObject({
      scrollTop: 450,
      scrollProgress: 0.45,
      updatedAt: 200,
    });
  });

  it('rejects anchors whose prompt identity or viewport width changed', async () => {
    const storage = createMemoryStorage();
    const store = createNavigationAnchorStore({
      storage,
      viewportWidthTolerance: 40,
    });
    await store.recordConfirmed(createInput());

    await expect(
      store.findConfirmed({
        conversationKey: 'conversation-1',
        promptId: 'different-prompt',
        promptIndex: 1,
        viewportWidth: 1_280,
      })
    ).resolves.toBeNull();
    await expect(
      store.findConfirmed({
        conversationKey: 'conversation-1',
        promptId: 'prompt-1',
        promptIndex: 1,
        viewportWidth: 1_400,
      })
    ).resolves.toBeNull();
  });

  it('keeps only the most recently confirmed anchors per conversation', async () => {
    let currentTime = 0;
    const storage = createMemoryStorage();
    const store = createNavigationAnchorStore({
      storage,
      now: () => ++currentTime,
      maxAnchorsPerConversation: 2,
    });

    await store.recordConfirmed(
      createInput({ promptId: 'prompt-1', promptIndex: 1 })
    );
    await store.recordConfirmed(
      createInput({ promptId: 'prompt-2', promptIndex: 2 })
    );
    await store.recordConfirmed(
      createInput({ promptId: 'prompt-3', promptIndex: 3 })
    );

    await expect(
      store.getConfirmedAnchors('conversation-1')
    ).resolves.toMatchObject([
      { promptId: 'prompt-2', promptIndex: 2 },
      { promptId: 'prompt-3', promptIndex: 3 },
    ]);
  });

  it('evicts the least recently confirmed conversations', async () => {
    let currentTime = 0;
    const storage = createMemoryStorage();
    const store = createNavigationAnchorStore({
      storage,
      now: () => ++currentTime,
      maxConversations: 2,
    });

    await store.recordConfirmed(
      createInput({ conversationKey: 'conversation-1' })
    );
    await store.recordConfirmed(
      createInput({ conversationKey: 'conversation-2' })
    );
    await store.recordConfirmed(
      createInput({ conversationKey: 'conversation-3' })
    );

    const cache = storage.value as PersistentNavigationAnchorCache;
    expect(Object.keys(cache.conversations)).toEqual([
      'conversation-3',
      'conversation-2',
    ]);
  });

  it('drops confirmed anchors after the configured age', async () => {
    let currentTime = 0;
    const storage = createMemoryStorage();
    const store = createNavigationAnchorStore({
      storage,
      now: () => currentTime,
      maxAgeMs: 30 * DAY_MS,
    });
    await store.recordConfirmed(createInput());
    currentTime = 31 * DAY_MS;

    await expect(
      store.getConfirmedAnchors('conversation-1')
    ).resolves.toEqual([]);
  });

  it('ignores malformed or incompatible persisted cache values', async () => {
    const storage = createMemoryStorage({
      version: 99,
      conversations: {
        invalid: {
          anchors: [{ promptId: 'unsafe' }],
        },
      },
    });
    const store = createNavigationAnchorStore({ storage });

    await expect(store.getConfirmedAnchors('invalid')).resolves.toEqual([]);
  });
});
