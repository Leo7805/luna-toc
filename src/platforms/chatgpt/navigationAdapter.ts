/**
 * Adapts ChatGPT conversation payloads to platform-independent navigation data.
 */
import {
  extractUserMessages,
  getMessageDisplayText,
  type ChatMessage,
  type ConversationData,
} from '@/features/conversationPrompts/message';
import {
  createNavigationTurns,
  type NavigationSourceMessage,
  type NavigationTurn,
} from '@/navigation/navigationData';

/**
 * Converts the active ChatGPT conversation branch into navigation turns.
 * Only visible AI text is retained for future fingerprint generation.
 *
 * @example
 * const turns = createChatGptNavigationTurns(conversationData);
 */
export function createChatGptNavigationTurns(
  data: ConversationData | null | undefined
): NavigationTurn[] {
  if (!data?.messages?.length) return [];

  const messages = data.messages
    .map((message) => toNavigationSourceMessage(message))
    .filter((message): message is NavigationSourceMessage => Boolean(message));

  const turns = createNavigationTurns(messages);
  const promptIndexes = new Map(
    extractUserMessages(data).map(({ id }, index) => [id, index])
  );

  return turns.flatMap((turn) => {
    const promptIndex = promptIndexes.get(turn.prompt.id);
    return promptIndex === undefined ? [] : [{ ...turn, promptIndex }];
  });
}

/**
 * Converts a supported ChatGPT user or Assistant message to a generic message.
 */
function toNavigationSourceMessage(
  message: ChatMessage | undefined
): NavigationSourceMessage | null {
  const role = message?.author?.role;

  if (!message || (role !== 'user' && role !== 'assistant')) return null;

  const text =
    role === 'user'
      ? getMessageDisplayText(message)
      : getAssistantText(message);

  return {
    id: message.id,
    kind: role === 'user' ? 'prompt' : 'response',
    text,
  };
}

/**
 * Extracts only textual Assistant content, excluding tools and attachments.
 */
function getAssistantText(message: ChatMessage): string {
  return (message.content?.parts || [])
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}
