/** Exercises the real SSE parser with read-progress handshakes in Node. */
import { afterEach, expect, it, vi } from 'vitest';
import { inspectStream } from '@/pageHook/conversationStream';

/** Builds a complete event before splitting its encoded bytes. */
function eventLine(id: string): string {
  return `data: ${JSON.stringify({
    type: 'input_message',
    input_message: { id, content: { parts: ['Hello 世界'] }, create_time: 100 },
  })}\n`;
}

/** Exposes reads requested by inspectStream after processing the previous chunk. */
function controlledResponse() {
  const reads: Array<(value: ReadableStreamReadResult<Uint8Array>) => void> = [];
  const progress: Array<() => void> = [];
  const reader = {
    read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
      reads.push(resolve);
      progress.shift()?.();
    })),
  };
  return {
    response: { clone: () => ({ body: { getReader: () => reader } }) } as unknown as Response,
    async waitingForRead(count: number) {
      if (reader.read.mock.calls.length < count) {
        await new Promise<void>((resolve) => progress.push(resolve));
      }
      expect(reader.read).toHaveBeenCalledTimes(count);
      expect(reads).toHaveLength(1);
    },
    chunk(bytes: Uint8Array) { reads.shift()!({ done: false, value: bytes }); },
    end() { reads.shift()!({ done: true, value: undefined }); },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('parses a legal complete single-stream event before testing concurrency', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('window', { postMessage });
  await inspectStream(new Response(eventLine('single')), 'single-route');
  expect(postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    routeKey: 'single-route', payload: expect.objectContaining({ id: 'single' }),
  }), '*');
});

it('isolates overlapping partial lines and flushes EOF without a newline', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('window', { postMessage });
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(eventLine('A').trimEnd());
  const bBytes = encoder.encode(eventLine('B'));
  const a = controlledResponse();
  const aDone = inspectStream(a.response, 'route-A');
  await a.waitingForRead(1);
  a.chunk(aBytes.slice(0, 35));
  // A has consumed the partial line and called read() again before B exists.
  await a.waitingForRead(2);
  expect(postMessage).not.toHaveBeenCalled();
  const b = controlledResponse();
  const bDone = inspectStream(b.response, 'route-B');
  await b.waitingForRead(1);
  b.chunk(bBytes.slice(0, 45));
  await b.waitingForRead(2);
  b.chunk(bBytes.slice(45));
  await b.waitingForRead(3);
  b.end();
  await bDone;
  a.chunk(aBytes.slice(35));
  await a.waitingForRead(3);
  a.end();
  await aDone;
  expect(postMessage.mock.calls.map(([message]) => [message.routeKey, message.payload.id]))
    .toEqual([['route-B', 'B'], ['route-A', 'A']]);
  expect(postMessage.mock.calls.map(([message]) => message.payload.content.parts[0]))
    .toEqual(['Hello 世界', 'Hello 世界']);
});
