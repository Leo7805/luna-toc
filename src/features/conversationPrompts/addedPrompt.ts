/** Resolves a TOC message's saved My Prompts entry without ambiguous matches. */
import type { NavigatorMessage } from './message';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

/**
 * Finds the prompt created from this message.
 * New records use an exact source ID. Older entries can only be associated
 * when their original title and content uniquely match one TOC message.
 */
export function findAddedPrompt(
  message: NavigatorMessage,
  conversationMessages: readonly NavigatorMessage[],
  savedPrompts: readonly SavedPrompt[]
): SavedPrompt | null {
  const sourced = savedPrompts.filter((prompt) =>
    prompt.sourceMessageId === message.id
  );
  if (sourced.length === 1) return sourced[0];
  if (sourced.length > 1) return null;

  if (!message.text || conversationMessages.filter(
    (candidate) => candidate.text === message.text
  ).length !== 1) return null;

  const legacy = savedPrompts.filter((prompt) =>
    !prompt.sourceMessageId &&
    prompt.content === message.text &&
    prompt.title === message.text.slice(0, 30)
  );
  return legacy.length === 1 ? legacy[0] : null;
}
