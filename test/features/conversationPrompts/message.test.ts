/** Tests flat ChatGPT message extraction used by the navigator. */
import { describe, expect, it } from 'vitest';
import {
  extractUserMessages,
  type ChatMessage,
  type ConversationData,
} from '@/features/conversationPrompts/message';

function createMessage(
  id: string,
  role: string,
  parts: string[],
  create_time = 0
): ChatMessage {
  return {
    id,
    author: { role },
    content: { parts },
    create_time,
  };
}

describe('extractUserMessages', () => {
  it('extracts only non-empty user prompts in order', () => {
    const data: ConversationData = {
      messages: [
        createMessage('system', 'system', ['System']),
        createMessage('user-1', 'user', ['First prompt']),
        createMessage('ai-1', 'assistant', ['First answer']),
        createMessage('user-2', 'user', ['Second prompt']),
      ],
    };

    expect(extractUserMessages(data)).toEqual([
      {
        id: 'user-1',
        text: 'First prompt',
        canMatchByText: true,
        createTime: 0,
      },
      {
        id: 'user-2',
        text: 'Second prompt',
        canMatchByText: true,
        createTime: 0,
      },
    ]);
  });

  it('collapses consecutive user messages to the final one', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-1', 'user', ['Stopped one']),
        createMessage('user-2', 'user', ['Stopped two']),
        createMessage('user-3', 'user', ['Answered prompt']),
        createMessage('ai-3', 'assistant', ['Answer']),
      ],
    };

    expect(extractUserMessages(data).map(({ id }) => id)).toEqual(['user-3']);
  });

  it('skips empty user messages', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-empty', 'user', ['   ']),
        createMessage('ai-1', 'assistant', ['Answer']),
        createMessage('user-1', 'user', ['Real prompt']),
      ],
    };

    expect(extractUserMessages(data).map(({ id }) => id)).toEqual(['user-1']);
  });

  it('returns an empty list for missing data', () => {
    expect(extractUserMessages(null)).toEqual([]);
    expect(extractUserMessages(undefined)).toEqual([]);
    expect(extractUserMessages({ messages: [] })).toEqual([]);
  });
});
