/**
 * ChatGPT namespaced window.postMessage channels. Each value mirrors a
 * channel shared between the ChatGPT MAIN-world hook and isolated content scripts.
 */
import type { PlatformMessageTypes } from '../platformInterface';

export const CHATGPT_MESSAGE_TYPES: PlatformMessageTypes = {
  conversationData: 'CHATGPT_CONVERSATION_DATA',
  conversationEnded: 'CHATGPT_CONVERSATION_ENDED',
  newUserMessage: 'CHATGPT_NEW_USER_MESSAGE',
  routeChanged: 'CHATGPT_ROUTE_CHANGED',
  titleChanged: 'CHATGPT_TITLE_CHANGED',
  configUpdate: 'LUNA_CHATGPT_CONFIG_UPDATE',
  contractMismatch: 'LUNA_CONTRACT_MISMATCH',
};