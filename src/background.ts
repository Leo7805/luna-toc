/**
 * Service-worker bridge for per-tab compatibility warnings in Chrome's toolbar.
 */
import {
  PROMPT_COMMIT_TYPE,
  createPromptWriteCoordinator,
} from '@/features/myPrompts/promptWriteCoordinator';
import {
  TOOLBAR_COMPATIBILITY_WARNING,
  toolbarWarningKey,
  type ToolbarCompatibilityWarning,
} from '@/features/contractAlert/toolbarWarning';

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== 'object') return;
  const payload = message as { type?: unknown; detail?: unknown };
  if (payload.type !== TOOLBAR_COMPATIBILITY_WARNING) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined ||
      !/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(sender.url ?? '') ||
      typeof payload.detail !== 'string' || !payload.detail.trim()) return;

  const warning: ToolbarCompatibilityWarning = {
    detail: payload.detail.slice(0, 180),
    observedAt: Date.now(),
  };
  void chrome.storage.session.set({ [toolbarWarningKey(tabId)]: warning })
    .then(() => chrome.action.setBadgeBackgroundColor({ color: '#b91c1c', tabId }))
    .then(() => chrome.action.setBadgeText({ text: '!', tabId }))
    .catch(() => {
      // The tab may be closed before its asynchronous badge update.
    });
});

/** Full navigation discards stale warnings until a new mismatch is detected. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  void Promise.all([
    chrome.storage.session.remove(toolbarWarningKey(tabId)),
    chrome.action.setBadgeText({ text: '', tabId }),
  ]).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(toolbarWarningKey(tabId)).catch(() => {});
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
