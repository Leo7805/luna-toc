/**
 * @vitest-environment jsdom
 * Verifies one-click prompt copying with clipboard and legacy fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPromptText } from '@/features/conversationPrompts/copyPrompt';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyPromptText', () => {
  it('copies the complete original prompt with the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyPromptText('First line\nSecond line');

    expect(writeText).toHaveBeenCalledExactlyOnceWith('First line\nSecond line');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to a temporary selected textarea on Clipboard API failure', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true, value: execCommand,
    });

    await copyPromptText('Fallback text');

    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('rejects when neither clipboard mechanism can copy', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    Object.defineProperty(document, 'execCommand', {
      configurable: true, value: vi.fn().mockReturnValue(false),
    });

    await expect(copyPromptText('No clipboard')).rejects.toThrow('Unable to copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
