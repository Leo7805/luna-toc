/** @vitest-environment jsdom */
/** Tests observed fingerprint collection from stabilized ChatGPT DOM text. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderedFingerprintCollector } from '@/platforms/chatgpt/renderedFingerprintCollector';
import type {
  RenderedFingerprintContext,
  RenderedFingerprintCollector,
} from '@/platforms/chatgpt/renderedFingerprintCollector';

let collector: RenderedFingerprintCollector | null = null;

afterEach(() => {
  collector?.disconnect();
  collector = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatGPT rendered fingerprint collector', () => {
  it('maps rendered Assistant IDs to observed fingerprint records', async () => {
    const records: Array<{
      context: RenderedFingerprintContext;
      responseId: string;
      promptIndex: number;
      quality: string;
    }> = [];
    const context = {
      conversationKey: 'conversation-1',
      revision: 2,
      responsePromptIndexes: new Map([['response-1', 3]]),
    };
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">Rendered **answer** text</div>
      </div>
    `;
    collector = createRenderedFingerprintCollector({
      onFingerprintRecord: (recordContext, record) => {
        records.push({
          context: recordContext,
          responseId: record.responseId,
          promptIndex: record.promptIndex,
          quality: record.quality,
        });
      },
    });
    collector.setContext(context);

    await collector.collect();

    expect(records).toEqual([
      {
        context,
        responseId: 'response-1',
        promptIndex: 3,
        quality: 'observed',
      },
    ]);
  });

  it('ignores rendered messages without a known response mapping', async () => {
    const onFingerprintRecord = vi.fn();
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="unknown">
        <div class="markdown">Unknown answer</div>
      </div>
    `;
    collector = createRenderedFingerprintCollector({
      onFingerprintRecord,
    });
    collector.setContext({
      conversationKey: 'conversation-1',
      revision: 1,
      responsePromptIndexes: new Map(),
    });

    await collector.collect();

    expect(onFingerprintRecord).not.toHaveBeenCalled();
  });

  it('does not regenerate unchanged rendered response text', async () => {
    const onFingerprintRecord = vi.fn();
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">Stable answer</div>
      </div>
    `;
    collector = createRenderedFingerprintCollector({
      onFingerprintRecord,
    });
    collector.setContext({
      conversationKey: 'conversation-1',
      revision: 1,
      responsePromptIndexes: new Map([['response-1', 0]]),
    });

    await collector.collect();
    await collector.collect();

    expect(onFingerprintRecord).toHaveBeenCalledTimes(1);
  });

  it('collects the latest text after DOM mutations settle', async () => {
    vi.useFakeTimers();
    const onFingerprintRecord = vi.fn();
    collector = createRenderedFingerprintCollector({
      debounceMs: 50,
      onFingerprintRecord,
    });
    collector.setContext({
      conversationKey: 'conversation-1',
      revision: 1,
      responsePromptIndexes: new Map([['response-1', 0]]),
    });
    collector.observe(document.body);
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">Partial</div>
      </div>
    `;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    document.querySelector('.markdown')!.textContent = 'Completed answer';

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    expect(onFingerprintRecord).toHaveBeenCalledTimes(1);
    expect(
      onFingerprintRecord.mock.calls[0]?.[1].fingerprints[0]?.probeText
    ).toContain('Completed answer');
  });

  it('uses the current conversation context after a route switch', async () => {
    vi.useFakeTimers();
    const onFingerprintRecord = vi.fn();
    collector = createRenderedFingerprintCollector({
      debounceMs: 20,
      onFingerprintRecord,
    });
    collector.observe(document.body);
    collector.setContext({
      conversationKey: 'old-conversation',
      revision: 1,
      responsePromptIndexes: new Map([['response-1', 0]]),
    });
    collector.setContext({
      conversationKey: 'new-conversation',
      revision: 4,
      responsePromptIndexes: new Map([['response-1', 2]]),
    });
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="response-1">
        <div class="markdown">New route answer</div>
      </div>
    `;

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);

    expect(onFingerprintRecord).toHaveBeenCalledTimes(1);
    expect(onFingerprintRecord.mock.calls[0]?.[0]).toMatchObject({
      conversationKey: 'new-conversation',
      revision: 4,
    });
    expect(onFingerprintRecord.mock.calls[0]?.[1].promptIndex).toBe(2);
  });

});
