/**
 * ChatGPT platform aggregator. Composes the existing chatgpt adapter
 * modules into a single `Platform` record that the page-hook entry and
 * the content-script controller consume via the `Platform` interface.
 *
 * This file is the chatgpt analogue of the future per-platform
 * `src/platforms/<host>/index.ts` files; the existing modules under
 * `src/platforms/chatgpt/` are wrapped rather than rewritten.
 */
import { APP_CONFIG } from '@/config/config';
import { CHATGPT_MESSAGE_TYPES } from './messages';
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from './conversationRequest';
import {
  maybeBumpChatGptFetchNumTurns,
  getFetchUrl,
} from './chatGptFetchBumper';
import {
  buildBackfillUrl,
  HOOK_INSTALL_FLAG_VALUE,
  postContractUpdate,
} from './pageHook';
import {
  createChatGptNavigationTurns,
} from './navigationAdapter';
import { createRenderedFingerprintCollector } from './renderedFingerprintCollector';
import {
  inspectFetchRequest,
  isNewChatRouteKey,
} from './contentCapture';
import {
  findRenderedChatGptPrompt,
  findRenderedChatGptPromptByText,
  getChatGptMessageId,
  getChatGptPromptUnitKey,
  getChatGptScrollContainer,
  getChatGptThreadScrollContainer,
  readMountedWithSidebarIdx,
} from './virtualSearchAdapter';
import {
  createChatGptNavigationJumpId,
  getChatGptNavigationTestConfig,
  isJumpVizDebugEnabled,
  logChatGptNavigationEvent,
  NAVIGATION_DEBUG_STORAGE_KEY,
  NAVIGATION_TEST_CONFIG_STORAGE_KEY,
} from './navigationDiagnostics';
import { getCurrentRouteKey, getSidebarTitle, getConversationLinkSelector, newChatRouteKey } from './routing';
import {
  getNativePromptButtonSelectors,
  getNativePromptIndex,
  observeVisibleUserMessages as observeChatGptVisibleUserMessages,
  getJumpTargetElement as getChatGptJumpTargetElement,
} from './nativePromptNavigation';
import { getResolvedTheme, observeTheme } from './theme';
import {
  CHATGPT_CONTRACT_TABLE,
  resolveChatGptContractValue,
  labelChatGptContractValue,
} from './contract';
import type {
  Platform,
  PlatformContractTable,
} from '../platformInterface';

const CHATGPT_CONTRACT_IDS = Object.keys(CHATGPT_CONTRACT_TABLE) as Array<
  keyof typeof CHATGPT_CONTRACT_TABLE
>;

const chatGptContractTable: PlatformContractTable<string> = {
  ids: CHATGPT_CONTRACT_IDS,
  resolve(id, useLocalConfig) {
    return resolveChatGptContractValue(
      id as keyof typeof CHATGPT_CONTRACT_TABLE,
      useLocalConfig
    );
  },
  label(id) {
    return labelChatGptContractValue(
      id as keyof typeof CHATGPT_CONTRACT_TABLE
    );
  },
};

export const chatGptPlatform: Platform = {
  id: 'chatgpt',
  displayName: 'ChatGPT',
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  pageHook: {
    request: {
      fullConversationIdFromPath: getConversationIdFromApiPath,
      paginatedConversationIdFromPath: getConversationMessagesIdFromApiPath,
      isSendMessagePath(method, pathname) {
        return method === 'POST' && pathname === '/backend-api/f/conversation';
      },
    },
    fetch: {
      getFetchUrl,
      maybeBumpFetch(args, config) {
        return maybeBumpChatGptFetchNumTurns(args, {
          paginationNumTurns: config.paginationNumTurns,
          initialLoadNumTurns: config.initialLoadNumTurns,
        });
      },
    },
    messages: CHATGPT_MESSAGE_TYPES,
    buildBackfillUrl,
    probeFetchContract: undefined, // populated after the contractAlerts port
    postContractUpdate,
    installFlag: HOOK_INSTALL_FLAG_VALUE,
  },
  navigation: {
    getScrollContainer: getChatGptScrollContainer,
    getThreadScrollContainer: getChatGptThreadScrollContainer,
    findRenderedPrompt: findRenderedChatGptPrompt,
    findRenderedPromptByText: findRenderedChatGptPromptByText,
    readMountedWithSidebarIdx,
    getMessageIdFromElement: getChatGptMessageId,
    getPromptUnitKeyFromElement: getChatGptPromptUnitKey,
    nativePromptButtonSelectors: getNativePromptButtonSelectors(),
    getNativePromptIndex,
    observeVisibleUserMessages: observeChatGptVisibleUserMessages,
    getJumpTargetElement: getChatGptJumpTargetElement,
    settleAttempts: APP_CONFIG.platforms.chatgpt.settleAttempts,
    promptTopOffsetPx: APP_CONFIG.platforms.chatgpt.promptTopOffsetPx,
  },
  routing: {
    getCurrentRouteKey,
    newChatRouteKey,
    getSidebarTitle,
    getConversationLinkSelector,
  },
  myPrompts: {
    // ChatGPT's 2026 composer rewrite replaced the old
    // `<textarea id="prompt-textarea">` with a contenteditable ProseMirror
    // div. The autocomplete consumer reads this selector at runtime.
    composerTextareaSelector: '.ProseMirror[contenteditable="true"]',
  },
  config: {
    promptTopOffsetPx: APP_CONFIG.platforms.chatgpt.promptTopOffsetPx,
    settleAttempts: APP_CONFIG.platforms.chatgpt.settleAttempts,
    backfillMaxPages: APP_CONFIG.platforms.chatgpt.backfillMaxPages,
    interceptFetchNumTurns: {
      pagination: APP_CONFIG.platforms.chatgpt.interceptChatGptPaginationNumTurns,
      initialLoad: APP_CONFIG.platforms.chatgpt.interceptChatGptInitialLoadNumTurns,
    },
    useLocalConfig: APP_CONFIG.platforms.chatgpt.useLocalConfig,
    showCompatibilityAlert: APP_CONFIG.platforms.chatgpt.showCompatibilityAlert,
    selectors: {
      userMessage: '[data-chatgpt-search-unit-key$=":user"]',
      assistantMessage: '[data-chatgpt-search-unit-key$=":assistant"]',
      messageId: 'data-chatgpt-search-message-ids',
    },
    contract: chatGptContractTable,
  },
  contentCapture: {
    inspectFetchRequest,
    createNavigationTurns: createChatGptNavigationTurns,
    createRenderedFingerprintCollector,
    isNewChatRouteKey,
  },
  diagnostics: {
    debugStorageKey: NAVIGATION_DEBUG_STORAGE_KEY,
    testConfigStorageKey: NAVIGATION_TEST_CONFIG_STORAGE_KEY,
    getTestConfig: getChatGptNavigationTestConfig,
    createJumpId: createChatGptNavigationJumpId,
    logEvent: logChatGptNavigationEvent,
    isJumpVizDebugEnabled,
  },
  runtimeConfigKey: 'luna:chatgpt:runtimeConfig',
  theme: {
    getResolvedTheme,
    observe: observeTheme,
  },
};