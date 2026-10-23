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

  it('rejects broken or unprovable mapping parent paths without clearing the TOC', () => {
    expect(extractActiveBranchMessages({
      messages: [],
      current_node: 'leaf',
      mapping: { leaf: { parent: 'missing', message: user('leaf') } },
    })).toBeNull();
    expect(extractActiveBranchMessages({
      messages: [],
      current_node: 'leaf',
      mapping: { leaf: { message: user('leaf') } },
    })).toBeNull();
  });

  it('rejects unlinked flat messages rather than guessing the active edit branch', () => {
    expect(extractActiveBranchMessages({
      messages: [user('a'), user('abandoned'), user('edited')],
      current_node: 'edited',
      page_info: { has_previous_page: false },
    })).toBeNull();
    expect(extractActiveBranchMessages({
      messages: [user('a'), user('b')],
    })).toBeNull();
  });

  it('accepts only a prevalidated, de-duplicated branch from the page hook', () => {
    expect(extractActiveBranchMessages({
      activeBranchVerified: true,
      messages: [user('a'), user('edited')],
    })?.map((m) => m.id)).toEqual(['a', 'edited']);
    expect(extractActiveBranchMessages({
      activeBranchVerified: true,
      messages: [user('a'), user('a')],
    })).toBeNull();
  });

  it('accepts an explicitly complete empty conversation', () => {
    expect(extractActiveBranchMessages({
      messages: [], current_node: null,
      page_info: { has_previous_page: false },
    })).toEqual([]);
  });

  it('rejects missing links, loops, and conflicting parent fields', () => {
    const missing = {
      current_node: 'edited',
      messages: [
        { ...user('a'), parent: null },
        { ...user('edited') },
      ],
    };
    expect(extractActiveBranchMessages(missing)).toBeNull();
    expect(extractActiveBranchMessages({
      current_node: 'edited',
      messages: [
        { ...user('a'), parent: 'edited' },
        { ...user('edited'), parent: 'a' },
      ],
    })).toBeNull();
    expect(extractActiveBranchMessages({
      current_node: 'edited',
      messages: [
        { ...user('a'), parent: null },
        { ...user('edited'), parent: 'a', parent_id: 'abandoned' },
      ],
    })).toBeNull();
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
