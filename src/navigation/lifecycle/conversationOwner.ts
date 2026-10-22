/** Tracks the ChatGPT account confirmed by the current page's startup check. */
let activeConversationOwner: string | null = null;

/** Sets the current authenticated account, if known. */
export function setActiveConversationOwner(ownerId: string | null): void {
  activeConversationOwner = ownerId;
}

/** Gets the account used to scope newly saved local TOC title aliases. */
export function getActiveConversationOwner(): string | null {
  return activeConversationOwner;
}
