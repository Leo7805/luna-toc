/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as detector from '@/features/contractAlert/detector';
import {
  startPageHookMismatchBridge,
  PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
} from '@/features/contractAlert/pageHookBridge';

describe('pageHookBridge contract alert validation', () => {
  let recordMismatchSpy: ReturnType<typeof vi.spyOn>;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    recordMismatchSpy = vi.spyOn(detector, 'recordMismatch').mockImplementation(() => {});
    cleanup = startPageHookMismatchBridge();
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('records mismatch for a valid same-window message with an existing contractId', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'api.conversation.path',
          expected: '/backend-api/conversation',
          actual: '/backend-api/conversation_v2',
        },
      })
    );

    expect(recordMismatchSpy).toHaveBeenCalledTimes(1);
    expect(recordMismatchSpy).toHaveBeenCalledWith(
      'api.conversation.path',
      '/backend-api/conversation',
      '/backend-api/conversation_v2'
    );
  });

  it('ignores messages originating from an actual foreign iframe window', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const foreignWindow = iframe.contentWindow;

    if (!foreignWindow) {
      throw new Error('JSDOM failed to create iframe contentWindow');
    }

    window.dispatchEvent(
      new MessageEvent('message', {
        source: foreignWindow,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'api.conversation.path',
          expected: '/backend-api/conversation',
          actual: '/backend-api/conversation_v2',
        },
      })
    );

    expect(recordMismatchSpy).not.toHaveBeenCalled();
    iframe.remove();
  });

  it('ignores messages with null or non-object payload structures', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: null,
      })
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: 'LUNA_CONTRACT_MISMATCH',
      })
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: 12345,
      })
    );

    expect(recordMismatchSpy).not.toHaveBeenCalled();
  });

  it('ignores messages with mismatched or missing message type', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: 'OTHER_TYPE',
          contractId: 'api.conversation.path',
        },
      })
    );

    expect(recordMismatchSpy).not.toHaveBeenCalled();
  });

  it('rejects inherited object prototype properties as contract IDs', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'toString',
        },
      })
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'hasOwnProperty',
        },
      })
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'constructor',
        },
      })
    );

    expect(recordMismatchSpy).not.toHaveBeenCalled();
  });

  it('unregisters message listener on cleanup', () => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
          contractId: 'api.conversation.path',
        },
      })
    );

    expect(recordMismatchSpy).not.toHaveBeenCalled();
  });
});
