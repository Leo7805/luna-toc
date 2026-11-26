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
  holdChatGptViewport,
  queryChatGptVirtualJumpTarget,
  scrollChatGptToBottom,
} from './virtualLayoutAdapter';
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
import {
  installMatchMediaSpoof as installChatGptMatchMediaSpoof,
  installMatchMediaToggleListener as installChatGptMatchMediaToggleListener,
  setSidebarSpoofEnabled as setChatGptSidebarSpoofEnabled,
  SPOOFED_VIEWPORT_WIDTH,
} from './pageHook/matchMediaSpoof';
import type {
  NativeMessageNavigationResult,
  Platform,
  PlatformContractTable,
} from '../platformInterface';

/**
 * Triggers ChatGPT's native same-tab SPA message navigation (`?message=<id>`)
 * via History `pushState` + `PopStateEvent` without reloading the document.
 */
function navigateChatGptToMessage(
  conversationKey: string,
  messageId: string
): NativeMessageNavigationResult {
  const trimmedConv = conversationKey.trim();
  const trimmedMsg = messageId.trim();
  if (!trimmedConv || !trimmedMsg || trimmedConv.startsWith('new-chat:')) {
    return { status: 'unavailable', reason: 'invalid-target' };
  }
  if (
    typeof window === 'undefined' ||
    typeof window.history?.pushState !== 'function'
  ) {
    return { status: 'unavailable', reason: 'history-unavailable' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(window.location.href);
  } catch {
    return { status: 'unavailable', reason: 'invalid-url' };
  }

  const routeMatch = parsedUrl.pathname.match(/\/c\/([^/]+)/);
  if (!routeMatch || routeMatch[1] !== trimmedConv) {
    return { status: 'unavailable', reason: 'route-mismatch' };
  }

  parsedUrl.searchParams.set('message', trimmedMsg);
  const nextUrl = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;

  try {
    window.history.pushState(null, '', nextUrl);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    return { status: 'ok' };
  } catch {
    return { status: 'unavailable', reason: 'push-failed' };
  }
}

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
    installMatchMediaSpoof: installChatGptMatchMediaSpoof,
    installMatchMediaToggleListener: installChatGptMatchMediaToggleListener,
    postContractUpdate,
    setSidebarSpoofEnabled: setChatGptSidebarSpoofEnabled,
    spoofedViewportWidthPx: SPOOFED_VIEWPORT_WIDTH,
    installFlag: HOOK_INSTALL_FLAG_VALUE,
  },
  navigation: {
    getScrollContainer: getChatGptScrollContainer,
    getThreadScrollContainer: getChatGptThreadScrollContainer,
    queryVirtualJumpTarget: queryChatGptVirtualJumpTarget,
    holdViewport: holdChatGptViewport,
    scrollToBottom: scrollChatGptToBottom,
    navigateToMessage: navigateChatGptToMessage,
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
    promptLandingViewportTopPx:
      APP_CONFIG.platforms.chatgpt.promptLandingViewportTopPx,
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
    interceptFetchNumTurns: {
      pagination: APP_CONFIG.platforms.chatgpt.interceptChatGptPaginationNumTurns,
      initialLoad: APP_CONFIG.platforms.chatgpt.interceptChatGptInitialLoadNumTurns,
    },
    useLocalConfig: APP_CONFIG.platforms.chatgpt.useLocalConfig,
    selectors: {
      userMessage: '[data-chatgpt-search-unit-key$=":user"]',
      assistantMessage: '[data-chatgpt-search-unit-key$=":assistant"]',
      messageId: 'data-chatgpt-search-message-ids',
    },
    contract: chatGptContractTable,
  },
  contentCapture: {
    inspectFetchRequest,
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