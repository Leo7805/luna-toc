/** Centralizes project-level values intended for deliberate tuning. */

export type ChatGptNavigationAlgorithm =
  | 'legacy-native'
  | 'independent-virtual';

/** Identifies one ChatGPT external-contract value (API path, selector, channel, etc.). */
export type ChatGptContractId =
  | 'api.conversation.path'
  | 'api.conversation.messages-path'
  | 'api.send-message.path'
  | 'api.params.num-turns'
  | 'api.params.before'
  | 'api.params.include-has-versions'
  | 'dom.selector.user-message'
  | 'dom.selector.message-id'
  | 'postmessage.channel.conversation-data'
  | 'postmessage.channel.width-spoof'
  | 'postmessage.hook-flag'
  | 'response.messages-field'
  | 'behavior.viewport-spoof-width';

/** A single ChatGPT external-contract value with parallel `formal`/`local` slots and a display label. */
export interface ChatGptContractValue {
  /** Production value, committed and shipped. */
  formal: string;
  /** Developer-local override slot. Initially equal to `formal`. */
  local: string;
  /** Human-readable English label used in compatibility-alert copy. */
  label: string;
}

/** Type of `APP_CONFIG.platforms.chatgpt.contract` —. */
export type ChatGptContractTable = Record<
  ChatGptContractId,
  ChatGptContractValue
>;

