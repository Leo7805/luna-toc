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

  it('finds rendered prompts by text prefix match', () => {
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
      findRenderedChatGptPromptByText('How does quantum')?.getAttribute(
        'data-message-id'
      )
    ).toBe('prompt-1');
    expect(
      findRenderedChatGptPromptByText('  can  you  write  ')?.getAttribute(
        'data-message-id'
      )
    ).toBe('prompt-2');
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

  describe('scoped and unambiguous prompt lookup', () => {
    it('scopes ID and text lookups to the active thread-scroll-container when multiple exist', () => {
      document.body.innerHTML = `
        <div id="stale-thread" class="thread-scroll-container" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="p-stale:user" data-chatgpt-search-message-ids="shared-id">
            Unique stale text
          </div>
        </div>
        <div id="active-thread" class="thread-scroll-container" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="p-active:user" data-chatgpt-search-message-ids="active-id">
            Active conversation prompt
          </div>
        </div>
      `;
      const stale = document.getElementById('stale-thread')!;
      const active = document.getElementById('active-thread')!;
      setScrollDimensions(stale, 500, 0);
      setScrollDimensions(active, 1000, 600);

      // Must ignore element inside stale/hidden conversation container
      expect(findRenderedChatGptPrompt('shared-id')).toBeNull();
      expect(findRenderedChatGptPromptByText('Unique stale text')).toBeNull();

      // Must find element inside active container
      expect(findRenderedChatGptPrompt('active-id')?.textContent).toContain(
        'Active conversation prompt'
      );
      expect(
        findRenderedChatGptPromptByText('Active conversation')?.getAttribute(
          'data-chatgpt-search-message-ids'
        )
      ).toBe('active-id');
    });

    it('rejects hidden, aria-hidden, display:none, and disconnected prompt elements', () => {
      document.body.innerHTML = `
        <div class="thread-scroll-container" style="overflow-y: auto">
          <div hidden data-chatgpt-search-unit-key="h1:user" data-chatgpt-search-message-ids="id-hidden">
            Hidden prompt
          </div>
          <div aria-hidden="true" data-chatgpt-search-unit-key="h2:user" data-chatgpt-search-message-ids="id-aria-hidden">
            Aria hidden prompt
          </div>
          <div style="display: none" data-chatgpt-search-unit-key="h3:user" data-chatgpt-search-message-ids="id-display-none">
            Display none prompt
          </div>
          <div data-chatgpt-search-unit-key="v1:user" data-chatgpt-search-message-ids="id-visible">
            Visible prompt
          </div>
        </div>
      `;
      const container = document.querySelector<HTMLElement>('.thread-scroll-container')!;
      setScrollDimensions(container, 1000, 600);

      expect(findRenderedChatGptPrompt('id-hidden')).toBeNull();
      expect(findRenderedChatGptPrompt('id-aria-hidden')).toBeNull();
      expect(findRenderedChatGptPrompt('id-display-none')).toBeNull();
      expect(findRenderedChatGptPromptByText('Hidden prompt')).toBeNull();
      expect(findRenderedChatGptPromptByText('Aria hidden prompt')).toBeNull();
      expect(findRenderedChatGptPromptByText('Display none prompt')).toBeNull();
      expect(findRenderedChatGptPrompt('id-visible')?.textContent).toContain('Visible prompt');

      const disconnected = document.createElement('div');
      disconnected.setAttribute('data-chatgpt-search-unit-key', 'd1:user');
      disconnected.setAttribute('data-chatgpt-search-message-ids', 'id-disconnected');
      expect(findRenderedChatGptPrompt('id-disconnected', disconnected)).toBeNull();
    });

    it('matches exact ID including comma-separated multi-ID attributes', () => {
      document.body.innerHTML = `
        <div class="thread-scroll-container" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="u1:user" data-chatgpt-search-message-ids="id-a,id-b">
            Combined prompt
          </div>
        </div>
      `;
      const container = document.querySelector<HTMLElement>('.thread-scroll-container')!;
      setScrollDimensions(container, 1000, 600);

      expect(findRenderedChatGptPrompt('id-a')?.textContent).toContain('Combined prompt');
      expect(findRenderedChatGptPrompt('id-b')?.textContent).toContain('Combined prompt');
      expect(findRenderedChatGptPrompt('id-c')).toBeNull();
    });

    it('returns null for ambiguous duplicate text-prefix prompts and succeeds only on unique match', () => {
      document.body.innerHTML = `
        <div class="thread-scroll-container" style="overflow-y: auto">
          <div data-chatgpt-search-unit-key="u1:user" data-chatgpt-search-message-ids="p-1">
            Explain how React fibers work
          </div>
          <div data-chatgpt-search-unit-key="u2:user" data-chatgpt-search-message-ids="p-2">
            Explain how browser compositing works
          </div>
          <div data-chatgpt-search-unit-key="u3:user" data-chatgpt-search-message-ids="p-3">
            Summarize the TypeScript config
          </div>
        </div>
      `;
      const container = document.querySelector<HTMLElement>('.thread-scroll-container')!;
      setScrollDimensions(container, 1000, 600);

      // Ambiguous prefix matching both p-1 and p-2 -> must return null
      expect(findRenderedChatGptPromptByText('Explain how')).toBeNull();

      // Unambiguous prefix matching only p-2 -> returns p-2
      expect(
        findRenderedChatGptPromptByText('Explain how browser')?.getAttribute(
          'data-chatgpt-search-message-ids'
        )
      ).toBe('p-2');

      // Unique match -> returns p-3
      expect(
        findRenderedChatGptPromptByText('Summarize the')?.getAttribute(
          'data-chatgpt-search-message-ids'
        )
      ).toBe('p-3');
    });
  });
});
