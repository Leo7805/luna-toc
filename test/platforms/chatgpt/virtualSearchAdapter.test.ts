/** @vitest-environment jsdom */
/** Tests ChatGPT DOM adaptation for generic virtual navigation. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createChatGptElementNavigationAnchor,
  findRenderedChatGptPrompt,
  getChatGptScrollContainer,
  getChatGptScrollMetrics,
  observeChatGptVirtualPosition,
} from '@/platforms/chatgpt/virtualSearchAdapter';
import type { NavigationFingerprintIndex } from '@/features/navigation/fingerprint/index';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ChatGPT virtual search adapter', () => {
  it('finds the scrollable ancestor of a mounted message', () => {
    document.body.innerHTML = `
      <main>
        <div id="chat-scroll" style="overflow-y: auto">
          <div data-message-author-role="user">Prompt</div>
        </div>
      </main>
    `;

    expect(getChatGptScrollContainer()?.id).toBe('chat-scroll');
  });

  it('uses known ChatGPT scroll-container selectors as fallback', () => {
    document.body.innerHTML = `
      <main>
        <div id="selector-scroll" class="overflow-y-auto"></div>
      </main>
    `;

    expect(getChatGptScrollContainer()?.id).toBe('selector-scroll');
  });

  it('finds rendered prompts with direct or ancestor message IDs', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user" data-message-id="prompt-1">
        First prompt
      </div>
      <section data-message-id="prompt-2">
        <div data-message-author-role="user">Second prompt</div>
      </section>
    `;

    expect(findRenderedChatGptPrompt('prompt-1')?.textContent).toContain(
      'First prompt'
    );
    expect(findRenderedChatGptPrompt('prompt-2')?.textContent).toContain(
      'Second prompt'
    );
    expect(findRenderedChatGptPrompt('missing')).toBeNull();
  });

  it('returns normalized scroll metrics', () => {
    const container = document.createElement('div');
    setElementMeasurements(container, {
      scrollTop: 600,
      scrollHeight: 5_000,
      clientWidth: 900,
      clientHeight: 1_000,
    });

    expect(getChatGptScrollMetrics(container)).toEqual({
      scrollTop: 600,
      maximumScrollTop: 4_000,
      viewportWidth: 900,
    });
  });

  it('creates an anchor from the element position inside its container', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    setElementMeasurements(container, {
      scrollTop: 1_000,
      scrollHeight: 5_000,
      clientWidth: 900,
      clientHeight: 1_000,
      top: 100,
    });
    setElementMeasurements(element, { top: 350 });

    const anchor = createChatGptElementNavigationAnchor({
      conversationKey: 'conversation-1',
      promptId: 'prompt-3',
      promptIndex: 3,
      element,
      scrollContainer: container,
    });

    expect(anchor).toMatchObject({
      conversationKey: 'conversation-1',
      promptId: 'prompt-3',
      promptIndex: 3,
      scrollTop: 1_250,
      scrollHeight: 5_000,
      viewportWidth: 900,
      viewportHeight: 1_000,
    });
  });

  it('maps located Assistant blocks to prompt-specific anchors', async () => {
    document.body.innerHTML = `
      <main>
        <div id="chat-scroll" style="overflow-y: auto">
          <div
            data-message-author-role="assistant"
            data-message-id="response-1"
          >
            <div class="markdown">Rendered answer</div>
          </div>
        </div>
      </main>
    `;
    const container = document.getElementById('chat-scroll')!;
    const assistant = document.querySelector<HTMLElement>(
      '[data-message-author-role="assistant"]'
    )!;
    setElementMeasurements(container, {
      scrollTop: 1_000,
      scrollHeight: 5_000,
      clientWidth: 900,
      clientHeight: 1_000,
      top: 100,
    });
    setElementMeasurements(assistant, { top: 350 });
    const fingerprintIndex: NavigationFingerprintIndex = [
      {
        responseId: 'response-1',
        promptIndex: 2,
        quality: 'observed',
        fingerprints: [],
      },
    ];

    const observation = await observeChatGptVirtualPosition({
      conversationKey: 'conversation-1',
      prompts: [
        { id: 'prompt-0' },
        { id: 'prompt-1' },
        { id: 'prompt-2' },
      ],
      fingerprintIndex,
      scrollContainer: container,
    });

    expect(observation.position).toMatchObject({
      status: 'located',
      matchedBlocks: [{ blockId: 'response-1', promptIndex: 2 }],
    });
    expect(observation.anchors).toMatchObject([
      {
        promptId: 'prompt-2',
        promptIndex: 2,
        scrollTop: 1_250,
      },
    ]);
  });

  it('returns no observation when the scroll container is unavailable', async () => {
    const observation = await observeChatGptVirtualPosition({
      conversationKey: 'conversation-1',
      prompts: [],
      fingerprintIndex: [],
      scrollContainer: null,
    });

    expect(observation).toEqual({
      position: { status: 'none' },
      anchors: [],
    });
  });
});

/**
 * Defines jsdom layout measurements used by scroll-position tests.
 */
function setElementMeasurements(
  element: HTMLElement,
  measurements: {
    scrollTop?: number;
    scrollHeight?: number;
    clientWidth?: number;
    clientHeight?: number;
    top?: number;
  }
): void {
  const {
    scrollTop = 0,
    scrollHeight = 0,
    clientWidth = 0,
    clientHeight = 0,
    top = 0,
  } = measurements;

  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: scrollTop },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientWidth: { configurable: true, value: clientWidth },
    clientHeight: { configurable: true, value: clientHeight },
  });
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      right: clientWidth,
      bottom: top + clientHeight,
      left: 0,
      width: clientWidth,
      height: clientHeight,
      toJSON: () => ({}),
    }) as DOMRect;
}
