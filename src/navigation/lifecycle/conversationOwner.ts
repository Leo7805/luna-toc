/** Trusted account identity read by the isolated extension context. */
let activeConversationOwner: string | null = null;
const listeners = new Set<() => void>();

export function setActiveConversationOwner(ownerId: string | null): void {
  if (activeConversationOwner === ownerId) return;
  activeConversationOwner = ownerId;
  for (const notify of listeners) notify();
}

export function getActiveConversationOwner(): string | null {
  return activeConversationOwner;
}

export function subscribeActiveConversationOwner(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
