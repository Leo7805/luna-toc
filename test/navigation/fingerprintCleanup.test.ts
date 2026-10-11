/** @vitest-environment jsdom */
/**
 * Tests that conversation initialization and updates no longer start
 * unused fingerprint collection or background hashing (P0.4a).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fingerprintIndexModule from '@/navigation/fingerprint/index';
import * as segmentsModule from '@/navigation/fingerprint/segments';

describe('P0.4a background fingerprint cleanup', () => {
  const originalHost = window.location.host;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds: number[] = [];

        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: originalHost },
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('does not start renderedFingerprintCollector on attach', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'chatgpt.com', pathname: '/c/test-conv' },
      writable: true,
      configurable: true,
    });

    const collectorInstance = {
      collect: vi.fn(),
      observe: vi.fn(),
      setContext: vi.fn(),
      disconnect: vi.fn(),
    };
    const createCollectorSpy = vi.fn(() => collectorInstance);

    vi.doMock('@/platforms', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/platforms')>();
      const activePlatform = actual.getActivePlatform('chatgpt.com');
      return {
        ...actual,
        getActivePlatform: vi.fn(() => ({
          ...activePlatform,
          contentCapture: {
            ...activePlatform.contentCapture,
            createRenderedFingerprintCollector: createCollectorSpy,
          },
        })),
      };
    });

    const { navigatorController } = await import('@/navigation/navigatorController');

    navigatorController.init();
    navigatorController.attach();

    expect(createCollectorSpy).not.toHaveBeenCalled();
    expect(collectorInstance.observe).not.toHaveBeenCalled();
  });

  it('does not invoke buildFingerprintIndex or buildDerivedSegmentIndex during conversation updates', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'chatgpt.com', pathname: '/c/test-conv' },
      writable: true,
      configurable: true,
    });

    const buildFingerprintsSpy = vi.spyOn(fingerprintIndexModule, 'buildFingerprintIndex');
    const buildSegmentsSpy = vi.spyOn(segmentsModule, 'buildDerivedSegmentIndex');

    const { navigatorController } = await import('@/navigation/navigatorController');
    navigatorController.init();
    navigatorController.attach();

    // Dispatch conversationData event through postMessage
    const conversationDataMessage = {
      type: 'CHATGPT_CONVERSATION_DATA',
      data: {
        title: 'Test Conversation',
        mapping: {
          'msg-1': {
            id: 'msg-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['Hello ChatGPT'] },
            },
          },
          'msg-2': {
            id: 'msg-2',
            message: {
              id: 'msg-2',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Hello! How can I help?'] },
            },
          },
        },
        current_node: 'msg-2',
      },
    };

    window.dispatchEvent(
      new MessageEvent('message', {
        data: conversationDataMessage,
        source: window,
      })
    );

    // Verify background hashing was NOT invoked
    expect(buildFingerprintsSpy).not.toHaveBeenCalled();
    expect(buildSegmentsSpy).not.toHaveBeenCalled();
  });
});
