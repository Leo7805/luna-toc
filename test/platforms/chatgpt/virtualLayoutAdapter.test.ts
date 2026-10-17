/** @vitest-environment jsdom */
/**
 * Tests ChatGPT React virtualizer layout ISOLATED synchronous facade.
 */
import { describe, expect, it, vi } from 'vitest';
import { queryChatGptVirtualJumpTarget } from '@/platforms/chatgpt/virtualLayoutAdapter';
import { CHATGPT_BRIDGE_PROTOCOL } from '@/platforms/chatgpt/virtualLayoutBridgeProtocol';

describe('queryChatGptVirtualJumpTarget', () => {
  it('returns invalid-context when container is disconnected or not an HTMLElement', () => {
    const disconnected = document.createElement('div');
    disconnected.className = 'thread-scroll-container';

    expect(queryChatGptVirtualJumpTarget(null as any, 'msg-1')).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });
    expect(queryChatGptVirtualJumpTarget({} as any, 'msg-1')).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });
    expect(queryChatGptVirtualJumpTarget(disconnected, 'msg-1')).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });
  });

  it('returns invalid-context when messageId is empty or not a string', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    expect(queryChatGptVirtualJumpTarget(container, '')).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });
    expect(queryChatGptVirtualJumpTarget(container, null as any)).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });
    expect(queryChatGptVirtualJumpTarget(container, 123 as any)).toEqual({
      status: 'unavailable',
      reason: 'invalid-context',
    });

    container.remove();
  });

  it('returns status ok with exact coordinates when valid matching response is received', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    let callbackRanBeforeDispatchReturned = false;

    const onMainRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const req = JSON.parse(detail);
      const target = e.target as HTMLElement;

      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 1,
            topOffsetPx: 250,
            turnCount: 3,
          }),
        })
      );
      callbackRanBeforeDispatchReturned = true;
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-2');

    expect(result).not.toBeInstanceOf(Promise);
    expect(callbackRanBeforeDispatchReturned).toBe(true);
    expect(result).toEqual({
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 250,
      turnCount: 3,
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('returns target-not-in-layout when matching target-not-in-layout response is received with valid turnCount', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const req = JSON.parse((e as CustomEvent).detail);
      (e.target as HTMLElement).dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'target-not-in-layout',
            turnCount: 50,
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    try {
      const result = queryChatGptVirtualJumpTarget(container, 'absent-msg');
      expect(result).toEqual({
        status: 'target-not-in-layout',
        turnCount: 50,
      });
    } finally {
      document.removeEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );
      container.remove();
    }
  });

  it('rejects invalid turnCount for target-not-in-layout (zero, negative, fractional, NaN, Infinity, missing, wrong type) with invalid-payload', () => {
    const invalidTurnCounts = [0, -5, 1.5, NaN, Infinity, undefined, '50', null, {}];

    for (const invalidValue of invalidTurnCounts) {
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      document.body.appendChild(container);

      const onMainRequest = (e: Event) => {
        const req = JSON.parse((e as CustomEvent).detail);
        (e.target as HTMLElement).dispatchEvent(
          new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
            bubbles: false,
            detail: JSON.stringify({
              requestId: req.requestId,
              status: 'target-not-in-layout',
              turnCount: invalidValue,
            }),
          })
        );
      };

      document.addEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );

      try {
        const result = queryChatGptVirtualJumpTarget(container, 'absent-msg');
        expect(result).toEqual({
          status: 'unavailable',
          reason: 'invalid-payload',
        });
      } finally {
        document.removeEventListener(
          CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
          onMainRequest,
          { capture: true }
        );
        container.remove();
      }
    }
  });

  it('returns unavailable with sanitized reason when matching unavailable response is received', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const req = JSON.parse((e as CustomEvent).detail);
      (e.target as HTMLElement).dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'unavailable',
            reason: 'anchor-unavailable',
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'anchor-unavailable',
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('sanitizes missing reason to host-unavailable on unavailable response', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const req = JSON.parse((e as CustomEvent).detail);
      (e.target as HTMLElement).dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'unavailable',
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'host-unavailable',
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('returns no-response when no listener responds synchronously', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    // No event listener added to document
    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'no-response',
    });

    container.remove();
  });

  it('ignores malformed JSON without poisoning and accepts subsequent matching response', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const target = e.target as HTMLElement;
      const req = JSON.parse((e as CustomEvent).detail);

      // First dispatch malformed JSON syntax
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: 'not-valid-json{',
        })
      );

      // Then dispatch valid matching response
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 0,
            topOffsetPx: 0,
            turnCount: 2,
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'ok',
      targetIndex: 0,
      topOffsetPx: 0,
      turnCount: 2,
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('ignores non-object JSON without poisoning and accepts subsequent matching response', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const target = e.target as HTMLElement;
      const req = JSON.parse((e as CustomEvent).detail);

      // Dispatch primitive JSON string
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify('just-a-string'),
        })
      );

      // Dispatch JSON array
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify([1, 2, 3]),
        })
      );

      // Dispatch valid matching response
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 1,
            topOffsetPx: 300,
            turnCount: 4,
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 300,
      turnCount: 4,
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('ignores mismatched requestId without poisoning and accepts subsequent matching response', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const target = e.target as HTMLElement;
      const req = JSON.parse((e as CustomEvent).detail);

      // Dispatch mismatched requestId
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: 'unrelated-id',
            status: 'ok',
            targetIndex: 99,
            topOffsetPx: 9999,
            turnCount: 100,
          }),
        })
      );

      // Dispatch matching response
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 1,
            topOffsetPx: 100,
            turnCount: 2,
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 100,
      turnCount: 2,
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('settles exactly once: earlier valid response cannot be overwritten by later response', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const onMainRequest = (e: Event) => {
      const target = e.target as HTMLElement;
      const req = JSON.parse((e as CustomEvent).detail);

      // Dispatch first valid matching response
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 1,
            topOffsetPx: 150,
            turnCount: 3,
          }),
        })
      );

      // Dispatch second matching response with different values
      target.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 2,
            topOffsetPx: 500,
            turnCount: 3,
          }),
        })
      );
    };

    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    // First response remains authoritative
    expect(result).toEqual({
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 150,
      turnCount: 3,
    });

    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    container.remove();
  });

  it('settles invalid-payload when matching response has missing or unknown status', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const sendCorruptedStatus = (payload: any) => {
      const onMainRequest = (e: Event) => {
        const req = JSON.parse((e as CustomEvent).detail);
        (e.target as HTMLElement).dispatchEvent(
          new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
            bubbles: false,
            detail: JSON.stringify({ ...payload, requestId: req.requestId }),
          })
        );
      };

      document.addEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );

      const res = queryChatGptVirtualJumpTarget(container, 'msg-1');

      document.removeEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );

      return res;
    };

    expect(sendCorruptedStatus({})).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    expect(sendCorruptedStatus({ status: 'unknown-status' })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });

    container.remove();
  });

  it('settles invalid-payload when matching ok response contains corrupted numeric values', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const testPayload = (badFields: any) => {
      const onMainRequest = (e: Event) => {
        const req = JSON.parse((e as CustomEvent).detail);
        (e.target as HTMLElement).dispatchEvent(
          new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
            bubbles: false,
            detail: JSON.stringify({
              requestId: req.requestId,
              status: 'ok',
              targetIndex: 1,
              topOffsetPx: 200,
              turnCount: 3,
              ...badFields,
            }),
          })
        );
      };

      document.addEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );

      const res = queryChatGptVirtualJumpTarget(container, 'msg-1');

      document.removeEventListener(
        CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
        onMainRequest,
        { capture: true }
      );

      return res;
    };

    // Negative targetIndex
    expect(testPayload({ targetIndex: -1 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Fractional targetIndex
    expect(testPayload({ targetIndex: 1.5 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // targetIndex >= turnCount
    expect(testPayload({ targetIndex: 3, turnCount: 3 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Zero turnCount
    expect(testPayload({ targetIndex: 0, turnCount: 0 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Negative turnCount
    expect(testPayload({ turnCount: -1 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Fractional turnCount
    expect(testPayload({ turnCount: 3.5 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Negative topOffsetPx
    expect(testPayload({ topOffsetPx: -100 })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // NaN topOffsetPx (JSON stringifies NaN as null)
    expect(testPayload({ topOffsetPx: null })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });
    // Infinity topOffsetPx (JSON stringifies Infinity as null)
    expect(testPayload({ topOffsetPx: 'not-number' })).toEqual({
      status: 'unavailable',
      reason: 'invalid-payload',
    });

    container.remove();
  });

  it('returns dispatch-failed if container.dispatchEvent throws', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    container.dispatchEvent = vi.fn(() => {
      throw new Error('Host event dispatch blocked');
    });

    const result = queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'dispatch-failed',
    });

    container.remove();
  });

  it('guarantees listener cleanup across all outcome paths', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const removeSpy = vi.spyOn(container, 'removeEventListener');

    // 1. After valid settle
    const onMainRequest = (e: Event) => {
      const req = JSON.parse((e as CustomEvent).detail);
      (e.target as HTMLElement).dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE, {
          bubbles: false,
          detail: JSON.stringify({
            requestId: req.requestId,
            status: 'ok',
            targetIndex: 0,
            topOffsetPx: 0,
            turnCount: 1,
          }),
        })
      );
    };
    document.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );
    queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(removeSpy).toHaveBeenCalledWith(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      expect.any(Function)
    );
    document.removeEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST,
      onMainRequest,
      { capture: true }
    );

    // 2. After no response
    removeSpy.mockClear();
    queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(removeSpy).toHaveBeenCalledWith(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      expect.any(Function)
    );

    // 3. After dispatch throw
    removeSpy.mockClear();
    container.dispatchEvent = vi.fn(() => {
      throw new Error('Dispatch error');
    });
    queryChatGptVirtualJumpTarget(container, 'msg-1');
    expect(removeSpy).toHaveBeenCalledWith(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      expect.any(Function)
    );

    removeSpy.mockRestore();
    container.remove();
  });
});
