/**
 * Service-worker bridge for per-tab compatibility warnings in Chrome's toolbar.
 */
import {
  PROMPT_COMMIT_TYPE, createPromptWriteCoordinator,
} from '@/features/myPrompts/promptWriteCoordinator';
import { PROMPT_USAGE_COMMIT_TYPE, createPromptUsageWriteCoordinator } from '@/features/myPrompts/promptUsageWriteCoordinator';
import { SETTINGS_COMMIT_TYPE, createSettingsWriteCoordinator } from '@/features/storage/settingsWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';
import {
  BACKUP_STORAGE_MESSAGE_TYPE, createLocalBackup, restoreLocalBackup,
  type BackupStorageMessage, type BackupStorageResponse, type LocalBackup,
} from '@/features/backup/localBackup';
import {
  TOC_ALIAS_COMMIT_TYPE,
  createTocAliasWriteCoordinator,
} from '@/features/conversationPrompts/tocAliasWriteCoordinator';
import {
  TOOLBAR_COMPATIBILITY_WARNING,
  TOOLBAR_COMPATIBILITY_HEALTHY,
} from '@/features/contractAlert/toolbarWarning';
import { createToolbarWarningController } from '@/features/contractAlert/toolbarBackground';
import { installRemoteDeletionObserver } from '@/background/remoteDeletionObserver';

// Observe only actual successful ChatGPT delete/visibility-removal mutations in the browser network layer.
// The observer never stores request bodies and only sends a route ID to the originating tab.
installRemoteDeletionObserver();

const toolbar = createToolbarWarningController(chrome.storage.session, chrome.action);
const storageWriteQueue = createSerialWriteQueue();
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== 'object') return;
  const payload = message as { type?: unknown; detail?: unknown; revision?: unknown };
  const kind = payload.type === TOOLBAR_COMPATIBILITY_WARNING ? 'warning'
    : payload.type === TOOLBAR_COMPATIBILITY_HEALTHY ? 'healthy' : null;
  if (!kind) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined ||
      sender.frameId !== 0 ||
      (sender.documentLifecycle && sender.documentLifecycle !== 'active') ||
      !/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(sender.url ?? '') ||
      !Number.isSafeInteger(payload.revision) ||
      (payload.revision as number) < 1 ||
      (kind === 'warning' &&
        (typeof payload.detail !== 'string' || !payload.detail.trim()))) return;

  void toolbar.update(tabId, {
    kind,
    revision: payload.revision as number,
    documentId: sender.documentId ?? '',
    detail: kind === 'warning' ? (payload.detail as string).slice(0, 180) : undefined,
  }).catch(() => {
    // A tab can close or an extension context can expire during async updates.
  });
});

/** Discard previous-document warnings during a full navigation. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  void toolbar.clear(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void toolbar.clear(tabId, false).catch(() => {});
});

/**
 * Handle prompt writes only from this extension. Returning true keeps the
 * MV3 message event alive until the queued storage write has completed.
 */
const promptCoordinator = createPromptWriteCoordinator(chrome.storage.local, storageWriteQueue);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' ||
      (message as { type?: unknown }).type !== PROMPT_COMMIT_TYPE) return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Untrusted extension message sender' });
    return false;
  }
  void promptCoordinator.commit(message).then(sendResponse, () =>
    sendResponse({ ok: false, error: 'Prompt storage writer unavailable' })
  );
  return true;
});

/** Orders TOC alias mutations and confirmed deletion fences with backup writes. */
const tocAliasCoordinator = createTocAliasWriteCoordinator(chrome.storage.local, storageWriteQueue);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' ||
      (message as { type?: unknown }).type !== TOC_ALIAS_COMMIT_TYPE) return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Untrusted extension message sender' });
    return false;
  }
  void tocAliasCoordinator.commit(message).then(sendResponse, () =>
    sendResponse({ ok: false, error: 'TOC alias writer unavailable' })
  );
  return true;
});


const promptUsageCoordinator = createPromptUsageWriteCoordinator(chrome.storage.local, storageWriteQueue);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' ||
      (message as { type?: unknown }).type !== PROMPT_USAGE_COMMIT_TYPE) return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Untrusted extension message sender' });
    return false;
  }
  void promptUsageCoordinator.commit(message).then(sendResponse, () =>
    sendResponse({ ok: false, error: 'Prompt usage writer unavailable' })
  );
  return true;
});

const settingsCoordinator = createSettingsWriteCoordinator(chrome.storage.local, storageWriteQueue);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' ||
      (message as { type?: unknown }).type !== SETTINGS_COMMIT_TYPE) return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Untrusted extension message sender' });
    return false;
  }
  const action = (message as { action?: unknown }).action;
  if (action === 'register-account' &&
      (sender.tab?.id === undefined || sender.frameId !== 0 ||
       (sender.documentLifecycle && sender.documentLifecycle !== 'active') ||
       !/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(sender.url ?? ''))) {
    sendResponse({ ok: false, error: 'Account registration requires an active ChatGPT content context' });
    return false;
  }
  void settingsCoordinator.commit(message).then(sendResponse, () =>
    sendResponse({ ok: false, error: 'Settings writer unavailable' })
  );
  return true;
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' ||
      (message as { type?: unknown }).type !== BACKUP_STORAGE_MESSAGE_TYPE) return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Untrusted extension message sender' });
    return false;
  }
  const request = message as BackupStorageMessage;
  void storageWriteQueue.run(async (): Promise<BackupStorageResponse> => {
    if (request.action === 'export') {
      return { ok: true, backup: await createLocalBackup(chrome.storage.local) };
    }
    if (request.action !== 'restore' ||
        (request.mode !== 'merge' && request.mode !== 'replace')) {
      return { ok: false, error: 'Invalid backup request' };
    }
    await restoreLocalBackup(request.backup as LocalBackup, request.mode, chrome.storage.local);
    return { ok: true };
  }).then(sendResponse, (error: unknown) => sendResponse({
    ok: false, error: error instanceof Error ? error.message : 'Local backup operation failed',
  }));
  return true;
});
