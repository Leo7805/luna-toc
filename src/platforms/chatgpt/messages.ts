/**
 * ChatGPT namespaced window.postMessage channels. Each value mirrors a
 * constant previously inlined in `src/page/pageHook.iife.ts` and the
 * content-script message listeners.
 */
import type { PlatformMessageTypes } from '../platformInterface';

export const CHATGPT_MESSAGE_TYPES: PlatformMessageTypes = {
  conversationData: 'CHATGPT_CONVERSATION_DATA',
  conversationEnded: 'CHATGPT_CONVERSATION_ENDED',
  newUserMessage: 'CHATGPT_NEW_USER_MESSAGE',
  routeChanged: 'CHATGPT_ROUTE_CHANGED',
  titleChanged: 'CHATGPT_TITLE_CHANGED',
  setWidthSpoof: 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF',
  configUpdate: 'LUNA_CHATGPT_CONFIG_UPDATE',
  contractMismatch: 'LUNA_CONTRACT_MISMATCH',
};