/** Tests platform-independent prompt/response turn construction. */
import { describe, expect, it } from 'vitest';
import { createNavigationTurns } from '@/features/navigation/navigationData';

describe('createNavigationTurns', () => {
  it('groups responses under the preceding prompt', () => {
    const turns = createNavigationTurns([
      { id: 'user-1', kind: 'prompt', text: ' First prompt ' },
      { id: 'ai-1', kind: 'response', text: 'First response' },
      { id: 'ai-2', kind: 'response', text: 'Second response' },
      { id: 'user-2', kind: 'prompt', text: 'Second prompt' },
      { id: 'ai-3', kind: 'response', text: 'Third response' },
    ]);

    expect(turns).toEqual([
      {
        promptIndex: 0,
        prompt: { id: 'user-1', text: 'First prompt' },
        responses: [
          { id: 'ai-1', text: 'First response' },
          { id: 'ai-2', text: 'Second response' },
        ],
      },
      {
        promptIndex: 1,
        prompt: { id: 'user-2', text: 'Second prompt' },
        responses: [{ id: 'ai-3', text: 'Third response' }],
      },
    ]);
  });

  it('ignores responses before the first prompt and empty messages', () => {
    const turns = createNavigationTurns([
      { id: 'orphan', kind: 'response', text: 'Ignored' },
      { id: 'empty-prompt', kind: 'prompt', text: '  ' },
      { id: 'user-1', kind: 'prompt', text: 'Prompt' },
      { id: 'empty-response', kind: 'response', text: '' },
    ]);

    expect(turns).toEqual([
      {
        promptIndex: 0,
        prompt: { id: 'user-1', text: 'Prompt' },
        responses: [],
      },
    ]);
  });
});
