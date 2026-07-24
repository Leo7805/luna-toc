/** Tests conversion from ChatGPT payloads to generic navigation turns. */
import { describe, expect, it } from 'vitest';
import type {
  ChatContentPart,
  ChatMessage,
  ConversationData,
} from '@/features/conversationPrompts/message';
import { createChatGptNavigationTurns } from '@/platforms/chatgpt/navigationAdapter';

function createMessage(
  id: string,
  role: string,
  parts: ChatContentPart[]
): ChatMessage {
  return {
    id,
    author: { role },
    content: { parts },
  };
}

describe('createChatGptNavigationTurns', () => {
  it('uses only the active branch and keeps the final unanswered prompt', () => {
    const data: ConversationData = {
      current_node: 'user-2',
      mapping: {
        root: {
          message: createMessage('system', 'system', ['System']),
          parent: null,
        },
        'user-1': {
          message: createMessage('user-1', 'user', ['First']),
          parent: 'root',
        },
        'ai-1': {
          message: createMessage('ai-1', 'assistant', ['Answer']),
          parent: 'user-1',
        },
        branch: {
          message: createMessage('branch', 'user', ['Inactive']),
          parent: 'ai-1',
        },
        'user-2': {
          message: createMessage('user-2', 'user', ['Second']),
          parent: 'ai-1',
        },
      },
    };

    expect(createChatGptNavigationTurns(data)).toEqual([
      {
        promptIndex: 0,
        prompt: { id: 'user-1', text: 'First' },
        responses: [{ id: 'ai-1', text: 'Answer' }],
      },
      {
        promptIndex: 1,
        prompt: { id: 'user-2', text: 'Second' },
        responses: [],
      },
    ]);
  });

  it('excludes tool messages, attachments, and structured Assistant parts', () => {
    const data: ConversationData = {
      current_node: 'tool',
      mapping: {
        user: {
          message: createMessage('user', 'user', ['Prompt']),
          parent: null,
        },
        assistant: {
          message: {
            ...createMessage('assistant', 'assistant', [
              ' Visible answer ',
              { content_type: 'image_asset_pointer' },
            ]),
            metadata: {
              attachments: [{ name: 'answer.png', mime_type: 'image/png' }],
            },
          },
          parent: 'user',
        },
        tool: {
          message: createMessage('tool', 'tool', ['Tool output']),
          parent: 'assistant',
        },
      },
    };

    expect(createChatGptNavigationTurns(data)).toEqual([
      {
        promptIndex: 0,
        prompt: { id: 'user', text: 'Prompt' },
        responses: [{ id: 'assistant', text: 'Visible answer' }],
      },
    ]);
  });
});
