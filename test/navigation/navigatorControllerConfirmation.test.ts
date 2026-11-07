/** @vitest-environment jsdom */
/** Exercises late confirmed duplicates with a fresh, positively verified controller. */
import { expect, it, vi } from 'vitest';

it.each(['foreground', 'background'])('protects GET authority and callbacks in %s', async (mode) => {
  vi.resetModules();
  vi.useFakeTimers();
  const originalLocation = window.location;
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener]);
    add(type, listener, options);
  });
  const setPath = (id: string) => Object.defineProperty(window, 'location', {
    configurable: true, value: { host: 'chatgpt.com', origin: 'https://chatgpt.com', pathname: `/c/${id}` },
  });
  setPath('A');
  document.body.innerHTML = '<div id="navigator-list"></div><div class="navigator-hint"></div>';
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const { navigatorController: controller } = await import('@/navigation/navigatorController');
  const loading = await import('@/navigation/loading/promptLoadingState');
  const { getStatusSnapshot } = await import('@/navigation/ui/sidebarStatus');
  const { getActivePlatform } = await import('@/platforms');
  const types = getActivePlatform().pageHook.messages;
  const added = vi.fn();
  const countChanged = vi.fn();
  const send = (type: string, routeKey: string, payload: unknown) => window.dispatchEvent(
    new MessageEvent('message', { source: window, data: { type, routeKey, payload } })
  );
  const message = (id: string, time: number, role = 'user') => ({ id, author: { role }, content: { parts: [id] }, create_time: time });
  const changeRoute = (id: string) => { setPath(id); window.dispatchEvent(new PopStateEvent('popstate')); };
  const list = document.getElementById('navigator-list')!;
  const rows = () => Array.from(list.querySelectorAll('.navigator-item')).map((row) => row.textContent);
  try {
    controller.init({ onPromptAdded: added, onPromptCountChanged: countChanged });
    controller.attach();
    send(types.newUserMessage, 'A', message('2', 200));
    expect(added).toHaveBeenCalledExactlyOnceWith();
    send(types.conversationData, 'A', { messages: [
      message('1', 100), message('reply1', 150, 'assistant'), message('2', 200),
      { ...message('3', 300), content: { parts: ['Server text'] }, metadata: { attachments: [{ name: 'server.pdf' }] } },
    ] });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain('1');
    expect(rows()[1]).toContain('Server text');
    expect(rows()[1]).toContain('server.pdf');
    added.mockClear();
    if (mode === 'background') {
      changeRoute('B');
      send(types.conversationData, 'B', { messages: [message('B1', 100)] });
      loading.setBackfillInProgress(false);
      loading.setLoading(true);
      controller.render();
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toContain('B1');
    }
    const before = { html: list.innerHTML, status: getStatusSnapshot(), navigation: controller.getNavigationState(), display: controller.getDisplayIndex() };
    countChanged.mockClear();
    list.scrollTop = 27;
    const scroll = vi.fn();
    list.scrollTo = scroll;
    const observer = new MutationObserver(() => {});
    observer.observe(list, { childList: true, subtree: true, attributes: true, characterData: true });
    for (const id of ['2', '3']) {
      send(types.newUserMessage, 'A', { id, content: { parts: ['Old text'] }, createTime: 9999999990000 });
      expect(added).not.toHaveBeenCalled();
      if (mode === 'background') {
        expect(countChanged).not.toHaveBeenCalled();
        expect(loading.isLoading()).toBe(true);
        expect({ html: list.innerHTML, status: getStatusSnapshot(), navigation: controller.getNavigationState(), display: controller.getDisplayIndex() }).toEqual(before);
        expect(observer.takeRecords()).toEqual([]);
        expect(list.scrollTop).toBe(27);
        expect(scroll).not.toHaveBeenCalled();
      }
    }
    observer.disconnect();
    if (mode === 'background') changeRoute('A');
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toContain('Server text');
    expect(rows()[1]).toContain('server.pdf');
    send(types.conversationData, 'A', { messages: [message('1', 100)] });
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toContain('Server text');
    expect(rows()[1]).toContain('server.pdf');
    expect(added).not.toHaveBeenCalled();
  } finally {
    controller.detach();
    loading.clearSettleTimer();
    for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
