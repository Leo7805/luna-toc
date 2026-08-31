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
  loadPlatformRuntimeConfig,
  platformRuntimeConfigKey,
  APP_CONFIG,
  getActiveContractValue,
} from '@/config/config';
import { recordMismatch } from './detector';
import {
  CHATGPT_CONTRACT_TABLE,
  resolveChatGptContractValue,
} from '@/platforms/chatgpt/contract';
import type { ChatGptContractId } from '@/config/config';

/**
 * Returns the contract ids for a given platform id. ChatGPT has the full
 * typed table; other platforms return an empty array until implemented.
 */
function platformContractIds(platformId: string): string[] {
  if (platformId === 'chatgpt') {
    return Object.keys(CHATGPT_CONTRACT_TABLE);
  }
  const platformBlock = (
    APP_CONFIG as {
      platforms: Record<string, { contract?: Record<string, unknown> }>;
    }
  ).platforms[platformId];
  return platformBlock?.contract ? Object.keys(platformBlock.contract) : [];
}

/**
 * Resolves a single contract slot to its active string value. ChatGPT
 * routes through the typed chatgpt resolver; other platforms fall back
 * to whatever the platform block exposes (currently empty for stubs).
 */
function resolveContractValue(
  platformId: string,
  contractId: string,
  useLocalConfig: boolean
): string {
  if (platformId === 'chatgpt') {
    return resolveChatGptContractValue(
      contractId as keyof typeof CHATGPT_CONTRACT_TABLE,
      useLocalConfig
    );
  }
  return '';
}

// Silence unused-import warning for the legacy helper while keeping the
// re-export path intact for any downstream caller.
void getActiveContractValue;

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
export function startChatGptConfigSync(
  platformId: string = 'chatgpt'
): () => void {
  let cancelled = false;

  const postUpdate = (): void => {
    if (cancelled) return;
    void loadPlatformRuntimeConfig(platformId).then((cfg) => {
      if (cancelled) return;

      const values: Record<string, string> = {};
      const contractKeys = platformContractIds(platformId);
      for (const id of contractKeys) {
        const resolved = resolveContractValue(platformId, id, cfg.useLocalConfig);
        if (resolved) values[id] = resolved;
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
    const expectedKey = platformRuntimeConfigKey(platformId);
    const legacyKey = 'chatGptRuntimeConfig';
    if (!(expectedKey in changes) && !(legacyKey in changes)) return;
    postUpdate();
  };

  chrome.storage.onChanged.addListener(handleStorageChange);

  return () => {
    cancelled = true;
    chrome.storage.onChanged.removeListener(handleStorageChange);
  };
}