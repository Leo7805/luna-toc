/** @vitest-environment jsdom */
/** Tests ChatGPT DOM adaptation for generic virtual navigation. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createChatGptElementNavigationAnchor,
  findRenderedChatGptPrompt,
  getChatGptPromptMountDiagnostic,
  getChatGptScrollContainer,
  getChatGptScrollMetrics,
  isChatGptElementVisible,
  observeChatGptVirtualPosition,
} from '@/platforms/chatgpt/virtualSearchAdapter';
import type { NavigationFingerprintIndex } from '@/navigation/fingerprint/index';

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
      viewportHeight: 1_000,
    });
  });

  it('distinguishes visible prompts from retained offscreen DOM', () => {
    const container = document.createElement('div');
    const visiblePrompt = document.createElement('div');
    const offscreenPrompt = document.createElement('div');
    const touchingBoundary = document.createElement('div');
    setElementMeasurements(container, {
      clientWidth: 900,
      clientHeight: 500,
      top: 100,
    });
    setElementMeasurements(visiblePrompt, {
      clientHeight: 100,
      top: 200,
    });
    setElementMeasurements(offscreenPrompt, {
      clientHeight: 100,
      top: 700,
    });
    setElementMeasurements(touchingBoundary, {
      clientHeight: 100,
      top: 600,
    });

    expect(isChatGptElementVisible(visiblePrompt, container)).toBe(true);
    expect(isChatGptElementVisible(offscreenPrompt, container)).toBe(false);
    expect(isChatGptElementVisible(touchingBoundary, container)).toBe(false);
  });

  it('collects text-free DOM evidence for exhausted Prompt mounting', () => {
    document.body.innerHTML = `
      <main>
        <div id="chat-scroll">
          <section data-turn="user" data-message-id="prompt-20">
            <div data-message-author-role="user">Private prompt text</div>
          </section>
          <section data-turn="assistant">
            <div
              data-message-author-role="assistant"
              data-message-id="response-20"
            >
              <div class="markdown">Private response text</div>
            </div>
          </section>
        </div>
      </main>
    `;
    const container = document.getElementById('chat-scroll')!;
    const prompt = document.querySelector<HTMLElement>(
      '[data-message-author-role="user"]'
    )!;
    const assistant = document.querySelector<HTMLElement>(
      '[data-message-author-role="assistant"]'
    )!;
    setElementMeasurements(container, {
      clientWidth: 900,
      clientHeight: 500,
      top: 100,
    });
    setElementMeasurements(prompt, { clientHeight: 100, top: 200 });
    setElementMeasurements(assistant, {
      clientHeight: 100,
      top: 350,
    });

    const diagnostic = getChatGptPromptMountDiagnostic({
      promptId: 'prompt-20',
      matchedBlockIds: ['response-20'],
      scrollContainer: container,
      getNavigatorIndex: (element) =>
        element.dataset.messageAuthorRole === 'user' ? 20 : -1,
      matchesTargetPromptText: (element) =>
        element.dataset.messageAuthorRole === 'user',
    });

    expect(diagnostic).toMatchObject({
      mountedUserMessageCount: 1,
      visibleUserMessages: [
        {
          role: 'user',
          messageId: 'prompt-20',
          navigatorIndex: 20,
          matchesTargetPromptText: true,
          visible: true,
        },
      ],
      targetPromptCandidates: [
        {
          messageId: 'prompt-20',
        },
      ],
      targetIdNodes: [
        {
          messageId: 'prompt-20',
          turn: 'user',
        },
      ],
      matchedAssistantNodes: [
        {
          role: 'assistant',
          messageId: 'response-20',
        },
      ],
    });
    expect(JSON.stringify(diagnostic)).not.toContain('Private');
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
      segmentIndex: [],
      scrollContainer: container,
    });

    expect(observation.position).toMatchObject({
      status: 'located',
      matchedBlocks: [
        {
          blockId: 'response-1',
          promptIndex: 2,
          source: 'response-id',
        },
      ],
    });
    expect(observation.anchors).toMatchObject([
      {
        promptId: 'prompt-2',
        promptIndex: 2,
        scrollTop: 1_250,
      },
    ]);
  });

  it('ignores offscreen Assistant DOM and out-of-range ownership', async () => {
    document.body.innerHTML = `
      <main>
        <div id="chat-scroll" style="overflow-y: auto">
          <div data-message-author-role="assistant" data-message-id="visible">
            <div class="markdown">Visible answer</div>
          </div>
          <div data-message-author-role="assistant" data-message-id="offscreen">
            <div class="markdown">Offscreen answer</div>
          </div>
          <div data-message-author-role="assistant" data-message-id="invalid">
            <div class="markdown">Invalid answer</div>
          </div>
        </div>
      </main>
    `;
    const container = document.getElementById('chat-scroll')!;
    const visible = document.querySelector<HTMLElement>(
      '[data-message-id="visible"]'
    )!;
    const offscreen = document.querySelector<HTMLElement>(
      '[data-message-id="offscreen"]'
    )!;
    const invalid = document.querySelector<HTMLElement>(
      '[data-message-id="invalid"]'
    )!;
    setElementMeasurements(container, {
      scrollHeight: 5_000,
      clientWidth: 900,
      clientHeight: 500,
      top: 100,
    });
    setElementMeasurements(visible, { clientHeight: 100, top: 200 });
    setElementMeasurements(offscreen, {
      clientHeight: 100,
      top: 2_000,
    });
    setElementMeasurements(invalid, { clientHeight: 100, top: 350 });
    const fingerprintIndex: NavigationFingerprintIndex = [
      {
        responseId: 'visible',
        promptIndex: 0,
        quality: 'observed',
        fingerprints: [],
      },
      {
        responseId: 'offscreen',
        promptIndex: 1,
        quality: 'observed',
        fingerprints: [],
      },
      {
        responseId: 'invalid',
        promptIndex: 5,
        quality: 'observed',
        fingerprints: [],
      },
    ];

    const observation = await observeChatGptVirtualPosition({
      conversationKey: 'conversation-1',
      prompts: [{ id: 'prompt-0' }, { id: 'prompt-1' }],
      fingerprintIndex,
      segmentIndex: [],
      scrollContainer: container,
    });

    expect(observation.position).toMatchObject({
      status: 'located',
      matchedPromptIndexes: [0],
      matchedBlocks: [
        {
          blockId: 'visible',
          promptIndex: 0,
          source: 'response-id',
        },
      ],
    });
    expect(observation.anchors).toHaveLength(1);
  });

  it('returns no observation when the scroll container is unavailable', async () => {
    const observation = await observeChatGptVirtualPosition({
      conversationKey: 'conversation-1',
      prompts: [],
      fingerprintIndex: [],
      segmentIndex: [],
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
