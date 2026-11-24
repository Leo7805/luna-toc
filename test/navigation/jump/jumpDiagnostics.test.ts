/** @vitest-environment jsdom */
/** Tests stateless navigation diagnostic helpers extracted into jumpDiagnostics.ts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  createJumpId: vi.fn(() => 'jump-diag-1'),
  logEvent: vi.fn(),
  debugStorageKey: undefined as string | undefined,
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    navigation: {
      getScrollContainer: mocks.getScrollContainer,
    },
    diagnostics: {
      createJumpId: mocks.createJumpId,
      logEvent: mocks.logEvent,
      get debugStorageKey() {
        return mocks.debugStorageKey;
      },
    },
  }),
}));

import {
  createNavigationJumpId,
  emitAlignmentMeasurement,
  isNavigationDebugEnabled,
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from '@/navigation/jump/jumpDiagnostics';

describe('jumpDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.debugStorageKey = undefined;
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards jump ID creation and event logging to active platform diagnostics', () => {
    expect(createNavigationJumpId()).toBe('jump-diag-1');
    expect(mocks.createJumpId).toHaveBeenCalledTimes(1);

    logNavigationEvent('jump-diag-1', 'JUMP_START', { targetPromptIndex: 3 });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'jump-diag-1',
      'JUMP_START',
      { targetPromptIndex: 3 },
      undefined
    );
  });

  it('evaluates debug flag using default and platform-specific storage keys', () => {
    expect(isNavigationDebugEnabled()).toBe(false);

    localStorage.setItem('chatTocDebugJump', '1');
    expect(isNavigationDebugEnabled()).toBe(true);

    mocks.debugStorageKey = 'customDebugFlag';
    expect(isNavigationDebugEnabled()).toBe(false);

    localStorage.setItem('customDebugFlag', '1');
    expect(isNavigationDebugEnabled()).toBe(true);
  });

  it('performs no console output, platform container queries, or DOM reads when debug is disabled', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const el = document.createElement('article');
    document.body.appendChild(el);
    const rectSpy = vi.spyOn(el, 'getBoundingClientRect');

    const container = document.createElement('div');
    const scrollTopGetter = vi.fn(() => 100);
    Object.defineProperty(container, 'scrollTop', { get: scrollTopGetter });

    logJumpFailedDiagnostic({
      targetIndex: 14,
      targetMessageId: 'msg-15',
      reason: 'target-disconnected',
      strategy: 'virtual-layout',
      recoveryAttempts: 1,
    });

    emitAlignmentMeasurement({
      jumpId: 'jump-1',
      stage: 'after-align',
      targetMessageId: 'msg-15',
      targetIndex: 14,
      strategy: 'virtual-layout',
      element: el,
      container,
      expectedViewportTopPx: 190,
      clamped: false,
    });

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(mocks.getScrollContainer).not.toHaveBeenCalled();
    expect(rectSpy).not.toHaveBeenCalled();
    expect(scrollTopGetter).not.toHaveBeenCalled();
  });

  it('emits [LUNA JUMP FAILED] with serialized JSON and scroll position when debug is enabled', () => {
    localStorage.setItem('chatTocDebugJump', '1');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { value: 250 });
    Object.defineProperty(container, 'scrollHeight', { value: 2000 });
    Object.defineProperty(container, 'clientHeight', { value: 800 });
    mocks.getScrollContainer.mockReturnValue(container);

    logJumpFailedDiagnostic({
      targetIndex: 14,
      targetMessageId: 'msg-15',
      reason: 'alignment-unstable',
      strategy: 'viewport-walker',
      recoveryAttempts: 2,
    });

    const expectedPayload = {
      targetIndex: 14,
      targetMessageId: 'msg-15',
      reason: 'alignment-unstable',
      scrollPosition: {
        scrollTop: 250,
        scrollHeight: 2000,
        clientHeight: 800,
        maxScrollTop: 1200,
      },
      strategy: 'viewport-walker',
      recoveryAttempts: 2,
    };

    expect(mocks.getScrollContainer).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      `[LUNA JUMP FAILED] ${JSON.stringify(expectedPayload)}`,
      expectedPayload
    );
  });

  it('emits [LUNA ALIGNMENT] with exact rounding and optional fields for connected targets', () => {
    localStorage.setItem('chatTocDebugJump', '1');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const el = document.createElement('div');
    el.setAttribute('data-chatgpt-search-unit-key', 'turn-15:user');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 190.46,
      bottom: 240,
      left: 0,
      right: 100,
      width: 100,
      height: 50,
      x: 0,
      y: 190.46,
      toJSON: () => ({}),
    } as DOMRect);

    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { value: 10465.4 });
    Object.defineProperty(container, 'scrollHeight', { value: 50000.6 });
    Object.defineProperty(container, 'clientHeight', { value: 963.2 });

    emitAlignmentMeasurement({
      jumpId: 'jump-42',
      stage: 'settled',
      targetMessageId: 'msg-15',
      targetIndex: 14,
      strategy: 'virtual-layout',
      element: el,
      container,
      expectedViewportTopPx: 190.12,
      clamped: true,
      method: 'container-scroll',
      displacementKind: 'none',
    });

    expect(infoSpy).toHaveBeenCalledWith('[LUNA ALIGNMENT]', {
      jumpId: 'jump-42',
      stage: 'settled',
      targetMessageId: 'msg-15',
      targetIndex: 14,
      strategy: 'virtual-layout',
      targetTag: 'DIV',
      targetUnitKey: 'turn-15:user',
      targetConnected: true,
      expectedViewportTopPx: 190.1,
      actualViewportTopPx: 190.5,
      alignmentErrorPx: 0.4,
      scrollTop: 10465,
      scrollHeight: 50001,
      clientHeight: 963,
      distanceFromBottom: 38572,
      clamped: true,
      method: 'container-scroll',
      displacementKind: 'none',
    });
  });

  it('handles disconnected targets, omits undefined optional fields, and reflects strategy changes', () => {
    localStorage.setItem('chatTocDebugJump', '1');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const detached = document.createElement('section');
    const rectSpy = vi.spyOn(detached, 'getBoundingClientRect');

    emitAlignmentMeasurement({
      jumpId: 'jump-99',
      stage: 'failed',
      targetMessageId: 'msg-60',
      targetIndex: 59,
      strategy: 'virtual-layout',
      element: detached,
      container: null,
      expectedViewportTopPx: 190,
      clamped: false,
    });

    emitAlignmentMeasurement({
      jumpId: 'jump-99',
      stage: 'realign',
      targetMessageId: 'msg-60',
      targetIndex: 59,
      strategy: 'viewport-walker',
      element: detached,
      container: null,
      expectedViewportTopPx: 190,
      clamped: false,
    });

    expect(rectSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenNthCalledWith(1, '[LUNA ALIGNMENT]', {
      jumpId: 'jump-99',
      stage: 'failed',
      targetMessageId: 'msg-60',
      targetIndex: 59,
      strategy: 'virtual-layout',
      targetTag: 'SECTION',
      targetUnitKey: null,
      targetConnected: false,
      expectedViewportTopPx: 190,
      actualViewportTopPx: null,
      alignmentErrorPx: null,
      scrollTop: null,
      scrollHeight: null,
      clientHeight: null,
      distanceFromBottom: null,
      clamped: false,
    });
    expect(infoSpy.mock.calls[0][1]).not.toHaveProperty('method');
    expect(infoSpy.mock.calls[0][1]).not.toHaveProperty('displacementKind');
    expect(infoSpy.mock.calls[1][1].strategy).toBe('viewport-walker');
  });
});
