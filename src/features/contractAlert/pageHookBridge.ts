/**
 * Bridges the page-hook (MAIN world) compatibility-detection messages into
 * the content-script (ISOLATED world) detector. The page-hook posts
 * `{type: 'LUNA_CONTRACT_MISMATCH', contractId, expected, actual}` to
 * `window` whenever it observes a contract that no longer matches; this
 * listener forwards each message to `recordMismatch()`.
 *
 * Also pushes the effective contract values (formal/local resolved by
 * `useLocalConfig`) from the content script to the page-hook on startup and
 * whenever `chrome.storage.local` changes, so the page-hook's detection can
 * compare observed request paths against the developer's active expectations
 * rather than a hard-coded regex.
 */
import {
  APP_CONFIG,
  getActiveContractValue,
  loadChatGptRuntimeConfig,
  type ChatGptContractId,
} from '@/config/config';
import { recordMismatch } from './detector';

/** Message type posted by the page-hook when it observes a contract mismatch. */
export const PAGE_HOOK_MISMATCH_MESSAGE_TYPE = 'LUNA_CONTRACT_MISMATCH';

/** Message type posted by the content script to sync contract values to the page-hook. */
export const CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE = 'LUNA_CHATGPT_CONFIG_UPDATE';

interface PageHookMismatchMessage {
  type: typeof PAGE_HOOK_MISMATCH_MESSAGE_TYPE;
  contractId: string;
  expected?: string;
  actual?: string;
}

/**
 * Starts listening for page-hook mismatch messages. Returns a cleanup function
 * that removes the listener. Safe to call once on content-script startup.
 */
export function startPageHookMismatchBridge(): () => void {
  const handler = (event: MessageEvent): void => {
    const data = event.data as Partial<PageHookMismatchMessage> | null;
    if (!data || data.type !== PAGE_HOOK_MISMATCH_MESSAGE_TYPE) return;

    const contractId = data.contractId as ChatGptContractId;
    if (!contractId || !(contractId in APP_CONFIG.platforms.chatgpt.contract)) {
      return;
    }

    recordMismatch(
      contractId,
      typeof data.expected === 'string' ? data.expected : '',
      typeof data.actual === 'string' ? data.actual : ''
    );
  };

  window.addEventListener('message', handler);
  return () => {
    window.removeEventListener('message', handler);
  };
}

/**
 * Pushes the effective contract values (formal or local slot, per the active
 * `useLocalConfig`) to the page-hook via `window.postMessage`. Reposts
 * whenever `chrome.storage.local` changes so the page-hook always compares
 * against the developer's current expectations.
 *
 * Returns a cleanup function that removes the storage listener.
 */
export function startChatGptConfigSync(): () => void {
  let cancelled = false;

  const postUpdate = (): void => {
    if (cancelled) return;
    void loadChatGptRuntimeConfig().then((cfg) => {
      if (cancelled) return;

      const values: Partial<Record<ChatGptContractId, string>> = {};
      const contractKeys = Object.keys(
        APP_CONFIG.platforms.chatgpt.contract
      ) as ChatGptContractId[];
      for (const id of contractKeys) {
        values[id] = getActiveContractValue(id, cfg.useLocalConfig);
      }

      try {
        window.postMessage(
          {
            type: CHATGPT_CONFIG_UPDATE_MESSAGE_TYPE,
            useLocalConfig: cfg.useLocalConfig,
            contractValues: values,
          },
          window.location.origin
        );
      } catch {
        // PostMessage failures (detached window, etc.) are non-fatal.
      }
    });
  };

  postUpdate();

  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName
  ): void => {
    if (areaName !== 'local') return;
    if (!('chatGptRuntimeConfig' in changes)) return;
    postUpdate();
  };

  chrome.storage.onChanged.addListener(handleStorageChange);

  return () => {
    cancelled = true;
    chrome.storage.onChanged.removeListener(handleStorageChange);
  };
}