/** Shared compile-time configuration for navigation and future project sections. */
export const APP_CONFIG = {
  ui: {
    sidebar: {
      defaultWidthPx: 300,
      minimumWidthPx: 240,
      maximumWidthPx: 520,
      /**
       * How long the sidebar status drawer stays visible after an operation
       * completes (loading finished, jump resolved) before retracting.
       */
      statusLingerMs: 500,
      /**
       * How long to wait, with no `CHATGPT_CONVERSATION_DATA` and no
       * `CHATGPT_CONVERSATION_ENDED` event, before declaring the load
       * complete anyway. Catches chats ChatGPT hydrates from its own
       * client-side cache (no network fetch, no page-hook events) and
       * similarly hard-to-reach cases — the sidebar would otherwise
       * park at "Loading..." forever on those routes.
       */
      loadingSettleMs: 1000,
    },
    stacking: {
      baseZIndex: 1_000,
      offsets: {
        sidebar: 0,
        toggle: 10,
        popover: 20,
        modal: 100,
      },
    },
  },
  platforms: {
    chatgpt: {
      navigationAlgorithm: 'independent-virtual' as ChatGptNavigationAlgorithm,
      promptTopOffsetPx: 16,
      settleAttempts: 3,
      backfillMaxPages: 10,
      // Rewrites ChatGPT's own older-page pagination requests so its
      // renderer fills the message store in a single fetch (speeds up
      // far-jump navigation). Set to null to disable.
      interceptChatGptPaginationNumTurns: 100 as number | null,
      // Rewrites ChatGPT's own initial conversation load so a single
      // request returns the whole history (collapses 2 fetches -> 1
      // for short conversations). Set to null to disable.
      interceptChatGptInitialLoadNumTurns: 100 as number | null,
      // Centralizes every ChatGPT external-contract value (API paths, selectors,
      // postMessage channels, behavior constants). Each entry has parallel
      // `formal`/`local` slots and a human-readable `label` for the
      // compatibility-alert popup. See getActiveContractValue().
      contract: {
        'api.conversation.path': {
          formal: '/backend-api/conversations/{id}',
          local: '/backend-api/conversations/{id}',
          // local: '/backend-api/test/{id}',
          label: 'Conversation data API path',
        },
        'api.conversation.messages-path': {
          formal: '/backend-api/conversations/{id}/messages',
          local: '/backend-api/conversations/{id}/messages',
          label: 'Conversation messages pagination endpoint',
        },
        'api.send-message.path': {
          formal: '/backend-api/f/conversation',
          local: '/backend-api/f/conversation',
          label: 'Send-message POST endpoint',
        },
        'api.params.num-turns': {
          formal: 'num_turns',
          local: 'num_turns',
          label: 'Pagination num_turns parameter',
        },
        'api.params.before': {
          formal: 'before',
          local: 'before',
          label: 'Pagination cursor parameter',
        },
        'api.params.include-has-versions': {
          formal: 'include_has_versions',
          local: 'include_has_versions',
          label: 'Pagination include_has_versions flag',
        },
        'dom.selector.user-message': {
          formal: '[data-message-author-role="user"]',
          local: '[data-message-author-role="user"]',
          label: 'User message DOM marker',
        },
        'dom.selector.message-id': {
          formal: '[data-message-id]',
          local: '[data-message-id]',
          label: 'Message identifier attribute',
        },
        'postmessage.channel.conversation-data': {
          formal: 'CHATGPT_CONVERSATION_DATA',
          local: 'CHATGPT_CONVERSATION_DATA',
          label: 'Page-to-extension conversation data channel',
        },
        'postmessage.channel.width-spoof': {
          formal: 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF',
          local: 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF',
          label: 'Sidebar width-spoof toggle channel',
        },
        'postmessage.hook-flag': {
          formal: '__conversationNavigatorFetchHookInstalled',
          local: '__conversationNavigatorFetchHookInstalled',
          label: 'Page-hook installation sentinel',
        },
        'response.messages-field': {
          formal: 'messages',
          local: 'messages',
          label: 'Conversation messages field',
        },
        'behavior.viewport-spoof-width': {
          formal: '1400',
          local: '1400',
          label: 'Sidebar viewport spoof width',
        },
      } as ChatGptContractTable,
      // When true, getActiveContractValue() returns the `local` slot instead of
      // `formal`. Flipped by the developer during local debugging/testing.
      useLocalConfig: false,
      // When true, the content-script compatibility alert renders a topmost
      // portal modal on chatgpt.com when the detector observes a mismatch.
      // Exposed in the Options page; defaults OFF so end users are unaffected.
      showCompatibilityAlert: false,
    },
  },
  navigation: {
    fingerprint: {
      countPerAssistant: 3,
      probeLength: 40,
      verificationLength: 256,
      segmentViewportRatio: 0.75,
      segmentOverlapRatio: 0.15,
      estimatedCharsPerVisualLine: 60,
      estimatedRowsPerViewport: 30,
      maximumSegmentsPerAssistant: 20,
      buildBatchSize: 10,
      buildTimeBudgetMs: 8,
      observationDebounceMs: 750,
    },
    anchorCache: {
      maxConversations: 50,
      maxAnchorsPerConversation: 100,
      maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
      viewportWidthTolerance: 48,
    },
    search: {
      maxAttempts: 32,
      maxUnproductiveAttempts: 6,
      renderWaitMs: 80,
      maxDurationMs: 30_000,
      edgeBackfillWaitMs: 1_200,
      maximumWindowSlideCycles: 16,
      interpolationFailuresBeforeBinary: 2,
      relativeViewportRatio: 0.75,
      minimumRelativeViewportRatio: 0.25,
      maximumRelativeViewportCount: 16,
      maximumLearnedRelativeViewportCount: 64,
      nearTargetPromptDistance: 4,
      maximumNearTargetViewportCount: 8,
      stalledStepGrowthRatio: 1.5,
      crossingStepRatio: 0.5,
      promptMountScanViewportRatio: 0.2,
      minimumPromptMountViewportRatio: 0.05,
      maximumPromptMountViewportCount: 2,
      promptMountStepGrowthRatio: 1.5,
      promptMountCrossingStepRatio: 0.5,
      maximumPromptMountAttempts: 12,
    },
  },
} as const;

/**
 * Returns the active value for a ChatGPT contract slot. When `useLocalConfig`
 * is true the `local` slot is returned; otherwise the `formal` slot. Pure
 * function — the caller supplies the effective `useLocalConfig` (typically by
 * reading `getChatGptRuntimeConfig()`).
 *.
 * @param {ChatGptContractId} contractId
 * @param {boolean} useLocalConfig
 * @returns {string}
 */
