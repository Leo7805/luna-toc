/** Checks exact source matching and conservative legacy prompt compatibility. */
import { describe, expect, it } from 'vitest';
import { findAddedPrompt } from '@/features/conversationPrompts/addedPrompt';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const message = (id: string, text: string): NavigatorMessage => ({
  id, text, canMatchByText: true, createTime: 1,
});
const saved = (id: string, text: string, sourceMessageId?: string): SavedPrompt => ({
  id, content: text, title: text.slice(0, 30), createdAt: 1, updatedAt: 1,
  ...(sourceMessageId ? { sourceMessageId } : {}),
});

describe('TOC saved prompt identity', () => {
  it('matches new additions by message ID even when saved content was edited', () => {
    const messages = [message('a', 'Duplicate'), message('b', 'Duplicate')];
    const prompt = saved('saved-b', 'Edited content', 'b');
    prompt.title = 'Edited title';
    expect(findAddedPrompt(messages[1], messages, [prompt])).toBe(prompt);
    expect(findAddedPrompt(messages[0], messages, [prompt])).toBeNull();
  });

  it('only infers pre-upgrade additions with a unique original title and content', () => {
    const msgs = [message('a', 'Legacy prompt text')];
    const legacy = saved('old', 'Legacy prompt text');
    expect(findAddedPrompt(msgs[0], msgs, [legacy])).toBe(legacy);
    expect(findAddedPrompt(msgs[0], msgs, [legacy, saved('duplicate', 'Legacy prompt text')]))
      .toBeNull();
    expect(findAddedPrompt(msgs[0], [msgs[0], message('b', 'Legacy prompt text')], [legacy]))
      .toBeNull();
    expect(findAddedPrompt(msgs[0], msgs, [{ ...legacy, title: 'Manually edited title' }]))
      .toBeNull();
  });

  it('never confuses sourced prompts from a different message with legacy text matches', () => {
    const msgs = [message('a', 'Same'), message('b', 'Different')];
    expect(findAddedPrompt(msgs[0], msgs, [saved('other', 'Same', 'b')]))
      .toBeNull();
    expect(findAddedPrompt(msgs[0], msgs, [saved('first', 'Same', 'a'), saved('second', 'Same', 'a')]))
      .toBeNull();
  });
});
