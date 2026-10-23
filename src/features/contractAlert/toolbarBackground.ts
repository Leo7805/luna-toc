/**
 * Serializes per-tab toolbar updates, and persists the latest revision in
 * session storage so a delayed warning cannot resurrect a recovered badge.
 */
import { toolbarWarningKey } from './toolbarWarning';

export interface ToolbarUpdate {
  kind: 'warning' | 'healthy';
  revision: number;
  documentId: string;
  detail?: string;
}

interface SessionStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface BadgeAction {
  setBadgeText(details: { tabId: number; text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void>;
}

export function createToolbarWarningController(
  session: SessionStore,
  action: BadgeAction
): {
  update: (tabId: number, update: ToolbarUpdate) => Promise<void>;
  clear: (tabId: number, removeBadge?: boolean) => Promise<void>;
} {
  const queues = new Map<number, Promise<void>>();
  const enqueue = (tabId: number, work: () => Promise<void>): Promise<void> => {
    const prior = queues.get(tabId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    queues.set(tabId, next);
    void next.then(
      () => { if (queues.get(tabId) === next) queues.delete(tabId); },
      () => { if (queues.get(tabId) === next) queues.delete(tabId); }
    );
    return next;
  };

  return {
    update(tabId, update) {
      return enqueue(tabId, async () => {
        const key = toolbarWarningKey(tabId);
        const saved = (await session.get(key))[key];
        if (saved && typeof saved === 'object') {
          const previous = saved as Record<string, unknown>;
          if (previous.documentId === update.documentId &&
              typeof previous.revision === 'number' &&
              previous.revision >= update.revision) return;
        }

        if (update.kind === 'healthy') {
          // Keep a tombstone: removing the key would lose the ordering fence.
          await session.set({ [key]: {
            state: 'healthy', documentId: update.documentId, revision: update.revision,
          } });
          await action.setBadgeText({ text: '', tabId });
          return;
        }

        await session.set({ [key]: {
          state: 'warning',
          documentId: update.documentId,
          revision: update.revision,
          detail: update.detail ?? '',
          observedAt: Date.now(),
        } });
        await action.setBadgeBackgroundColor({ color: '#b91c1c', tabId });
        await action.setBadgeText({ text: '!', tabId });
      });
    },
    clear(tabId, removeBadge = true) {
      return enqueue(tabId, async () => {
        await session.remove(toolbarWarningKey(tabId));
        if (removeBadge) await action.setBadgeText({ text: '', tabId });
      });
    },
  };
}
