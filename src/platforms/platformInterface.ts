/**
 * Platform abstraction contract.
 *
 * Every AI chat host (ChatGPT, Copilot, Gemini, Claude, …) is described by
 * a single `Platform` record composed of typed adapter interfaces. Adding a
 * new host means creating `src/platforms/<host>/` and exporting a
 * `Platform` aggregator — no edits anywhere else.
 *
 * The runtime entry resolves the active platform via `getActivePlatform()`
 * from `window.location.host`. From that point on, the page-hook, the
 * content script, and the navigation controller all dispatch through
 * `platform.*` rather than importing the chatgpt adapter directly.
 *
 * Generic machinery (fetch interception skeleton, SSE line reader, request
 * header collection, contract-mismatch reporter, Proxy/event synthesis for
 * matchMedia) stays in `src/pageHook/`; only platform-specific dispatch
 * points use this interface.
 */
import type { NavigationAnchor } from '@/navigation/jump/navigationAnchorStore';
import type {
  NavigationFingerprintIndex,
  ResponseFingerprintRecord,
} from '@/navigation/fingerprint/index';
import type { NavigationSegmentIndex } from '@/navigation/fingerprint/segments';
import type { NavigationTurn } from '@/navigation/navigationData';
import type { VirtualSearchObservation } from '@/navigation/jump/virtualSearchController';
import type { VirtualScrollMetrics } from '@/navigation/jump/virtualSearchController';

/**
 * Literal platform id. Add new members as adapters are added.
 */
export type PlatformId = 'chatgpt' | 'copilot';

/**
 * A platform-known host match pattern (mirrors a `content_scripts.matches`
 * entry in `manifest.json`).
 */
export interface PlatformRegistryEntry {
  id: PlatformId;
  displayName: string;
  matches: readonly string[];
}

/**
 * Per-platform namespaced window.postMessage channels.
 *
 * Each implementation owns its own strings so naming collisions are
 * impossible when multiple hosts share a content-script world.
 */
export interface PlatformMessageTypes {
  /** Page → content conversation payload (initial + backfill pages). */
  conversationData: string;
  /** Page → content end-of-stream signal. */
  conversationEnded: string;
  /** Page → content real-time new user prompt (POST body + SSE). */
  newUserMessage: string;
  /** Page → content SPA navigation notification. */
  routeChanged: string;
  /** Page → content title mutation. */
  titleChanged: string;
  /** Content → page sidebar visibility toggle. */
  setWidthSpoof: string;
  /** Content → page effective contract values. */
  configUpdate: string;
  /** Page → content contract-drift alert. */
  contractMismatch: string;
}

/**
 * Maps a request pathname to either the full-conversation id, the paginated
 * `/messages` id, or `null` when neither pattern matches. Also exposes the
 * "send message" POST path test.
 */
export interface PlatformRequestShape {
  fullConversationIdFromPath(pathname: string): string | null;
  paginatedConversationIdFromPath(pathname: string): string | null;
  isSendMessagePath(method: string, pathname: string): boolean;
}

/**
 * Fetch-args rewriter + request-URL normalizer. The rewriter bumps the
 * host platform's pagination/initial-load size when configured.
 */
export interface PlatformFetchBumping {
  getFetchUrl(input: RequestInfo | URL): string;
  maybeBumpFetch(
    args: Parameters<typeof fetch>,
    config: {
      paginationNumTurns: number | null;
      initialLoadNumTurns: number | null;
    }
  ): Parameters<typeof fetch>;
}

/**
 * Page-hook concerns. Each host exposes its own matchMedia spoof install,
 * backfill URL builder, contract probe, and postMessage channels.
 */
export interface PlatformPageHookAdapter {
  request: PlatformRequestShape;
  fetch: PlatformFetchBumping;
  messages: PlatformMessageTypes;
  /** Builds the paginated older-history URL for one backfill step. */
  buildBackfillUrl(conversationId: string, beforeCursor: string): string;
  /** Optional platform-specific fetch-contract probe (e.g. ChatGPT num_turns). */
  probeFetchContract?(
    conversationId: string,
    authHeaders: Record<string, string> | null
  ): Promise<void>;
  /** Replaces `window.matchMedia` with a width-spoofing Proxy. */
  installMatchMediaSpoof(): void;
  /** Listens for the content-script visibility toggle message. */
  installMatchMediaToggleListener(): void;
  /** Posts a contract-values update to the page-hook from the content script. */
  postContractUpdate(values: Record<string, string>): void;
  /** Sets the matchMedia spoof on/off from the sidebar visibility toggle. */
  setSidebarSpoofEnabled(enabled: boolean): void;
  /** The forced width used for width queries when spoofing. */
  spoofedViewportWidthPx: number;
  /** Sentinel string flagged on `window` to detect double installation. */
  installFlag: string;
}

