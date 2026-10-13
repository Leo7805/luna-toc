/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CustomTocTitleDialogHost,
  closeCustomTocTitleDialog,
  openCustomTocTitleDialog,
} from '@/components/custom-toc-titles/CustomTocTitleDialog';
import {
  getCustomTitle,
  setCustomTitle,
} from '@/features/customTocTitles/customTocTitleStore';
import { setReactPortalContainer } from '@/reactHost/portalContainer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/features/customTocTitles/customTocTitleStore', () => ({
  getCustomTitle: vi.fn(),
  setCustomTitle: vi.fn(),
  removeCustomTitle: vi.fn(),
}));

describe('CustomTocTitleDialog', () => {
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let root: Root;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCustomTitle).mockReturnValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    rootContainer = document.createElement('div');
    portalContainer = document.createElement('div');
    document.body.append(rootContainer, portalContainer);
    setReactPortalContainer(portalContainer);

    root = createRoot(rootContainer);
    act(() => {
      root.render(React.createElement(CustomTocTitleDialogHost));
    });
  });

  afterEach(() => {
    act(() => {
      closeCustomTocTitleDialog();
      root.unmount();
    });
    rootContainer.remove();
    portalContainer.remove();
    setReactPortalContainer(null);
    consoleErrorSpy.mockRestore();
  });

  it('displays the context invalidated error, keeps the dialog open, and re-enables save', async () => {
    vi.mocked(setCustomTitle).mockRejectedValueOnce(
      new Error('Extension context invalidated')
    );

    act(() => {
      openCustomTocTitleDialog({
        messageId: 'msg-1',
        originalPrompt: 'Original prompt text',
      });
    });

    const form = portalContainer.querySelector('form')!;
    const saveButton = portalContainer.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    )!;
    expect(form).not.toBeNull();

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(portalContainer.textContent).toContain(
      'Extension updated. Refresh ChatGPT to save.'
    );
    expect(saveButton.disabled).toBe(false);
    expect(portalContainer.querySelector('form')).not.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unable to persist the custom TOC title.',
      expect.any(Error)
    );
  });

  it('displays a generic error when persistence fails for other reasons', async () => {
    vi.mocked(setCustomTitle).mockRejectedValueOnce(
      new Error('Storage quota exceeded')
    );

    act(() => {
      openCustomTocTitleDialog({
        messageId: 'msg-1',
        originalPrompt: 'Original prompt text',
      });
    });

    const form = portalContainer.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(portalContainer.textContent).toContain(
      'Unable to save custom title. Please try again.'
    );
    expect(portalContainer.querySelector('form')).not.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unable to persist the custom TOC title.',
      expect.any(Error)
    );
  });

  it('clears the inline error when the user edits the input', async () => {
    vi.mocked(setCustomTitle).mockRejectedValueOnce(
      new Error('Storage quota exceeded')
    );

    act(() => {
      openCustomTocTitleDialog({
        messageId: 'msg-1',
        originalPrompt: 'Original prompt text',
      });
    });

    const form = portalContainer.querySelector('form')!;
    const input = portalContainer.querySelector('input')!;

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(portalContainer.textContent).toContain(
      'Unable to save custom title. Please try again.'
    );

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(input, 'Updated Title');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(portalContainer.textContent).not.toContain(
      'Unable to save custom title. Please try again.'
    );
  });

  it('closes the dialog when persistence succeeds even if onUpdated throws', async () => {
    vi.mocked(setCustomTitle).mockResolvedValueOnce(undefined);
    const onUpdated = vi.fn().mockImplementation(() => {
      throw new Error('Renderer DOM error');
    });

    act(() => {
      openCustomTocTitleDialog({
        messageId: 'msg-1',
        originalPrompt: 'Original prompt text',
        onUpdated,
      });
    });

    const form = portalContainer.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(onUpdated).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unable to refresh the TOC after updating the custom title.',
      expect.any(Error)
    );
    expect(portalContainer.querySelector('form')).toBeNull();
  });
});
