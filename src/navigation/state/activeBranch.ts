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
  /** Set only by the page hook after extracting a proven active branch. */
  activeBranchVerified?: true;
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

  // The hook already discarded abandoned branches and verified their parent
  // chain before crossing the page/content-script boundary. Never accept an
  // unmarked flat payload as an equally authoritative refresh snapshot.
  if (data.activeBranchVerified === true) {
    if (!Array.isArray(data.messages)) return null;
    const ids = new Set<string>();
    for (const message of data.messages) {
      if (typeof message?.id !== 'string' || !message.id || ids.has(message.id)) return null;
      ids.add(message.id);
    }
    return data.messages;
  }

  if (data.mapping && typeof data.mapping === 'object') {
    if (typeof data.current_node !== 'string') return null;

    const visited = new Set<string>();
    const messages: ChatMessage[] = [];
    let nodeId: string | null = data.current_node;

    while (nodeId) {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);

      const node: ConversationTreeNode | undefined = data.mapping[nodeId];
      if (!node || !Object.prototype.hasOwnProperty.call(node, 'parent')) return null;
      if (node.parent !== null && (typeof node.parent !== 'string' || !node.parent)) return null;
      if (node.message?.id) messages.push(node.message);
      nodeId = node.parent;
    }

    return messages.reverse();
  }

  if (!Array.isArray(data.messages)) return null;

  // An empty, explicitly terminal conversation has no alternate branch.
  if (data.messages.length === 0 &&
      data.current_node === null &&
      data.page_info?.has_previous_page === false) return [];

  // A flat response can contain abandoned edits. Only a COMPLETE parent
  // chain anchored at current_node proves which messages are selected.
  if (typeof data.current_node !== 'string' || !data.current_node) return null;
  const withParents = data.messages as Array<
    ChatMessage & { parent?: string | null; parent_id?: string | null }
  >;
  const nodes = new Map<string, typeof withParents[number]>();
  for (const message of withParents) {
    if (typeof message?.id !== 'string' || !message.id || nodes.has(message.id)) return null;
    nodes.set(message.id, message);
  }

  const visited = new Set<string>();
  const active: ChatMessage[] = [];
  let nodeId: string | null = data.current_node;
  while (nodeId !== null) {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    const message = nodes.get(nodeId);
    if (!message) return null;

    const hasParent = Object.prototype.hasOwnProperty.call(message, 'parent');
    const hasParentId = Object.prototype.hasOwnProperty.call(message, 'parent_id');
    if (!hasParent && !hasParentId) return null;
    if (hasParent && hasParentId &&
        message.parent !== message.parent_id) return null;
    const parent = hasParent ? message.parent : message.parent_id;
    if (parent !== null && (typeof parent !== 'string' || !parent)) return null;

    active.push(message);
    nodeId = parent;
  }
  return active.reverse();
}
