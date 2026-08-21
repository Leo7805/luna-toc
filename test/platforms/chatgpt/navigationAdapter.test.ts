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
  it('keeps response indexes aligned after consecutive unanswered prompts', () => {
    const data: ConversationData = {
      messages: [
        createMessage('system', 'system', ['System']),
        createMessage('user-1', 'user', ['Stopped one']),
        createMessage('user-2', 'user', ['Stopped two']),
        createMessage('user-3', 'user', ['Answered prompt']),
        createMessage('ai-3', 'assistant', ['First answer']),
        createMessage('user-4', 'user', ['Next prompt']),
        createMessage('ai-4', 'assistant', ['Next answer']),
      ],
    };

    expect(createChatGptNavigationTurns(data)).toEqual([
      {
        promptIndex: 0,
        prompt: { id: 'user-3', text: 'Answered prompt' },
        responses: [{ id: 'ai-3', text: 'First answer' }],
      },
      {
        promptIndex: 1,
        prompt: { id: 'user-4', text: 'Next prompt' },
        responses: [{ id: 'ai-4', text: 'Next answer' }],
      },
    ]);
  });

  it('keeps the final unanswered prompt', () => {
    const data: ConversationData = {
      messages: [
        createMessage('system', 'system', ['System']),
        createMessage('user-1', 'user', ['First']),
        createMessage('ai-1', 'assistant', ['Answer']),
        createMessage('user-2', 'user', ['Second']),
      ],
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
      messages: [
        createMessage('user', 'user', ['Prompt']),
        {
          ...createMessage('assistant', 'assistant', [
            ' Visible answer ',
            { content_type: 'image_asset_pointer' },
          ]),
          metadata: {
            attachments: [{ name: 'answer.png', mime_type: 'image/png' }],
          },
        },
        createMessage('tool', 'tool', ['Tool output']),
      ],
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
