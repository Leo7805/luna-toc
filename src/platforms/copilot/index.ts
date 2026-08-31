/**
 * Copilot platform aggregator. Every method delegates to a stub that
 * throws `Error('Copilot platform not yet implemented')`.
 */
import { COPILOT_MESSAGE_TYPES } from './messages';
import {
  buildCopilotBackfillUrl,
  copilotFetch,
  copilotRequest,
  createCopilotElementNavigationAnchor,
  createCopilotJumpId,
  createCopilotNavigationTurns,
  createCopilotRenderedFingerprintCollector,
  findCopilotRenderedPrompt,
  getCopilotConversationLinkSelector,
  getCopilotCurrentRouteKey,
  getCopilotJumpTargetElement,
  getCopilotNativePromptIndex,
  getCopilotNewChatRouteKey,
  getCopilotPromptMountDiagnostic,
  getCopilotScrollContainer,
  getCopilotScrollMetrics,
  getCopilotSidebarTitle,
  getCopilotTestConfig,
  inspectCopilotFetchRequest,
  installCopilotMatchMediaSpoof,
  installCopilotMatchMediaToggleListener,
  isCopilotElementVisible,
  isCopilotNewChatRouteKey,
  logCopilotEvent,
  observeCopilotVirtualPosition,
  observeCopilotVisibleUserMessages,
  postCopilotContractUpdate,
  probeCopilotFetchContract,
  setCopilotSidebarSpoofEnabled,
} from './stubs';
import type {
  Platform,
  PlatformContractTable,
} from '../platformInterface';

const COPILOT_CONTRACT_TABLE: PlatformContractTable<string> = {
  ids: [],
  resolve() {
    return '';
  },
  label() {
    return '';
  },
};

const COPILOT_INSTALL_FLAG = '__lunaCopilotHookInstalled';

export const copilotPlatform: Platform = {
  id: 'copilot',
  displayName: 'Microsoft Copilot',
  matches: ['https://copilot.microsoft.com/*'],
  pageHook: {
    request: copilotRequest,
    fetch: copilotFetch,
    messages: COPILOT_MESSAGE_TYPES,
    buildBackfillUrl: buildCopilotBackfillUrl,
    probeFetchContract: probeCopilotFetchContract,
    installMatchMediaSpoof: installCopilotMatchMediaSpoof,
    installMatchMediaToggleListener: installCopilotMatchMediaToggleListener,
    postContractUpdate: postCopilotContractUpdate,
    setSidebarSpoofEnabled: setCopilotSidebarSpoofEnabled,
    spoofedViewportWidthPx: 1400,
    installFlag: COPILOT_INSTALL_FLAG,
  },
  navigation: {
    getScrollContainer: getCopilotScrollContainer,
    findRenderedPrompt: findCopilotRenderedPrompt,
    isElementVisible: isCopilotElementVisible,
    getScrollMetrics: getCopilotScrollMetrics,
    createElementNavigationAnchor: createCopilotElementNavigationAnchor as never,
    observeVirtualPosition: observeCopilotVirtualPosition as never,
    getPromptMountDiagnostic: getCopilotPromptMountDiagnostic as never,
    nativePromptButtonSelectors: [],
    getNativePromptIndex: getCopilotNativePromptIndex,
    observeVisibleUserMessages: observeCopilotVisibleUserMessages,
    getJumpTargetElement: getCopilotJumpTargetElement as never,
    settleAttempts: 3,
    promptTopOffsetPx: 16,
  },
  routing: {
    getCurrentRouteKey: getCopilotCurrentRouteKey,
    newChatRouteKey: getCopilotNewChatRouteKey,
    getSidebarTitle: getCopilotSidebarTitle,
    getConversationLinkSelector: getCopilotConversationLinkSelector,
  },
  myPrompts: {
    composerTextareaSelector: '',
  },
  config: {
    navigationAlgorithm: 'legacy-native',
    promptTopOffsetPx: 16,
    settleAttempts: 3,
    backfillMaxPages: 5,
    interceptFetchNumTurns: { pagination: null, initialLoad: null },
    useLocalConfig: false,
    showCompatibilityAlert: false,
    selectors: {
      userMessage: '',
      assistantMessage: '',
      messageId: '',
    },
    contract: COPILOT_CONTRACT_TABLE,
  },
  contentCapture: {
    inspectFetchRequest: inspectCopilotFetchRequest,
    createNavigationTurns: createCopilotNavigationTurns as never,
    createRenderedFingerprintCollector: createCopilotRenderedFingerprintCollector as never,
    isNewChatRouteKey: isCopilotNewChatRouteKey,
  },
  diagnostics: {
    debugStorageKey: 'chatTocDebugJump',
    testConfigStorageKey: 'chatTocNavigationTestConfig',
    getTestConfig: getCopilotTestConfig as never,
    createJumpId: createCopilotJumpId,
    logEvent: logCopilotEvent as never,
  },
  runtimeConfigKey: 'luna:copilot:runtimeConfig',
};