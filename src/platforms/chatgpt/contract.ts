/**
 * ChatGPT contract table. Shares the schema defined in
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
    label: '对话数据 API 路径',
  },
  'api.conversation.messages-path': {
    formal: '/backend-api/conversations/{id}/messages',
    local: '/backend-api/conversations/{id}/messages',
    label: '对话消息分页接口',
  },
  'api.send-message.path': {
    formal: '/backend-api/f/conversation',
    local: '/backend-api/f/conversation',
    label: '发送消息 POST 接口',
  },
  'api.params.num-turns': {
    formal: 'num_turns',
    local: 'num_turns',
    label: '分页 num_turns 参数',
  },
  'api.params.before': {
    formal: 'before',
    local: 'before',
    label: '分页游标参数',
  },
  'api.params.include-has-versions': {
    formal: 'include_has_versions',
    local: 'include_has_versions',
    label: '分页 include_has_versions 标记',
  },
  'dom.selector.user-message': {
    formal: '[data-message-author-role="user"]',
    local: '[data-message-author-role="user"]',
    label: '用户消息 DOM 标记',
  },
  'dom.selector.message-id': {
    formal: '[data-message-id]',
    local: '[data-message-id]',
    label: '消息标识属性',
  },
  'postmessage.channel.conversation-data': {
    formal: 'CHATGPT_CONVERSATION_DATA',
    local: 'CHATGPT_CONVERSATION_DATA',
    label: '页面到扩展的对话数据通道',
  },
  'postmessage.hook-flag': {
    formal: '__conversationNavigatorFetchHookInstalled',
    local: '__conversationNavigatorFetchHookInstalled',
    label: '页面钩子安装标记',
  },
  'response.messages-field': {
    formal: 'messages',
    local: 'messages',
    label: '对话消息字段',
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