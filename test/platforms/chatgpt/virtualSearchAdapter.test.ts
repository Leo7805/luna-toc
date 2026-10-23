/** @vitest-environment jsdom */
/** Tests ChatGPT DOM adaptation for prompt navigation and scroll container resolution. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  findRenderedChatGptPrompt,
  findRenderedChatGptPromptByText,
  getChatGptMessageId,
  getChatGptPromptUnitKey,
  getChatGptScrollContainer,
  getChatGptThreadScrollContainer,
  readMountedWithSidebarIdx,
} from '@/platforms/chatgpt/virtualSearchAdapter';

function setScrollDimensions(
  element: HTMLElement,
  scrollHeight: number,
  clientHeight: number
): void {
  Object.defineProperty(element, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ChatGPT virtual search adapter', () => {
  it('finds the scrollable ancestor of a mounted message', () => {
    document.body.innerHTML = `
      <main>
        <div id="chat-scroll" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="prompt-1:user">Prompt</div>
        </div>
      </main>
    `;
    const container = document.getElementById('chat-scroll')!;
    setScrollDimensions(container, 1000, 500);

    expect(getChatGptScrollContainer()?.id).toBe('chat-scroll');
  });

  it('rejects unscrollable candidates where scrollHeight equals clientHeight', () => {
    document.body.innerHTML = `
      <div id="not-scrollable" style="overflow-y: auto">
        <div data-chatgpt-search-unit-key="prompt-1:user">Prompt</div>
      </div>
    `;
    const container = document.getElementById('not-scrollable')!;
    setScrollDimensions(container, 500, 500);

    expect(getChatGptScrollContainer()).toBeNull();
  });

  it('finds rendered prompts with direct or ancestor message IDs', () => {
    document.body.innerHTML = `
      <div
        data-chatgpt-search-unit-key="prompt-1:user"
        data-chatgpt-search-message-ids="prompt-1"
        data-message-author-role="user"
        data-message-id="prompt-1"
      >
        First prompt
      </div>
      <section
        data-chatgpt-search-message-ids="prompt-2"
        data-message-id="prompt-2"
      >
        <div
          data-chatgpt-search-unit-key="prompt-2:user"
          data-message-author-role="user"
        >Second prompt</div>
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

  it('matches whole normalized text and rejects misleading prefixes', () => {
    document.body.innerHTML = `
      <div
        data-chatgpt-search-unit-key="prompt-1:user"
        data-chatgpt-search-message-ids="prompt-1"
        data-message-id="prompt-1"
      >
        How does quantum computing work?
      </div>
      <div
        data-chatgpt-search-unit-key="prompt-2:user"
        data-chatgpt-search-message-ids="prompt-2"
        data-message-id="prompt-2"
      >
        Can you write a poem about autumn?
      </div>
    `;

    expect(
      findRenderedChatGptPromptByText('How does quantum computing work?')?.getAttribute(
        'data-message-id'
      )
    ).toBe('prompt-1');
    expect(
      findRenderedChatGptPromptByText('  CAN  you write  a poem about autumn? ')?.getAttribute(
        'data-message-id'
      )
    ).toBe('prompt-2');
    expect(findRenderedChatGptPromptByText('How does quantum')).toBeNull();
    expect(findRenderedChatGptPromptByText('Non-existent text')).toBeNull();
    expect(findRenderedChatGptPromptByText('')).toBeNull();
    expect(findRenderedChatGptPromptByText('   ')).toBeNull();
  });

  it('resolves direct thread-scroll-container for both thread and generic resolvers', () => {
    document.body.innerHTML = `
      <div id="thread-feed" class="thread-scroll-container" style="overflow-y: auto">
        <div data-chatgpt-search-unit-key="prompt-1:user">Active conversation</div>
      </div>
    `;

    expect(getChatGptThreadScrollContainer()?.id).toBe('thread-feed');
    expect(getChatGptScrollContainer()?.id).toBe('thread-feed');
  });

  it('selects the thread-scroll-container containing active messages when multiple exist during SPA transitions', () => {
    document.body.innerHTML = `
      <div id="old-stale-thread" class="thread-scroll-container" style="overflow-y: auto">
        <div data-chatgpt-search-unit-key="old-prompt:user">Stale conversation</div>
      </div>
      <div id="active-thread" class="thread-scroll-container" style="overflow-y: auto">
        <div data-chatgpt-search-unit-key="new-prompt:user">Current conversation</div>
      </div>
    `;

    // When searching for the container owning new-prompt:user
    const activeSample = document.querySelector(
      '[data-chatgpt-search-unit-key="new-prompt:user"]'
    )!;
    expect(activeSample).not.toBeNull();
    // Default document query prefers the one containing the sample message
    expect(getChatGptThreadScrollContainer()?.id).toBe('active-thread');
    expect(getChatGptScrollContainer()?.id).toBe('active-thread');
  });

  it('prefers visible thread-scroll-container over zero-height stale containers', () => {
    document.body.innerHTML = `
      <div id="hidden-stale-thread" class="thread-scroll-container" style="overflow-y: auto">
        <div>Old prompt</div>
      </div>
      <div id="visible-thread" class="thread-scroll-container" style="overflow-y: auto">
        <div>New prompt</div>
      </div>
    `;
    const hidden = document.getElementById('hidden-stale-thread')!;
    const visible = document.getElementById('visible-thread')!;
    setScrollDimensions(hidden, 500, 0);
    setScrollDimensions(visible, 1000, 500);

    expect(getChatGptThreadScrollContainer()?.id).toBe('visible-thread');
    expect(getChatGptScrollContainer()?.id).toBe('visible-thread');
  });

  it('falls back to generic scroll container when no thread-scroll-container exists', () => {
    document.body.innerHTML = `
      <main>
        <div id="general-scroll" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="prompt-1:user">Content</div>
        </div>
      </main>
    `;
    const container = document.getElementById('general-scroll')!;
    setScrollDimensions(container, 1500, 700);

    expect(getChatGptThreadScrollContainer()?.id).toBe('general-scroll');

    document.body.innerHTML = '<div>No thread container</div>';
    expect(getChatGptThreadScrollContainer()).toBeNull();
  });

  it('reads mounted user bubbles paired with their sidebar indices', () => {
    document.body.innerHTML = `
      <div
        data-chatgpt-search-unit-key="msg-1:user"
        data-chatgpt-search-message-ids="prompt-a"
      >
        Alpha
      </div>
      <div
        data-chatgpt-search-unit-key="msg-2:user"
        data-chatgpt-search-message-ids="prompt-b"
      >
        Beta
      </div>
      <div
        data-chatgpt-search-unit-key="msg-3:user"
        data-chatgpt-search-message-ids="prompt-unrelated"
      >
        Unrelated
      </div>
      <div
        data-chatgpt-search-unit-key="msg-4:user"
      >
        Missing ID
      </div>
    `;

    const prompts = [
      { id: 'prompt-a' },
      { id: 'prompt-x' },
      { id: 'prompt-b' },
    ];

    const mounted = readMountedWithSidebarIdx(prompts);
    expect(mounted).toHaveLength(2);
    expect(mounted[0]).toEqual({
      element: expect.any(HTMLElement),
      sidebarIdx: 0,
      unitKey: 'msg-1:user',
    });
    expect(mounted[1]).toEqual({
      element: expect.any(HTMLElement),
      sidebarIdx: 2,
      unitKey: 'msg-2:user',
    });
  });

  it('resolves message id from element or closest ancestor', () => {
    document.body.innerHTML = `
      <div id="direct" data-chatgpt-search-message-ids="msg-direct"></div>
      <section data-chatgpt-search-message-ids="msg-ancestor">
        <div id="descendant">Child content</div>
      </section>
      <div id="none">No id</div>
    `;

    const directEl = document.getElementById('direct')!;
    const descendantEl = document.getElementById('descendant')!;
    const noneEl = document.getElementById('none')!;

    expect(getChatGptMessageId(directEl)).toBe('msg-direct');
    expect(getChatGptMessageId(descendantEl)).toBe('msg-ancestor');
    expect(getChatGptMessageId(noneEl)).toBeNull();
  });

  it('resolves prompt unit key from element attribute', () => {
    document.body.innerHTML = `
      <div id="unit" data-chatgpt-search-unit-key="msg-1:user"></div>
      <div id="no-unit"></div>
    `;

    const unitEl = document.getElementById('unit')!;
    const noUnitEl = document.getElementById('no-unit')!;

    expect(getChatGptPromptUnitKey(unitEl)).toBe('msg-1:user');
    expect(getChatGptPromptUnitKey(noUnitEl)).toBeNull();
  });
});
