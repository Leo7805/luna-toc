/** Tests that overlapping ChatGPT SSE responses never share partial-line buffers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractOutgoingMessage, inspectStream } from '@/pageHook/conversationStream';

afterEach(() => vi.unstubAllGlobals());

describe('outgoing user-message capture', () => {
  it('returns the parent message ID so history edits can be distinguished from new prompts', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const args = [
      '/backend-api/f/conversation',
      {
        method: 'POST',
        body: JSON.stringify({
          parent_message_id: 'previous-answer',
          messages: [{
            id: 'edited-prompt',
            author: { role: 'user' },
            content: { parts: ['Edited question'] },
            create_time: 123,
          }],
        }),
      },
    ] as unknown as Parameters<typeof fetch>;

    const result = extractOutgoingMessage(args, 'conversation-1');

    expect(result).toEqual({
      messageId: 'edited-prompt',
      parentMessageId: 'previous-answer',
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHATGPT_NEW_USER_MESSAGE',
        routeKey: 'conversation-1',
        payload: expect.objectContaining({
          id: 'edited-prompt',
          parentMessageId: 'previous-answer',
        }),
      }),
      '*'
    );
  });
});

describe('concurrent SSE readers', () => {
  it('keeps interleaved partial messages separated by route', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    let controllerA!: ReadableStreamDefaultController<Uint8Array>;
    let controllerB!: ReadableStreamDefaultController<Uint8Array>;
    const streamA = new ReadableStream<Uint8Array>({ start(controller) { controllerA = controller; } });
    const streamB = new ReadableStream<Uint8Array>({ start(controller) { controllerB = controller; } });
    const encode = new TextEncoder();
    const a = 'data: ' + JSON.stringify({
      type: 'input_message',
      input_message: { id: 'a', content: { parts: ['one'] } },
    }) + '\n';
    const b = 'data: ' + JSON.stringify({
      type: 'input_message',
      input_message: { id: 'b', content: { parts: ['two'] } },
    }) + '\n';
    const pA = inspectStream(new Response(streamA), 'route-a');
    const pB = inspectStream(new Response(streamB), 'route-b');
    controllerA.enqueue(encode.encode(a.slice(0, 20)));
    controllerB.enqueue(encode.encode(b.slice(0, 30)));
    controllerA.enqueue(encode.encode(a.slice(20)));
    controllerB.enqueue(encode.encode(b.slice(30)));
    controllerA.close();
    controllerB.close();
    await Promise.all([pA, pB]);
    expect(postMessage).toHaveBeenCalledTimes(2);
    const emitted = postMessage.mock.calls.map(([message]) => [message.routeKey, message.payload.id]);
    expect(emitted.sort()).toEqual([['route-a', 'a'], ['route-b', 'b']]);
  });
});
