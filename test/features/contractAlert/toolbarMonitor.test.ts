/** @vitest-environment jsdom */
/** Compatibility monitor regressions: route changes, recovery, and dismissed dialogs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startToolbarCompatibilityMonitor } from '@/features/contractAlert/toolbarMonitor';
import { dismissAllMismatches, recordMismatch } from '@/features/contractAlert/detector';
import {
  PAGE_HOOK_HEALTH_PONG,
  TOOLBAR_COMPATIBILITY_WARNING,
  TOOLBAR_COMPATIBILITY_HEALTHY,
} from '@/features/contractAlert/toolbarWarning';
import { PAGE_HOOK_RECOVERY_MESSAGE_TYPE } from '@/features/contractAlert/pageHookBridge';
import { CHATGPT_MESSAGE_TYPES } from '@/platforms/chatgpt/messages';

const sendMessage = vi.fn(async (_message: unknown) => {});
let stop: (() => void) | undefined;

function pageMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window, origin: location.origin, data,
  }));
}
function sentTypes(): unknown[] {
  return sendMessage.mock.calls.map(([message]) => (message as { type: unknown }).type);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  sendMessage.mockClear();
  history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  dismissAllMismatches();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  dismissAllMismatches();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toolbar compatibility monitor', () => {
  it('retains real warnings when the developer merely dismisses the dialog', () => {
    stop = startToolbarCompatibilityMonitor();
    recordMismatch('api.conversation.path', 'expected', 'actual');
    expect(sentTypes()).toContain(TOOLBAR_COMPATIBILITY_WARNING);
    const count = sendMessage.mock.calls.length;
    dismissAllMismatches();
    expect(sendMessage).toHaveBeenCalledTimes(count);
  });

  it('clears a warning on SPA route change, then re-arms detection', () => {
    stop = startToolbarCompatibilityMonitor();
    recordMismatch('api.conversation.path', 'expected', 'actual');
    history.replaceState({}, '', '/c/12345678');
    pageMessage({ type: CHATGPT_MESSAGE_TYPES.routeChanged });
    expect(sentTypes().at(-1)).toBe(TOOLBAR_COMPATIBILITY_HEALTHY);
    recordMismatch('api.conversation.path', 'expected', 'actual again');
    expect(sentTypes().at(-1)).toBe(TOOLBAR_COMPATIBILITY_WARNING);
  });

  it('releases a page-hook contract warning after positive API recovery', () => {
    stop = startToolbarCompatibilityMonitor();
    recordMismatch('api.conversation.path', 'expected', 'actual');
    pageMessage({
      type: PAGE_HOOK_RECOVERY_MESSAGE_TYPE,
      contractId: 'api.conversation.path',
    });
    expect(sentTypes().at(-1)).toBe(TOOLBAR_COMPATIBILITY_HEALTHY);
  });

  it('does not accept an unrelated page-hook recovery id', () => {
    stop = startToolbarCompatibilityMonitor();
    recordMismatch('api.conversation.path', 'expected', 'actual');
    const count = sendMessage.mock.calls.length;
    pageMessage({ type: PAGE_HOOK_RECOVERY_MESSAGE_TYPE, contractId: 'unknown.id' });
    expect(sendMessage).toHaveBeenCalledTimes(count);
  });

  it('recovers a missing DOM marker after two healthy rendered probes', () => {
    history.replaceState({}, '', '/c/12345678');
    document.body.innerHTML = '<main><article data-testid="conversation-turn-1"></article></main>';
    stop = startToolbarCompatibilityMonitor();
    pageMessage({ type: PAGE_HOOK_HEALTH_PONG });
    vi.advanceTimersByTime(6500);
    expect(sentTypes()).toContain(TOOLBAR_COMPATIBILITY_WARNING);
    document.querySelector('article')!.setAttribute('data-message-author-role', 'user');
    document.querySelector('article')!.setAttribute('data-message-id', 'message-1');
    vi.advanceTimersByTime(10000);
    expect(sentTypes().at(-1)).toBe(TOOLBAR_COMPATIBILITY_HEALTHY);
  });

  it('recovers a non-responsive page hook when the handshake resumes', () => {
    stop = startToolbarCompatibilityMonitor();
    vi.advanceTimersByTime(16500);
    expect(sentTypes()).toContain(TOOLBAR_COMPATIBILITY_WARNING);
    pageMessage({ type: PAGE_HOOK_HEALTH_PONG });
    expect(sentTypes().at(-1)).toBe(TOOLBAR_COMPATIBILITY_HEALTHY);
  });
});
