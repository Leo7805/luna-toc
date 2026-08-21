/** Tests ChatGPT full-conversation API path recognition. */
import { describe, expect, it } from 'vitest';

import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from '@/platforms/chatgpt/conversationRequest';

describe('ChatGPT conversation request paths', () => {
  it.each([
    ['/backend-api/conversation/legacy-id', 'legacy-id'],
    ['/backend-api/conversations/current-id', 'current-id'],
    ['/backend-api/conversations/encoded%20id/', 'encoded id'],
  ])('recognizes a full conversation path: %s', (pathname, expectedId) => {
    expect(getConversationIdFromApiPath(pathname)).toBe(expectedId);
  });

  it.each([
    '/backend-api/conversations',
    '/backend-api/conversation/init',
    '/backend-api/conversation/example-id/textdocs',
    '/backend-api/conversations/example-id/attachments',
  ])('rejects a non-conversation-resource path: %s', (pathname) => {
    expect(getConversationIdFromApiPath(pathname)).toBeNull();
  });
});

describe('ChatGPT conversation messages paths', () => {
  it.each([
    ['/backend-api/conversations/current-id/messages', 'current-id'],
    ['/backend-api/conversation/legacy-id/messages/', 'legacy-id'],
    ['/backend-api/conversations/encoded%20id/messages', 'encoded id'],
  ])('recognizes a messages sub-path: %s', (pathname, expectedId) => {
    expect(getConversationMessagesIdFromApiPath(pathname)).toBe(expectedId);
  });

  it.each([
    '/backend-api/conversations/current-id',
    '/backend-api/conversations',
    '/backend-api/conversations/current-id/messages/textdocs',
    '/backend-api/conversations/init/messages',
  ])('rejects a non-messages-resource path: %s', (pathname) => {
    expect(getConversationMessagesIdFromApiPath(pathname)).toBeNull();
  });
});