/**
 * Per-request metadata returned by the platform's `inspectFetchRequest`.
 * The page-hook uses this to dispatch follow-up actions.
 */
export interface ContentRequestMeta {
  isConversationGet: boolean;
  isInitialConversationLoad: boolean;
  isSendMessage: boolean;
  routeKey: string;
}

/**
 * Content-side data adapter. Converts host payloads into platform-agnostic
 * navigation turns, creates the rendered-text fingerprint collector, and
 * tells the controller whether a given route key represents a "new chat".
 */
export interface PlatformContentCapture {
  inspectFetchRequest(
    args: Parameters<typeof fetch>,
    fallbackRouteKey: string
  ): ContentRequestMeta | null;
  createNavigationTurns(data: unknown): NavigationTurn[];
  createRenderedFingerprintCollector(
    opts: PlatformRenderedFingerprintCollectorOptions
  ): PlatformRenderedFingerprintCollector;
  isNewChatRouteKey(routeKey: string): boolean;
}

/**
 * Rendered-text fingerprint collector context — passed in by the controller.
 */
export interface PlatformRenderedFingerprintContext {
  conversationKey: string;
  revision: number;
  responsePromptIndexes: ReadonlyMap<string, number>;
}

/**
 * Rendered-text fingerprint collector options.
 */
export interface PlatformRenderedFingerprintCollectorOptions {
  debounceMs?: number;
  onFingerprintRecord: (
    context: PlatformRenderedFingerprintContext,
    record: ResponseFingerprintRecord
  ) => void;
}

/**
 * Collector instance returned by `createRenderedFingerprintCollector`.
 */
export interface PlatformRenderedFingerprintCollector {
  collect(root?: ParentNode): Promise<void>;
  observe(root?: HTMLElement): void;
  setContext(context: PlatformRenderedFingerprintContext | null): void;
  disconnect(): void;
}

/**
 * Prompt-mount diagnostic shape returned by `getPromptMountDiagnostic`.
 * The ChatGPT adapter exposes a typed shape (`ChatGptPromptMountDiagnostic`);
 * copilot exposes an empty record until real diagnostics land. The
 * interface stays `unknown` so the typed shape can flow through without
 * structural coercion.
 */
export type PlatformPromptMountDiagnostic = unknown;

/**
 * Virtual-scroll observation options (input to `observeVirtualPosition`).
 */
export interface PlatformVirtualPositionOptions {
  conversationKey: string;
  prompts: ReadonlyArray<{ id: string }>;
  fingerprintIndex: NavigationFingerprintIndex;
  segmentIndex: NavigationSegmentIndex;
  root?: ParentNode;
  scrollContainer?: HTMLElement | null;
}

/**
 * Per-platform scroll container / mounted-DOM adapter used by the
 * navigation controller.
 */
export interface PlatformNavigationAdapter {
  getScrollContainer(root?: ParentNode): HTMLElement | null;
  findRenderedPrompt(promptId: string, root?: ParentNode): HTMLElement | null;
  isElementVisible(element: HTMLElement, scrollContainer: HTMLElement): boolean;
  getScrollMetrics(container: HTMLElement): PlatformVirtualScrollMetrics;
  createElementNavigationAnchor(opts: {
    conversationKey: string;
    promptId: string;
    promptIndex: number;
    element: HTMLElement;
    scrollContainer: HTMLElement;
  }): NavigationAnchor;
  observeVirtualPosition(
    opts: PlatformVirtualPositionOptions
  ): Promise<VirtualSearchObservation>;
  getPromptMountDiagnostic(opts: {
    promptId: string;
    matchedBlockIds: string[];
    scrollContainer: HTMLElement;
    getNavigatorIndex: (element: HTMLElement) => number;
    matchesTargetPromptText: (element: HTMLElement) => boolean;
    root?: ParentNode;
  }): PlatformPromptMountDiagnostic;
  /** Native prompt-jump button selectors used for the legacy navigator. */
  nativePromptButtonSelectors: readonly string[];
  /** AX attribute or text matched against the rendered prompt button. */
  getNativePromptIndex(button: HTMLButtonElement): number;
  /** Hook for the loading-settle fallback timer. */
  observeVisibleUserMessages(callback: (id: string) => void): () => void;
  /** Element-visibility predicate used to settle after a jump. */
  getJumpTargetElement(message: NavigatorMessage): HTMLElement | null;
  /** Per-platform numeric tuning values. */
  settleAttempts: number;
  promptTopOffsetPx: number;
}

