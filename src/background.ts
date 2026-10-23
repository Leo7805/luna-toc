/**
 * Service-worker bridge for per-tab compatibility warnings in Chrome's toolbar.
 */
import {
  PROMPT_COMMIT_TYPE,
  createPromptWriteCoordinator,
} from '@/features/myPrompts/promptWriteCoordinator';
import {
  TOC_ALIAS_COMMIT_TYPE,
  createTocAliasWriteCoordinator,
} from '@/features/conversationPrompts/tocAliasWriteCoordinator';
import {
  TOOLBAR_COMPATIBILITY_WARNING,
  TOOLBAR_COMPATIBILITY_HEALTHY,
} from '@/features/contractAlert/toolbarWarning';
import { createToolbarWarningController } from '@/features/contractAlert/toolbarBackground';

const toolbar = createToolbarWarningController(chrome.storage.session, chrome.action);
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
const promptCoordinator = createPromptWriteCoordinator();
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

/** Serializes TOC alias mutations and confirmed deletion fences across tabs. */
const tocAliasCoordinator = createTocAliasWriteCoordinator();
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
