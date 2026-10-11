/** @vitest-environment jsdom */
/** Tests lazy platform initialization in sidebarVisibility and navigatorController. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('lazy platform initialisation', () => {
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

  it('imports sidebarVisibility without triggering platform resolution or throwing under unmatched host', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'unmatched-domain.example.com' },
      writable: true,
      configurable: true,
    });

    // Importing must succeed without throwing "LunaTOC: no platform registered for host ..."
    const module = await import('@/features/sidebarVisibility');
    expect(module).toBeDefined();
    expect(typeof module.initializeSidebarVisibility).toBe('function');
  });

  it('imports navigatorController without triggering platform resolution or throwing under unmatched host', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'unmatched-domain.example.com' },
      writable: true,
      configurable: true,
    });

    // Importing must succeed without throwing "LunaTOC: no platform registered for host ..."
    const module = await import('@/navigation/navigatorController');
    expect(module).toBeDefined();
    expect(module.navigatorController).toBeDefined();
  });

  it('does not create or start renderedFingerprintCollector during attach in navigatorController', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'chatgpt.com' },
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

    // At import time, createRenderedFingerprintCollector has not been called
    expect(createCollectorSpy).not.toHaveBeenCalled();

    // Calling attach() must NOT start the unused fingerprint collector
    navigatorController.init();
    navigatorController.attach();

    expect(createCollectorSpy).not.toHaveBeenCalled();
    expect(collectorInstance.observe).not.toHaveBeenCalled();
  });
});
