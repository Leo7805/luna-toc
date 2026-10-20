import { describe, expect, it } from 'vitest';
import { extractActiveBranchMessages, type ConversationSnapshot } from '@/navigation/state/activeBranch';
import type { ChatMessage } from '@/features/conversationPrompts/message';

function user(id: string): ChatMessage {
  return { id, author: { role: 'user' }, content: { parts: [id] } };
}

describe('extractActiveBranchMessages', () => {
  it('chooses the edited question branch and drops abandoned descendants', () => {
    const data: ConversationSnapshot = {
      messages: [],
      current_node: 'new-answer',
      mapping: {
        root: { parent: null },
        first: { parent: 'root', message: user('question-1') },
        original: { parent: 'first', message: user('question-old') },
        oldAnswer: { parent: 'original', message: { id: 'old-answer', author: { role: 'assistant' } } },
        obsolete: { parent: 'oldAnswer', message: user('question-obsolete') },
        edited: { parent: 'first', message: user('question-edited') },
        'new-answer': { parent: 'edited', message: { id: 'new-answer', author: { role: 'assistant' } } },
      },
    };
    expect(extractActiveBranchMessages(data)?.map((m) => m.id)).toEqual([
      'question-1', 'question-edited', 'new-answer',
    ]);
  });

  it('rejects broken parent paths instead of clearing the TOC', () => {
    expect(extractActiveBranchMessages({
      messages: [],
      current_node: 'leaf',
      mapping: { leaf: { parent: 'missing', message: user('leaf') } },
    })).toBeNull();
  });

  it('works with flat messages from the paginated endpoint', () => {
    expect(extractActiveBranchMessages({
      messages: [user('a'), user('b')],
    })?.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('follows explicit parents in a flat response when available', () => {
    const data = {
      current_node: 'edited',
      messages: [
        { ...user('a'), parent: null },
        { ...user('obsolete'), parent: 'a' },
        { ...user('edited'), parent: 'a' },
      ],
    };
    expect(extractActiveBranchMessages(data)?.map((m) => m.id)).toEqual(['a', 'edited']);
  });
});
