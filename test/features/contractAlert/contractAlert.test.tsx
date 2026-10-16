/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractAlert } from '@/features/contractAlert/ContractAlert';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import * as detector from '@/features/contractAlert/detector';
import * as config from '@/config/config';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('ContractAlert layering', () => {
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv',
      },
    });

    vi.stubGlobal('chrome', {
      storage: {
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });

    vi.spyOn(config, 'loadPlatformRuntimeConfig').mockResolvedValue({
      showCompatibilityAlert: true,
      useLocalConfig: false,
    });

    vi.spyOn(detector, 'subscribeMismatches').mockImplementation((callback) => {
      callback([
        {
          contractId: 'api.conversation.path',
          label: 'Conversation data API path',
          expected: '/backend-api/conversations/{id}',
          actual: '/backend-api/test/{id}',
          observedAt: 123456789,
        },
      ]);
      return () => {};
    });

    rootContainer = document.createElement('div');
    portalContainer = document.createElement('div');
    document.body.append(rootContainer, portalContainer);
    setReactPortalContainer(portalContainer);

    root = createRoot(rootContainer);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootContainer.remove();
    portalContainer.remove();
    setReactPortalContainer(null);
    vi.restoreAllMocks();
  });

  it('renders both overlay and popup with inline ALERT_Z_INDEX and correct sibling order', async () => {
    await act(async () => {
      root.render(<ContractAlert />);
    });

    const overlay = document.querySelector<HTMLElement>(
      '[data-slot="dialog-overlay"]'
    );
    const popup = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]'
    );

    expect(overlay).not.toBeNull();
    expect(popup).not.toBeNull();

    expect(overlay?.style.zIndex).toBe('2147483647');
    expect(popup?.style.zIndex).toBe('2147483647');

    expect(
      Boolean(
        overlay &&
          popup &&
          overlay.compareDocumentPosition(popup) &
            Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);

    expect(overlay?.className).not.toContain('z-[2147483647]');
    expect(popup?.className).not.toContain('z-[2147483647]');
  });
});
