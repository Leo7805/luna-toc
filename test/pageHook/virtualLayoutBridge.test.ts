/** @vitest-environment jsdom */
/**
 * Tests the MAIN-world virtual layout bridge listener, Fiber traversal, validator,
 * and target resolution for ChatGPT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMainWorldVirtualLayout,
  handleVirtualLayoutRequest,
  installVirtualLayoutBridge,
  isValidVirtualLayout,
  maybeInstallVirtualLayoutBridge,
  resolveVirtualJumpTarget,
} from '@/pageHook/virtualLayoutBridge';
import { CHATGPT_BRIDGE_PROTOCOL } from '@/platforms/chatgpt/virtualLayoutBridgeProtocol';

function createValidLayout() {
  return {
    turnKeys: ['msg-1', 'msg-2', 'msg-3'],
    turnIndexByKey: new Map([
      ['msg-1', 0],
      ['msg-2', 1],
      ['msg-3', 2],
    ]),
    topOffsetsPx: [0, 250, 600],
    heightsPx: [200, 300, 450],
    totalHeightPx: 1200,
  };
}

describe('MAIN-world production isValidVirtualLayout', () => {
  it('accepts a valid layout structure', () => {
    expect(isValidVirtualLayout(createValidLayout())).toBe(true);
  });

  it('rejects null, primitives, or non-object candidates', () => {
    expect(isValidVirtualLayout(null)).toBe(false);
    expect(isValidVirtualLayout(undefined)).toBe(false);
    expect(isValidVirtualLayout(123)).toBe(false);
    expect(isValidVirtualLayout('string')).toBe(false);
    expect(isValidVirtualLayout({})).toBe(false);
  });

  it('rejects empty or non-array turnKeys', () => {
    const layout = createValidLayout();
    expect(isValidVirtualLayout({ ...layout, turnKeys: [] })).toBe(false);
    expect(isValidVirtualLayout({ ...layout, turnKeys: 'not-array' as any })).toBe(false);
  });

  it('rejects non-string or empty turnKey entries', () => {
    const layout = createValidLayout();
    expect(
      isValidVirtualLayout({
        ...layout,
        turnKeys: ['msg-1', '', 'msg-3'],
      })
    ).toBe(false);
    expect(
      isValidVirtualLayout({
        ...layout,
        turnKeys: ['msg-1', 123 as any, 'msg-3'],
      })
    ).toBe(false);
  });

  it('rejects invalid or non-Map turnIndexByKey', () => {
    const layout = createValidLayout();
    expect(isValidVirtualLayout({ ...layout, turnIndexByKey: null as any })).toBe(false);
    expect(isValidVirtualLayout({ ...layout, turnIndexByKey: {} as any })).toBe(false);
  });

  it('rejects size mismatch between turnKeys and turnIndexByKey', () => {
    const layout = createValidLayout();
    const wrongMap = new Map([['msg-1', 0]]);
    expect(isValidVirtualLayout({ ...layout, turnIndexByKey: wrongMap })).toBe(false);
  });

  it('rejects bijection mismatch where turnIndexByKey.get(key) !== i', () => {
    const layout = createValidLayout();
    const wrongMap = new Map([
      ['msg-1', 1],
      ['msg-2', 0],
      ['msg-3', 2],
    ]);
    expect(isValidVirtualLayout({ ...layout, turnIndexByKey: wrongMap })).toBe(false);
  });

  it('rejects array length mismatch in topOffsetsPx or heightsPx', () => {
    const layout = createValidLayout();
    expect(isValidVirtualLayout({ ...layout, topOffsetsPx: [0, 250] })).toBe(false);
    expect(isValidVirtualLayout({ ...layout, heightsPx: [200] })).toBe(false);
  });

  it('rejects negative, non-finite, or non-monotonic topOffsetsPx', () => {
    const layout = createValidLayout();
    // Negative
    expect(
      isValidVirtualLayout({ ...layout, topOffsetsPx: [-10, 250, 600] })
    ).toBe(false);
    // Non-finite
    expect(
      isValidVirtualLayout({ ...layout, topOffsetsPx: [0, NaN, 600] })
    ).toBe(false);
    expect(
      isValidVirtualLayout({ ...layout, topOffsetsPx: [0, Infinity, 600] })
    ).toBe(false);
    // Non-monotonic
    expect(
      isValidVirtualLayout({ ...layout, topOffsetsPx: [0, 500, 200] })
    ).toBe(false);
  });

  it('rejects negative or non-finite heightsPx', () => {
    const layout = createValidLayout();
    expect(
      isValidVirtualLayout({ ...layout, heightsPx: [200, -10, 450] })
    ).toBe(false);
    expect(
      isValidVirtualLayout({ ...layout, heightsPx: [200, NaN, 450] })
    ).toBe(false);
  });

  it('rejects invalid totalHeightPx or totalHeightPx < lastTop', () => {
    const layout = createValidLayout();
    expect(isValidVirtualLayout({ ...layout, totalHeightPx: -1 })).toBe(false);
    expect(isValidVirtualLayout({ ...layout, totalHeightPx: NaN })).toBe(false);
    // last top is 600, totalHeight is 500
    expect(isValidVirtualLayout({ ...layout, totalHeightPx: 500 })).toBe(false);
  });
});

describe('MAIN-world resolveVirtualJumpTarget', () => {
  const layout = createValidLayout();

  it('resolves messageId found to status ok with targetIndex, topOffsetPx, and turnCount', () => {
    const res = resolveVirtualJumpTarget(layout, 'msg-2', 'req-1');
    expect(res).toEqual({
      requestId: 'req-1',
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 250,
      turnCount: 3,
    });
  });

  it('returns target-not-in-layout when messageId is absent', () => {
    const res = resolveVirtualJumpTarget(layout, 'msg-absent', 'req-2');
    expect(res).toEqual({
      requestId: 'req-2',
      status: 'target-not-in-layout',
      turnCount: 3,
    });
  });

  it('returns target-not-in-layout if targetIndex is negative or non-integer', () => {
    const corruptedMap = new Map([
      ['msg-neg', -1],
      ['msg-float', 1.5],
    ]);
    const corruptedLayout = {
      ...layout,
      turnIndexByKey: corruptedMap,
    };
    expect(resolveVirtualJumpTarget(corruptedLayout as any, 'msg-neg', 'req-3')).toEqual({
      requestId: 'req-3',
      status: 'target-not-in-layout',
      turnCount: 3,
    });
    expect(resolveVirtualJumpTarget(corruptedLayout as any, 'msg-float', 'req-4')).toEqual({
      requestId: 'req-4',
      status: 'target-not-in-layout',
      turnCount: 3,
    });
  });

  it('returns target-not-in-layout if targetIndex >= turnKeys.length', () => {
    const corruptedMap = new Map([['msg-oob', 10]]);
    const corruptedLayout = {
      ...layout,
      turnIndexByKey: corruptedMap,
    };
    expect(resolveVirtualJumpTarget(corruptedLayout as any, 'msg-oob', 'req-5')).toEqual({
      requestId: 'req-5',
      status: 'target-not-in-layout',
      turnCount: 3,
    });
  });

  it('returns unavailable if resolved topOffsetPx is invalid', () => {
    const corruptedLayout = {
      ...layout,
      topOffsetsPx: [0, NaN, 600],
    };
    expect(resolveVirtualJumpTarget(corruptedLayout, 'msg-2', 'req-6')).toEqual({
      requestId: 'req-6',
      status: 'unavailable',
      reason: 'invalid-offset',
    });
  });
});

describe('MAIN-world findMainWorldVirtualLayout', () => {
  it('returns null if anchor has no React Fiber key', () => {
    const el = document.createElement('div');
    expect(findMainWorldVirtualLayout(el)).toBeNull();
  });

  it('discovers valid layout at direct hook.memoizedState', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    (el as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: layout,
        next: null,
      },
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });

  it('discovers valid layout via state.current ref wrapper', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    (el as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: {
          current: layout,
        },
        next: null,
      },
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });

  it('discovers valid layout via tuple array element', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    (el as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: ['ignored', layout],
        next: null,
      },
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });

  it('discovers layout on fiber.alternate', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    (el as any)['__reactFiber$test'] = {
      memoizedState: null,
      alternate: {
        memoizedState: {
          memoizedState: { current: layout },
          next: null,
        },
      },
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });

  it('discovers layout at ancestor hop 28', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    const targetFiber = {
      memoizedState: {
        memoizedState: { current: layout },
        next: null,
      },
      return: null,
    };

    let current: any = targetFiber;
    for (let i = 0; i < 27; i++) {
      const child = { memoizedState: null, return: current };
      current = child;
    }

    (el as any)['__reactFiber$test'] = current;
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });

  it('rejects layout beyond MAX_ANCESTOR_HOPS (40)', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    const targetFiber = {
      memoizedState: {
        memoizedState: { current: layout },
        next: null,
      },
      return: null,
    };

    let current: any = targetFiber;
    for (let i = 0; i < 45; i++) {
      const child = { memoizedState: null, return: current };
      current = child;
    }

    (el as any)['__reactFiber$test'] = current;
    expect(findMainWorldVirtualLayout(el)).toBeNull();
  });

  it('enforces MAX_HOOKS_PER_FIBER (100) limit', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();

    // Create a chain of 105 empty hooks before the layout hook
    let head: any = { memoizedState: null, next: null };
    let curr = head;
    for (let i = 0; i < 105; i++) {
      const nextHook = { memoizedState: null, next: null };
      curr.next = nextHook;
      curr = nextHook;
    }
    curr.next = { memoizedState: { current: layout }, next: null };

    (el as any)['__reactFiber$test'] = {
      memoizedState: head,
      return: null,
    };

    expect(findMainWorldVirtualLayout(el)).toBeNull();
  });

  it('handles circular fiber.return references safely without infinite loop', () => {
    const el = document.createElement('div');
    const fiber: any = {
      memoizedState: null,
      return: null,
    };
    fiber.return = fiber; // Cycle

    (el as any)['__reactFiber$test'] = fiber;
    expect(findMainWorldVirtualLayout(el)).toBeNull();
  });

  it('handles circular hook.next references safely without infinite loop', () => {
    const el = document.createElement('div');
    const hook: any = {
      memoizedState: null,
      next: null,
    };
    hook.next = hook; // Cycle

    (el as any)['__reactFiber$test'] = {
      memoizedState: hook,
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toBeNull();
  });

  it('supports __reactInternalInstance$ key prefix as fallback', () => {
    const el = document.createElement('div');
    const layout = createValidLayout();
    (el as any)['__reactInternalInstance$test'] = {
      memoizedState: {
        memoizedState: layout,
        next: null,
      },
      return: null,
    };
    expect(findMainWorldVirtualLayout(el)).toEqual(layout);
  });
});

describe('MAIN-world production handleVirtualLayoutRequest & installVirtualLayoutBridge', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installVirtualLayoutBridge();
  });

  afterEach(() => {
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
  });

  it('ignores event if target is not a .thread-scroll-container', () => {
    const container = document.createElement('div');
    container.className = 'other-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-1', messageId: 'msg-1' }),
      })
    );

    expect(responseSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it('ignores event if detail is not a string', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: { requestId: 'req-1', messageId: 'msg-1' } as any,
      })
    );

    expect(responseSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it('ignores event if detail is malformed JSON', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    expect(() => {
      container.dispatchEvent(
        new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
          bubbles: true,
          detail: 'not-valid-json{',
        })
      );
    }).not.toThrow();

    expect(responseSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it('ignores event if requestId or messageId is missing or empty', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    // Missing requestId
    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ messageId: 'msg-1' }),
      })
    );
    // Empty requestId
    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: '', messageId: 'msg-1' }),
      })
    );
    // Missing messageId
    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-1' }),
      })
    );
    // Empty messageId
    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-1', messageId: '' }),
      })
    );

    expect(responseSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it('dispatches status unavailable with anchor-unavailable when container has no message anchor', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    let receivedResponse: any = null;
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      (e: Event) => {
        receivedResponse = JSON.parse((e as CustomEvent).detail);
      }
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-no-anchor', messageId: 'msg-1' }),
      })
    );

    expect(receivedResponse).toEqual({
      requestId: 'req-no-anchor',
      status: 'unavailable',
      reason: 'anchor-unavailable',
    });
    container.remove();
  });

  it('dispatches status unavailable with layout-unavailable when anchor has no valid layout', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const anchor = document.createElement('div');
    anchor.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    container.appendChild(anchor);

    let receivedResponse: any = null;
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      (e: Event) => {
        receivedResponse = JSON.parse((e as CustomEvent).detail);
      }
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-no-layout', messageId: 'msg-1' }),
      })
    );

    expect(receivedResponse).toEqual({
      requestId: 'req-no-layout',
      status: 'unavailable',
      reason: 'layout-unavailable',
    });
    container.remove();
  });

  it('dispatches status ok with targetIndex, topOffsetPx, and turnCount when target message is present', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const anchor = document.createElement('div');
    anchor.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    const layout = createValidLayout();
    (anchor as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: { current: layout },
        next: null,
      },
      return: null,
    };
    container.appendChild(anchor);

    let receivedResponse: any = null;
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      (e: Event) => {
        receivedResponse = JSON.parse((e as CustomEvent).detail);
      }
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-ok', messageId: 'msg-2' }),
      })
    );

    expect(receivedResponse).toEqual({
      requestId: 'req-ok',
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: 250,
      turnCount: 3,
    });
    container.remove();
  });

  it('dispatches status target-not-in-layout when target message is absent from layout', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const anchor = document.createElement('div');
    anchor.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    const layout = createValidLayout();
    (anchor as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: { current: layout },
        next: null,
      },
      return: null,
    };
    container.appendChild(anchor);

    let receivedResponse: any = null;
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      (e: Event) => {
        receivedResponse = JSON.parse((e as CustomEvent).detail);
      }
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-absent', messageId: 'msg-missing' }),
      })
    );

    expect(receivedResponse).toEqual({
      requestId: 'req-absent',
      status: 'target-not-in-layout',
      turnCount: 3,
    });
    container.remove();
  });

  it('sanitizes response strictly without leaking Fiber, Map, DOM or hook objects', () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const anchor = document.createElement('div');
    anchor.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
    const layout = createValidLayout();
    (anchor as any)['__reactFiber$test'] = {
      memoizedState: {
        memoizedState: { current: layout },
        next: null,
      },
      return: null,
    };
    container.appendChild(anchor);

    let rawDetail = '';
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      (e: Event) => {
        rawDetail = (e as CustomEvent).detail;
      }
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-sanitize', messageId: 'msg-3' }),
      })
    );

    const parsed = JSON.parse(rawDetail);
    const keys = Object.keys(parsed);
    expect(keys.sort()).toEqual(
      ['requestId', 'status', 'targetIndex', 'topOffsetPx', 'turnCount'].sort()
    );
    expect(typeof parsed.requestId).toBe('string');
    expect(typeof parsed.status).toBe('string');
    expect(typeof parsed.targetIndex).toBe('number');
    expect(typeof parsed.topOffsetPx).toBe('number');
    expect(typeof parsed.turnCount).toBe('number');
    container.remove();
  });
});

describe('maybeInstallVirtualLayoutBridge (platform gating)', () => {
  it('installs bridge on chatgpt and returns cleanup function', () => {
    const cleanup = maybeInstallVirtualLayoutBridge('chatgpt');
    expect(cleanup).toBeTypeOf('function');

    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-gate', messageId: 'msg-1' }),
      })
    );

    expect(responseSpy).toHaveBeenCalledOnce();

    cleanup!();
    container.remove();
  });

  it('does NOT install bridge on copilot and returns null', () => {
    const cleanup = maybeInstallVirtualLayoutBridge('copilot');
    expect(cleanup).toBeNull();

    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);

    const responseSpy = vi.fn();
    container.addEventListener(
      CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_RESPONSE,
      responseSpy
    );

    container.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.QUERY_REQUEST, {
        bubbles: true,
        detail: JSON.stringify({ requestId: 'req-copilot', messageId: 'msg-1' }),
      })
    );

    expect(responseSpy).not.toHaveBeenCalled();
    container.remove();
  });
});
