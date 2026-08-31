/** Not-yet-implemented Copilot stubs. Every method throws so any premature
 *  call site produces a clear, identifiable error instead of `undefined.foo`.
 *
 *  Copilot is the second host in the registry but is not implemented yet.
 *  The thrown error is intentionally the same across files so a single
 *  stack-trace keyword (`Copilot platform not yet implemented`) is enough
 *  to find the missing piece.
 */

function notImplemented(): never {
  throw new Error('Copilot platform not yet implemented');
}

export const copilotRequest = {
  fullConversationIdFromPath: notImplemented,
  paginatedConversationIdFromPath: notImplemented,
  isSendMessagePath: notImplemented,
};

export const copilotFetch = {
  getFetchUrl: notImplemented,
  maybeBumpFetch: notImplemented,
};

export function installCopilotMatchMediaSpoof(): void {
  notImplemented();
}

export function installCopilotMatchMediaToggleListener(): void {
  notImplemented();
}

export function postCopilotContractUpdate(_values: Record<string, string>): void {
  notImplemented();
}

export function setCopilotSidebarSpoofEnabled(_enabled: boolean): void {
  notImplemented();
}

export function buildCopilotBackfillUrl(
  _conversationId: string,
  _beforeCursor: string
): string {
  notImplemented();
}

export function probeCopilotFetchContract(
  _conversationId: string,
  _authHeaders: Record<string, string> | null
): Promise<void> {
  notImplemented();
}

export function createCopilotNavigationTurns(_data: unknown): never {
  notImplemented();
}

export function createCopilotRenderedFingerprintCollector(_opts: unknown): never {
  notImplemented();
}

export function inspectCopilotFetchRequest(
  _args: Parameters<typeof fetch>,
  _fallbackRouteKey: string
): never {
  notImplemented();
}

export function isCopilotNewChatRouteKey(_routeKey: string): never {
  notImplemented();
}

export function getCopilotScrollContainer(_root?: ParentNode): never {
  notImplemented();
}

export function findCopilotRenderedPrompt(
  _promptId: string,
  _root?: ParentNode
): never {
  notImplemented();
}

export function isCopilotElementVisible(
  _element: HTMLElement,
  _scrollContainer: HTMLElement
): never {
  notImplemented();
}

export function getCopilotScrollMetrics(_container: HTMLElement): never {
  notImplemented();
}

export function createCopilotElementNavigationAnchor(_opts: unknown): never {
  notImplemented();
}

export function observeCopilotVirtualPosition(_opts: unknown): never {
  notImplemented();
}

export function getCopilotPromptMountDiagnostic(_opts: unknown): never {
  notImplemented();
}

export function getCopilotNativePromptIndex(_button: HTMLButtonElement): never {
  notImplemented();
}

export function observeCopilotVisibleUserMessages(
  _callback: (id: string) => void
): () => void {
  // Returning a no-op cleanup so callers that immediately tear down still
  // get a stable function reference; any actual observation throws.
  notImplemented();
}

export function getCopilotJumpTargetElement(_message: unknown): never {
  notImplemented();
}

export function getCopilotCurrentRouteKey(): never {
  notImplemented();
}

export function getCopilotSidebarTitle(_routeKey: string): never {
  notImplemented();
}

export function getCopilotConversationLinkSelector(
  _conversationId: string
): never {
  notImplemented();
}

export function getCopilotNewChatRouteKey(_pathname: string): never {
  notImplemented();
}

export function getCopilotTestConfig(): never {
  notImplemented();
}

export function createCopilotJumpId(): never {
  notImplemented();
}

export function logCopilotEvent(): never {
  notImplemented();
}