export function getActiveContractValue(
  contractId: ChatGptContractId,
  useLocalConfig: boolean
): string {
  const entry = APP_CONFIG.platforms.chatgpt.contract[contractId];
  return useLocalConfig ? entry.local : entry.formal;
}

/** `chrome.storage.local` key for runtime overrides of ChatGPT config flags. */
export const CHATGPT_RUNTIME_CONFIG_STORAGE_KEY = 'chatGptRuntimeConfig';

/** Legacy alias kept for one release so existing dev storage migrates safely. */
export const LEGACY_CHATGPT_RUNTIME_CONFIG_STORAGE_KEY = 'chatGptRuntimeConfig';

/** `chrome.storage.local` key for runtime overrides, generic across platforms. */
export function platformRuntimeConfigKey(platformId: string): string {
  return `luna:${platformId}:runtimeConfig`;
}

/** Runtime overrides for ChatGPT config flags, loaded from `chrome.storage.local`. */
export interface ChatGptRuntimeConfig {
  useLocalConfig: boolean;
  showCompatibilityAlert: boolean;
}

/**
 * Generic, per-platform runtime-config loader. Falls back to the committed
 * `APP_CONFIG.platforms[platformId]` defaults when the storage entry is
 * missing or malformed. Migrates the legacy `chatGptRuntimeConfig` storage
 * key on first read (preserved for one release).
 *
 * @param {string} platformId
 * @param {Pick<chrome.storage.StorageArea, 'get'>} [storage]
 * @returns {Promise<ChatGptRuntimeConfig>}
 */
export async function loadPlatformRuntimeConfig(
  platformId: string,
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'> = chrome.storage.local
): Promise<ChatGptRuntimeConfig> {
  const block = (
    APP_CONFIG as { platforms: Record<string, { useLocalConfig: boolean; showCompatibilityAlert: boolean }> }
  ).platforms[platformId];
  const defaults: ChatGptRuntimeConfig = {
    useLocalConfig: block?.useLocalConfig ?? false,
    showCompatibilityAlert: block?.showCompatibilityAlert ?? false,
  };

  const newKey = platformRuntimeConfigKey(platformId);
  try {
    const raw = await storage.get([newKey, LEGACY_CHATGPT_RUNTIME_CONFIG_STORAGE_KEY]);
    const newEntry = raw?.[newKey] as unknown;
    if (newEntry && typeof newEntry === 'object') {
      const overrides = newEntry as Record<string, unknown>;
      return {
        useLocalConfig:
          typeof overrides.useLocalConfig === 'boolean'
            ? overrides.useLocalConfig
            : defaults.useLocalConfig,
        showCompatibilityAlert:
          typeof overrides.showCompatibilityAlert === 'boolean'
            ? overrides.showCompatibilityAlert
            : defaults.showCompatibilityAlert,
      };
    }

    // Legacy key path — read once and migrate forward to the new key.
    const legacy = raw?.[LEGACY_CHATGPT_RUNTIME_CONFIG_STORAGE_KEY] as unknown;
    if (platformId === 'chatgpt' && legacy && typeof legacy === 'object') {
      const overrides = legacy as Record<string, unknown>;
      const migrated: ChatGptRuntimeConfig = {
        useLocalConfig:
          typeof overrides.useLocalConfig === 'boolean'
            ? overrides.useLocalConfig
            : defaults.useLocalConfig,
        showCompatibilityAlert:
          typeof overrides.showCompatibilityAlert === 'boolean'
            ? overrides.showCompatibilityAlert
            : defaults.showCompatibilityAlert,
      };
      try {
        await storage.set({ [newKey]: migrated });
        await storage.remove(LEGACY_CHATGPT_RUNTIME_CONFIG_STORAGE_KEY);
      } catch {
        // Storage migration failures are non-fatal — return the migrated
        // value anyway so callers can proceed.
      }
      return migrated;
    }

    return defaults;
  } catch {
    return defaults;
  }
}

