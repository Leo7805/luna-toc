/**
 * Extracts the currently selected conversation branch from either ChatGPT's
 * legacy tree payload or its paginated messages payload.
 */
import type { ChatMessage, ConversationData } from '@/features/conversationPrompts/message';

export interface ConversationTreeNode {
  parent?: string | null;
  message?: ChatMessage | null;
}

export interface ConversationSnapshot extends ConversationData {
  mapping?: Record<string, ConversationTreeNode>;
}

/**
 * A mapping contains abandoned versions as well as the selected branch.
 * Walk parents from current_node; never infer the branch from timestamps.
 * Returning null means the snapshot is unusable, NOT an empty conversation.
 */
export function extractActiveBranchMessages(
  data: ConversationSnapshot | null | undefined
): ChatMessage[] | null {
  if (!data || typeof data !== 'object') return null;

  if (data.mapping && typeof data.mapping === 'object') {
    if (typeof data.current_node !== 'string') return null;

    const visited = new Set<string>();
    const messages: ChatMessage[] = [];
    let nodeId: string | null = data.current_node;

    while (nodeId) {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);

      const node: ConversationTreeNode | undefined = data.mapping[nodeId];
      if (!node) return null;
      if (node.message?.id) messages.push(node.message);
      nodeId = node.parent ?? null;
    }

    return messages.reverse();
  }

  if (!Array.isArray(data.messages)) return null;

  // Some flat-message responses retain parent IDs; use them when the
  // current_node identifies a message. Otherwise the API's ordered list is
  // the only available navigation representation.
  const withParents = data.messages as Array<
    ChatMessage & { parent?: string | null; parent_id?: string | null }
  >;
  const nodes = new Map(withParents.filter((m) => !!m?.id).map((m) => [m.id, m]));
  if (
    typeof data.current_node === 'string' &&
    nodes.has(data.current_node) &&
    withParents.some((message) => message.parent != null || message.parent_id != null)
  ) {
    const visited = new Set<string>();
    const active: ChatMessage[] = [];
    let nodeId: string | null = data.current_node;
    while (nodeId) {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);
      const message = nodes.get(nodeId);
      if (!message) return null;
      active.push(message);
      nodeId = message.parent ?? message.parent_id ?? null;
    }
    return active.reverse();
  }

  return data.messages.filter((message) => !!message?.id);
}
