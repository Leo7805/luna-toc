/**
 * @vitest-environment jsdom
 * Exercises mark reconciliation without touching another account's records.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPromptMarksForConversation,
  getPromptMarkOwner,
  getStoredMarkConversationIds,
  setPromptMarkOwner,
} from '@/features/conversationPrompts/promptMark';
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';

describe('conversation-scoped mark cleanup', () => {
  afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
  it('finds permanent conversation references without including temporary routes', () => {
    sessionStorage.setItem('chatToc:marks:conversation-123', '["prompt-1"]');
    sessionStorage.setItem('chatToc:marks:local-12345678', '["prompt-2"]');
    sessionStorage.setItem('chatToc:marks:new-chat:/', '["prompt-3"]');
    expect(getStoredMarkConversationIds()).toEqual(['conversation-123']);
    expect(isPermanentConversationId('local-12345678')).toBe(false);
  });
  it('removes both a mark collection and its account binding', () => {
    sessionStorage.setItem('chatToc:marks:conversation-123', '["prompt-1"]');
    sessionStorage.setItem('chatToc:markOwner:conversation-123', 'account-1');
    expect(getPromptMarkOwner('conversation-123')).toBe('account-1');
    clearPromptMarksForConversation('conversation-123');
    expect(sessionStorage.getItem('chatToc:marks:conversation-123')).toBeNull();
    expect(getPromptMarkOwner('conversation-123')).toBeNull();
    setPromptMarkOwner(null);
  });
});
