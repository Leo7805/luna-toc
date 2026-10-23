/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfirmDialogHost } from '@/components/my-prompts/ConfirmDialog';
import {
  closePromptModal,
  resetPromptModal,
  showPromptModal,
} from '@/features/myPrompts/promptDialogController';
import { setReactPortalContainer } from '@/reactHost/portalContainer';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('ConfirmDialog', () => {
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPromptModal();

    rootContainer = document.createElement('div');
    portalContainer = document.createElement('div');
    portalContainer.className = 'luna-toc-ui';
    document.body.append(rootContainer, portalContainer);
    setReactPortalContainer(portalContainer);

    root = createRoot(rootContainer);
    act(() => {
      root.render(React.createElement(ConfirmDialogHost));
    });
  });

  afterEach(() => {
    act(() => {
      resetPromptModal();
      root.unmount();
    });
    rootContainer.remove();
    portalContainer.remove();
    setReactPortalContainer(null);
  });

  it('renders an informational dialog with default OK button and resolves true when confirmed', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Information',
        message: 'Your prompt was saved successfully.',
      }).then((result) => {
        resolvedValue = result;
      });
    });

    const titleEl = portalContainer.querySelector('[data-slot="dialog-title"]');
    const descEl = portalContainer.querySelector(
      '[data-slot="dialog-description"]'
    );
    const buttons = portalContainer.querySelectorAll('button');

    expect(titleEl?.textContent).toBe('Information');
    expect(descEl?.textContent).toBe('Your prompt was saved successfully.');
    // In info mode (confirm: false or omitted), only close button and OK button exist
    const actionButtons = Array.from(buttons).filter(
      (b) => !b.querySelector('svg')
    );
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0].textContent?.trim()).toBe('OK');

    // Click OK
    await act(async () => {
      actionButtons[0].click();
    });

    expect(resolvedValue).toBe(true);
    // Dialog content should be unmounted / closed
    expect(
      portalContainer.querySelector('[data-slot="dialog-title"]')
    ).toBeNull();
  });

  it('renders a confirmation dialog with custom buttons and resolves true on confirm', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Delete Prompt',
        message: 'Are you sure you want to delete this prompt?',
        confirm: true,
        confirmText: 'Delete',
        cancelText: 'Keep it',
      }).then((result) => {
        resolvedValue = result;
      });
    });

    const actionButtons = Array.from(
      portalContainer.querySelectorAll('button')
    ).filter((b) => !b.querySelector('svg'));
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[0].textContent?.trim()).toBe('Keep it');
    expect(actionButtons[1].textContent?.trim()).toBe('Delete');

    // Click confirm (Delete)
    await act(async () => {
      actionButtons[1].click();
    });

    expect(resolvedValue).toBe(true);
  });

  it('resolves false when Cancel is clicked in confirmation mode', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Clear all My Prompts',
        message: 'Delete all prompts?',
        confirm: true,
        confirmText: 'Clear all',
      }).then((result) => {
        resolvedValue = result;
      });
    });

    const actionButtons = Array.from(
      portalContainer.querySelectorAll('button')
    ).filter((b) => !b.querySelector('svg'));
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[0].textContent?.trim()).toBe('Cancel'); // default cancelText

    // Click Cancel
    await act(async () => {
      actionButtons[0].click();
    });

    expect(resolvedValue).toBe(false);
  });

  it('resolves false when the close X button is clicked', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Notice',
        message: 'Test message',
      }).then((result) => {
        resolvedValue = result;
      });
    });

    const closeButton = portalContainer.querySelector<HTMLButtonElement>(
      'button[data-slot="dialog-close"]'
    );
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.click();
    });

    expect(resolvedValue).toBe(false);
  });

  it('resolves false when the backdrop overlay is clicked', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Backdrop Test',
        message: 'Click outside to cancel',
        confirm: true,
      }).then((result) => {
        resolvedValue = result;
      });
    });

    const overlay = portalContainer.querySelector<HTMLElement>(
      '[data-slot="dialog-overlay"]'
    );
    expect(overlay).not.toBeNull();

    await act(async () => {
      overlay?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    await Promise.resolve();
    expect(resolvedValue).toBe(false);
  });

  it('resolves false when Escape is pressed', async () => {
    let resolvedValue: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Escape Test',
        message: 'Press Escape to cancel',
      }).then((result) => {
        resolvedValue = result;
      });
    });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    });

    await Promise.resolve();
    expect(resolvedValue).toBe(false);
  });

  it('safely resolves previous dialog with false when a new dialog is opened before resolving', async () => {
    let firstResult: boolean | undefined;
    let secondResult: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'First Dialog',
        message: 'First',
      }).then((r) => {
        firstResult = r;
      });
    });

    expect(firstResult).toBeUndefined();

    // Open second dialog without resolving first
    act(() => {
      void showPromptModal({
        title: 'Second Dialog',
        message: 'Second',
      }).then((r) => {
        secondResult = r;
      });
    });

    await Promise.resolve();

    // First request must resolve false immediately
    expect(firstResult).toBe(false);
    expect(secondResult).toBeUndefined();

    const titleEl = portalContainer.querySelector('[data-slot="dialog-title"]');
    expect(titleEl?.textContent).toBe('Second Dialog');

    // Confirm second dialog
    const confirmButton = Array.from(
      portalContainer.querySelectorAll('button')
    ).find((b) => b.textContent?.trim() === 'OK');
    await act(async () => {
      confirmButton?.click();
    });

    expect(secondResult).toBe(true);
  });

  it('supports repeated open and close cycles without retaining stale state', async () => {
    for (let i = 1; i <= 3; i++) {
      let result: boolean | undefined;
      act(() => {
        void showPromptModal({
          title: `Cycle ${i}`,
          message: `Message ${i}`,
        }).then((r) => {
          result = r;
        });
      });

      expect(
        portalContainer.querySelector('[data-slot="dialog-title"]')?.textContent
      ).toBe(`Cycle ${i}`);

      await act(async () => {
        closePromptModal(true);
      });

      expect(result).toBe(true);
      expect(
        portalContainer.querySelector('[data-slot="dialog-title"]')
      ).toBeNull();
    }
  });

  it('resolves pending promise to false when the host unmounts', async () => {
    let result: boolean | undefined;

    act(() => {
      void showPromptModal({
        title: 'Unmount test',
        message: 'Testing host unmount',
      }).then((r) => {
        result = r;
      });
    });

    expect(result).toBeUndefined();

    // Unmount host
    act(() => {
      root.unmount();
    });

    await Promise.resolve();

    expect(result).toBe(false);
  });
});