/**
 * Writes the runtime override layer for any platform's config flags. Mirrors
 * `loadPlatformRuntimeConfig`; uses the new `luna:<id>:runtimeConfig` storage
 * key (no longer the legacy `chatGptRuntimeConfig`).
 *
 * @param {string} platformId
 * @param {Partial<ChatGptRuntimeConfig>} overrides
 * @param {Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>} [storage]
 * @returns {Promise<void>}
 */
export async function savePlatformRuntimeConfig(
  platformId: string,
  overrides: Partial<ChatGptRuntimeConfig>,
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'> = chrome
    .storage.local
): Promise<void> {
  const current = await loadPlatformRuntimeConfig(platformId, storage);
  const next: ChatGptRuntimeConfig = {
    useLocalConfig:
      overrides.useLocalConfig !== undefined
        ? overrides.useLocalConfig
        : current.useLocalConfig,
    showCompatibilityAlert:
      overrides.showCompatibilityAlert !== undefined
        ? overrides.showCompatibilityAlert
        : current.showCompatibilityAlert,
  };

  try {
    await storage.set({ [platformRuntimeConfigKey(platformId)]: next });
  } catch {
    // Storage failures are non-fatal: defaults already cover the fallback path.
  }
}

/**
 * Reads the runtime override layer for ChatGPT config flags. Falls back to the
 * committed `APP_CONFIG.platforms.chatgpt` defaults when the storage entry is
 * missing or malformed. Safe to call from any context that has access to
 * `chrome.storage.local` (extension pages and ISOLATED-world content scripts).
 *
 * @param {Pick<chrome.storage.StorageArea, 'get'>} [storage]
 * @returns {Promise<ChatGptRuntimeConfig>}
 */
export async function loadChatGptRuntimeConfig(
  storage: Pick<chrome.storage.StorageArea, 'get'> = chrome.storage.local
): Promise<ChatGptRuntimeConfig> {
  const defaults: ChatGptRuntimeConfig = {
    useLocalConfig: APP_CONFIG.platforms.chatgpt.useLocalConfig,
    showCompatibilityAlert: APP_CONFIG.platforms.chatgpt.showCompatibilityAlert,
  };

  try {
    const raw = await storage.get(CHATGPT_RUNTIME_CONFIG_STORAGE_KEY);
    const stored = raw?.[CHATGPT_RUNTIME_CONFIG_STORAGE_KEY] as unknown;
    if (!stored || typeof stored !== 'object') return defaults;

    const overrides = stored as Record<string, unknown>;
    return {
      useLocalConfig:
        typeof overrides.useLocalConfig === 'boolean'
          ? overrides.useLocalConfig
          : defaults.useLocalConfig,
      showCompatibilityAlert:
        typeof overrides.showCompatibilityAlert === 'boolean'
          ? overrides.showCompatibilityAlert
          : defaults.showCompatibilityAlert,
    };
  } catch {
    return defaults;
  }
}

/**
 * Writes the runtime override layer for ChatGPT config flags. Pass `null` for
 * a field to reset it to the committed default; omit the field to leave it
 * unchanged.
 *
 * @param {Partial<ChatGptRuntimeConfig>} overrides
 * @param {Pick<chrome.storage.StorageArea, 'set' | 'remove'>} [storage]
 * @returns {Promise<void>}
 */
export async function saveChatGptRuntimeConfig(
  overrides: Partial<ChatGptRuntimeConfig>,
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'> = chrome
    .storage.local
): Promise<void> {
  const current = await loadChatGptRuntimeConfig(storage);
  const next: ChatGptRuntimeConfig = {
    useLocalConfig:
      overrides.useLocalConfig !== undefined
        ? overrides.useLocalConfig
        : current.useLocalConfig,
    showCompatibilityAlert:
      overrides.showCompatibilityAlert !== undefined
        ? overrides.showCompatibilityAlert
        : current.showCompatibilityAlert,
  };

  try {
    await storage.set({ [CHATGPT_RUNTIME_CONFIG_STORAGE_KEY]: next });
  } catch {
    // Storage failures are non-fatal: defaults already cover the fallback path.
  }
}
