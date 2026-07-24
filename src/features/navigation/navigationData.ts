/**
 * Defines the platform-independent conversation model used by navigation.
 */
export interface NavigationTextMessage {
  id: string;
  text: string;
}

export interface NavigationSourceMessage extends NavigationTextMessage {
  kind: 'prompt' | 'response';
}

export interface NavigationTurn {
  promptIndex: number;
  prompt: NavigationTextMessage;
  responses: NavigationTextMessage[];
}

/**
 * Groups normalized platform messages into prompt/response turns.
 *
 * @example
 * createNavigationTurns([
 *   { id: 'user-1', kind: 'prompt', text: 'Hello' },
 *   { id: 'ai-1', kind: 'response', text: 'Hi' },
 * ]);
 */
export function createNavigationTurns(
  messages: NavigationSourceMessage[]
): NavigationTurn[] {
  const turns: NavigationTurn[] = [];
  let currentTurn: NavigationTurn | null = null;

  messages.forEach((message) => {
    const normalizedMessage = createNavigationTextMessage(message);

    if (!normalizedMessage) return;

    if (message.kind === 'prompt') {
      currentTurn = {
        promptIndex: turns.length,
        prompt: normalizedMessage,
        responses: [],
      };
      turns.push(currentTurn);
      return;
    }

    currentTurn?.responses.push(normalizedMessage);
  });

  return turns;
}

/**
 * Creates a compact non-empty text message for navigation matching.
 */
export function createNavigationTextMessage(
  message: NavigationTextMessage
): NavigationTextMessage | null {
  const text = message.text.trim();

  if (!text) return null;

  return {
    id: message.id,
    text,
  };
}
