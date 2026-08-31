/**
 * Reads the cloned send-message SSE response so newly submitted user prompts
 * can appear in the navigator before the next full conversation fetch
 * completes. Also parses the outgoing POST body for the same prompt so the
 * sidebar updates before the server even starts streaming.
 *
 * Owns the SSE line buffer (`streamBuffer`) and the
 * `CHATGPT_NEW_USER_MESSAGE` message-type constant.
 */
import type { FetchArgs } from './fetchHelpers';

const NEW_USER_MESSAGE_TYPE = 'CHATGPT_NEW_USER_MESSAGE';

interface OutgoingMessage {
  id: string;
  author?: { role?: string };
  content?: unknown;
  metadata?: unknown;
  create_time?: number;
}

interface OutgoingRequestBody {
  messages?: OutgoingMessage[];
}

let streamBuffer = '';

/**
 * Attempts to parse the outgoing POST request body to immediately capture
 * the user's prompt before the server responds.
 */
export function extractOutgoingMessage(
  args: FetchArgs,
  routeKey: string,
  messageType: string = NEW_USER_MESSAGE_TYPE
): void {
  try {
    const init = args[1] || {};
    if (typeof init.body === 'string') {
      const data = JSON.parse(init.body) as OutgoingRequestBody;
      const messages = data.messages || [];
      const userMessage = messages.find((m) => m.author?.role === 'user');

      if (userMessage) {
        window.postMessage(
          {
            type: messageType,
            routeKey,
            payload: {
              id: userMessage.id,
              content: userMessage.content,
              metadata: userMessage.metadata,
              createTime: userMessage.create_time || Date.now(),
            },
          },
          '*'
        );
      }
    }
  } catch {}
}

/**
 * Reads a cloned send-message SSE stream so newly submitted user prompts can
 * appear in the navigator before the next full conversation fetch completes.
 * Resets the internal line buffer on entry so the previous stream's leftover
 * partial line cannot leak into this stream.
 */
export async function inspectStream(
  response: Response,
  routeKey: string,
  messageType: string = NEW_USER_MESSAGE_TYPE
): Promise<void> {
  const reader = response.clone().body?.getReader();

  if (!reader) return;

  streamBuffer = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (streamBuffer.trim()) {
        processStreamLine(streamBuffer, routeKey, messageType);
        streamBuffer = '';
      }

      break;
    }

    streamBuffer += decoder.decode(value, {
      stream: true,
    });

    processBufferedStream(routeKey, messageType);
  }
}

/**
 * Splits the accumulated SSE buffer into complete lines while keeping the
 * trailing partial line for the next stream chunk.
 */
function processBufferedStream(routeKey: string, messageType: string): void {
  const lines = streamBuffer.split('\n');

  // The last line may be incomplete.
  streamBuffer = lines.pop() || '';

  for (const line of lines) {
    processStreamLine(line, routeKey, messageType);
  }
}

/**
 * Parses one SSE data line and forwards ChatGPT input_message events to the
 * content script.
 */
function processStreamLine(
  line: string,
  routeKey: string,
  messageType: string
): void {
  if (!line.startsWith('data: ')) {
    return;
  }

  const jsonText = line.slice(6).trim();

  if (!jsonText || jsonText === '[DONE]') {
    return;
  }

  try {
    const data = JSON.parse(jsonText);

    if (data.type === 'input_message') {
      const message = data.input_message;

      window.postMessage(
        {
          type: messageType,
          routeKey,
          payload: {
            id: message.id,
            content: message.content,
            metadata: message.metadata,
            createTime: message.create_time || Date.now(),
          },
        },
        '*'
      );
    }
  } catch {}
}