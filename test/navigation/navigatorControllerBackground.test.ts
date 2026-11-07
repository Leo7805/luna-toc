/** @vitest-environment jsdom */
/** Owns one fresh controller lifecycle so callback assertions cannot pass unwired. */
import { expect, it, vi } from 'vitest';

it('notifies foreground additions, isolates background UI, and restores A without a GET', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const originalLocation = window.location;
  const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
  const originalAdd = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener]);
    originalAdd(type, listener, options);
  });
  const setPath = (pathname: string) => Object.defineProperty(window, 'location', {
    configurable: true, value: { host: 'chatgpt.com', origin: 'https://chatgpt.com', pathname },
  });
  setPath('/g/g-project/c/A');
  document.body.innerHTML = '<div id="navigator-list"></div><div class="navigator-hint"></div>';
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const { navigatorController: controller } = await import('@/navigation/navigatorController');
  const loading = await import('@/navigation/loading/promptLoadingState');
  const { getStatusSnapshot } = await import('@/navigation/ui/sidebarStatus');
  const { getActivePlatform } = await import('@/platforms');
  const messages = getActivePlatform().pageHook.messages;
  const added = vi.fn();
  const countChanged = vi.fn();
  const send = (type: string, routeKey: string, payload: unknown) => window.dispatchEvent(
    new MessageEvent('message', { source: window, data: { type, routeKey, payload } })
  );
  const prompt = (id: string, create_time: number, role = 'user') => ({
    id, author: { role }, content: { parts: [id] }, create_time,
  });
  const list = document.getElementById('navigator-list')!;
  const rows = () => Array.from(list.querySelectorAll('.navigator-item')).map((row) => row.textContent);
  try {
    controller.init({ onPromptAdded: added, onPromptCountChanged: countChanged });
    controller.attach();
    expect(controller.getCurrentConversationKey()).toBe('A');
    send(messages.conversationData, 'A', { messages: [prompt('A1', 100), prompt('reply1', 150, 'assistant')] });
    send(messages.newUserMessage, 'A', prompt('A2', 200));
    send(messages.newUserMessage, 'A', prompt('A3', 300));
    expect(added).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(3);
    added.mockClear();
    setPath('/c/B');
    window.dispatchEvent(new PopStateEvent('popstate'));
    send(messages.conversationData, 'B', { messages: [prompt('B1', 100)] });
    loading.setBackfillInProgress(false);
    loading.setLoading(true);
    controller.render();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('B1');
    expect(loading.isLoading()).toBe(true);
    const before = { html: list.innerHTML, status: getStatusSnapshot(), display: controller.getDisplayIndex(), navigation: controller.getNavigationState() };
    list.scrollTop = 27;
    const observer = new MutationObserver(() => {});
    observer.observe(list, { subtree: true, childList: true, attributes: true, characterData: true });
    const scroll = vi.fn();
    list.scrollTo = scroll;
    countChanged.mockClear();
    for (const [id, time] of [['A3', 300], ['A5', 500], ['A4', 400], ['A4', 400]] as const) {
      send(messages.newUserMessage, 'A', prompt(id, time));
      expect(added).not.toHaveBeenCalled();
      expect(countChanged).not.toHaveBeenCalled();
      expect(loading.isLoading()).toBe(true);
      expect({ html: list.innerHTML, status: getStatusSnapshot(), display: controller.getDisplayIndex(), navigation: controller.getNavigationState() }).toEqual(before);
      expect(observer.takeRecords()).toEqual([]);
      expect(list.scrollTop).toBe(27);
      expect(scroll).not.toHaveBeenCalled();
    }
    observer.disconnect();
    setPath('/g/g-project/c/A');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(rows()).toHaveLength(5);
    for (let i = 1; i <= 5; i++) expect(rows()[i - 1]).toContain(`A${i}`);
    send(messages.conversationData, 'A', { messages: [prompt('A1', 100), prompt('reply1', 150, 'assistant')] });
    expect(rows()).toHaveLength(5);
  } finally {
    controller.detach();
    loading.clearSettleTimer();
    for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
