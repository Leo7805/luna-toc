/**
 * Copilot message-type bag. Namespaced under `COPILOT_*` / `LUNA_COPILOT_*`
 * so future Copilot traffic doesn't collide with ChatGPT's channels.
 */
import type { PlatformMessageTypes } from '../platformInterface';

export const COPILOT_MESSAGE_TYPES: PlatformMessageTypes = {
  conversationData: 'COPILOT_CONVERSATION_DATA',
  conversationEnded: 'COPILOT_CONVERSATION_ENDED',
  newUserMessage: 'COPILOT_NEW_USER_MESSAGE',
  routeChanged: 'COPILOT_ROUTE_CHANGED',
  titleChanged: 'COPILOT_TITLE_CHANGED',
  setWidthSpoof: 'COPILOT_NAVIGATOR_SET_WIDTH_SPOOF',
  configUpdate: 'LUNA_COPILOT_CONFIG_UPDATE',
  contractMismatch: 'LUNA_COPILOT_CONTRACT_MISMATCH',
};