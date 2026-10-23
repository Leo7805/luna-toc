/** Pure regression tests for the conservative toolbar warning conditions. */
import { describe, expect, it } from 'vitest';
import { canInspectChatGptDom, missingChatGptDomMarkers } from '@/features/contractAlert/healthSignals';
import { parseToolbarWarning, toolbarWarningKey } from '@/features/contractAlert/toolbarWarning';

describe('toolbar compatibility fallback', () => {
  it('ignores new chats and conversations without rendered turns', () => {
    expect(missingChatGptDomMarkers('/', true, false, false)).toEqual([]);
    expect(missingChatGptDomMarkers('/c/12345678', false, false, false)).toEqual([]);
  });

  it('only treats rendered conversation turns as recovery evidence', () => {
    expect(canInspectChatGptDom('/', true)).toBe(false);
    expect(canInspectChatGptDom('/c/12345678', false)).toBe(false);
    expect(canInspectChatGptDom('/g/p-abc/c/12345678', true)).toBe(true);
  });

  it('identifies missing selectors on standalone and project chat routes', () => {
    expect(missingChatGptDomMarkers('/c/12345678', true, false, false)).toEqual([
      'dom.selector.user-message', 'dom.selector.message-id',
    ]);
    expect(missingChatGptDomMarkers('/g/p-abc/c/12345678', true, true, false)).toEqual([
      'dom.selector.message-id',
    ]);
  });

  it('keeps healthy rendered conversations silent', () => {
    expect(missingChatGptDomMarkers('/c/12345678', true, true, true)).toEqual([]);
  });

  it('isolates warnings by tab and rejects malformed storage records', () => {
    expect(toolbarWarningKey(3)).toBe('luna:compatibility:tab:3');
    expect(parseToolbarWarning({ detail: 'changed', observedAt: 123 })).toEqual({
      detail: 'changed', observedAt: 123,
    });
    expect(parseToolbarWarning({ detail: '', observedAt: 123 })).toBeNull();
    expect(parseToolbarWarning({ detail: 'changed', observedAt: 'no' })).toBeNull();
  });
});
