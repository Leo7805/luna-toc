/**
 * ChatGPT contract table. Mirrors the entry previously inlined in
 * `src/config/config.ts APP_CONFIG.platforms.chatgpt.contract`. Each entry
 * has parallel `formal`/`local` slots and a human-readable `label` for
 * the compatibility-alert popup.
 */
import type {
  ChatGptContractId,
  ChatGptContractTable,
} from '@/config/config';

export const CHATGPT_CONTRACT_TABLE: ChatGptContractTable = {
  'api.conversation.path': {
    formal: '/backend-api/conversations/{id}',
    local: '/backend-api/conversations/{id}',
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
};

/** Reads a contract slot using the active formal/local selection. */
export function resolveChatGptContractValue(
  id: ChatGptContractId,
  useLocalConfig: boolean
): string {
  const entry = CHATGPT_CONTRACT_TABLE[id];
  return useLocalConfig ? entry.local : entry.formal;
}

/** Returns a display label for a contract slot (used in the alert UI). */
export function labelChatGptContractValue(id: ChatGptContractId): string {
  return CHATGPT_CONTRACT_TABLE[id].label;
}