/**
 * Virtual-scroll metrics (subset of `VirtualScrollMetrics` consumed by the
 * generic controller). Re-exports the concrete shape so adapters can
 * return either alias without structural incompatibility.
 */
export type PlatformVirtualScrollMetrics = VirtualScrollMetrics;

/**
 * Generic message envelope seen by `getJumpTargetElement`. Concrete shape
 * is defined by `NavigatorMessage` in `src/app/navigatorController.ts`; the
 * adapter only needs `id` for now.
 */
export interface NavigatorMessage {
  id: string;
  [key: string]: unknown;
}

/**
 * Per-platform runtime test-config (debug keys, settle-attempts override,
 * …). Shape mirrors `ChatGptNavigationTestConfig`.
 */
export interface PlatformNavigationTestConfig {
  settleWaitMs?: number;
  settleAttempts?: number;
  maxSearchAttempts?: number;
  maxUnproductiveSearchAttempts?: number;
  maxSearchDurationMs?: number;
  useConfirmedAnchors?: boolean;
  useObservedAnchors?: boolean;
}

/**
 * Diagnostics + runtime test-config overrides.
 */
export interface PlatformNavigationDiagnostics {
  debugStorageKey: string;
  testConfigStorageKey: string;
  getTestConfig(storage?: Storage): PlatformNavigationTestConfig;
  createJumpId(): string;
  logEvent(
    jumpId: string,
    eventName: string,
    details?: Record<string, unknown>,
    storage?: Storage
  ): void;
}

/**
 * Runtime contract-overrides persisted to `chrome.storage.local`.
 */
export interface PlatformRuntimeConfig {
  useLocalConfig: boolean;
  showCompatibilityAlert: boolean;
}

/**
 * Contract table — keyed by per-platform literal string ids. Each platform
 * narrows the `Id` generic to its own literal union at the implementation
 * site; the public interface keeps it generic so consumers can talk about
 * the table shape without depending on a specific platform.
 */
export interface PlatformContractTable<Id extends string> {
  readonly ids: readonly Id[];
  resolve(id: Id, useLocalConfig: boolean): string;
  label(id: Id): string;
}

/**
 * Compile-time config block per platform. The shape mirrors the existing
 * chatgpt block; new platforms copy it.
 */
export interface PlatformConfigBlock {
  navigationAlgorithm: 'legacy-native' | 'independent-virtual';
  promptTopOffsetPx: number;
  settleAttempts: number;
  backfillMaxPages: number;
  interceptFetchNumTurns: {
    pagination: number | null;
    initialLoad: number | null;
  };
  useLocalConfig: boolean;
  showCompatibilityAlert: boolean;
  /** Default DOM selectors used by the navigation controller. */
  selectors: {
    userMessage: string;
    assistantMessage: string;
    messageId: string;
  };
  contract: PlatformContractTable<string>;
}

/**
 * Route-key extraction + sidebar title resolution.
 */
export interface PlatformRoutingAdapter {
  getCurrentRouteKey(): string;
  newChatRouteKey(pathname: string): string;
  getSidebarTitle(routeKey: string): string;
  getConversationLinkSelector(conversationId: string): string;
}

/**
 * Composer textarea selector for MyPrompts. Placeholder for now; the
 * consumer (`promptAutocomplete.ts`) still hard-codes `#prompt-textarea`.
 */
export interface PlatformMyPromptsAdapter {
  composerTextareaSelector: string;
}

/**
 * Optional theme detector. Some platforms expose a `dark` class on the
 * document root; others may not. Platforms without theme observation leave
 * this `undefined` and the application falls back to manual theme.
 */
export interface PlatformThemeAdapter {
  getResolvedTheme(): 'light' | 'dark' | null;
  observe(listener: (theme: 'light' | 'dark') => void): () => void;
}

/**
 * The full platform record — union of every adapter above.
 */
export interface Platform {
  id: PlatformId;
  displayName: string;
  matches: readonly string[];
  pageHook: PlatformPageHookAdapter;
  navigation: PlatformNavigationAdapter;
  routing: PlatformRoutingAdapter;
  myPrompts: PlatformMyPromptsAdapter;
  config: PlatformConfigBlock;
  contentCapture: PlatformContentCapture;
  diagnostics: PlatformNavigationDiagnostics;
  runtimeConfigKey: string;
  theme?: PlatformThemeAdapter;
}