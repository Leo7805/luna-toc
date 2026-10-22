/** Tests flat ChatGPT message extraction used by the navigator. */
import { describe, expect, it } from 'vitest';
import {
  extractCollapsedUserMessageMap,
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

describe('extractCollapsedUserMessageMap', () => {
  it('returns an empty map when there are no consecutive user messages', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-1', 'user', ['First prompt']),
        createMessage('ai-1', 'assistant', ['First answer']),
        createMessage('user-2', 'user', ['Second prompt']),
      ],
    };

    const map = extractCollapsedUserMessageMap(data);
    expect(map.size).toBe(0);
  });

  it('maps collapsed user message IDs to the surviving message ID', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-1', 'user', ['Stopped one']),
        createMessage('user-2', 'user', ['Stopped two']),
        createMessage('user-3', 'user', ['Answered prompt']),
        createMessage('ai-3', 'assistant', ['Answer']),
      ],
    };

    const map = extractCollapsedUserMessageMap(data);
    expect(map.size).toBe(2);
    expect(map.get('user-1')).toBe('user-3');
    expect(map.get('user-2')).toBe('user-3');
    expect(map.has('user-3')).toBe(false);
  });

  it('handles multiple distinct clusters of consecutive user messages', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-1', 'user', ['First attempt']),
        createMessage('user-2', 'user', ['Second attempt']),
        createMessage('ai-1', 'assistant', ['Answer 1']),
        createMessage('user-3', 'user', ['Third attempt']),
        createMessage('user-4', 'user', ['Fourth attempt']),
        createMessage('user-5', 'user', ['Fifth attempt']),
        createMessage('ai-2', 'assistant', ['Answer 2']),
      ],
    };

    const map = extractCollapsedUserMessageMap(data);
    expect(map.size).toBe(3);
    expect(map.get('user-1')).toBe('user-2');
    expect(map.get('user-3')).toBe('user-5');
    expect(map.get('user-4')).toBe('user-5');
  });

  it('ignores empty user messages during collapse mapping', () => {
    const data: ConversationData = {
      messages: [
        createMessage('user-1', 'user', ['Attempt 1']),
        createMessage('user-empty', 'user', ['   ']),
        createMessage('user-2', 'user', ['Attempt 2']),
        createMessage('ai-1', 'assistant', ['Answer 1']),
      ],
    };

    const map = extractCollapsedUserMessageMap(data);
    expect(map.size).toBe(1);
    expect(map.get('user-1')).toBe('user-2');
    expect(map.has('user-empty')).toBe(false);
  });

  it('returns an empty map for missing or empty data', () => {
    expect(extractCollapsedUserMessageMap(null).size).toBe(0);
    expect(extractCollapsedUserMessageMap(undefined).size).toBe(0);
    expect(extractCollapsedUserMessageMap({ messages: [] }).size).toBe(0);
  });
});
