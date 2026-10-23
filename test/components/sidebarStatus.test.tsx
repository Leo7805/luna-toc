/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarStatus } from '@/components/sidebar-status/SidebarStatus';
import { SidebarHeader } from '@/components/sidebar-header/SidebarHeader';
import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import {
  getStatusSnapshot,
  resetStatusForTesting,
  setSidebarStatus,
} from '@/navigation/ui/sidebarStatus';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { navigatorController } from '@/navigation/navigatorController';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarStatus React Migration', () => {
  let sidebar: HTMLDivElement;
  let statusContainer: HTMLDivElement;
  let headerContainer: HTMLDivElement;
  let searchContainer: HTMLDivElement;
  let myPromptsToolbarContainer: HTMLDivElement;
  let myPromptsList: HTMLDivElement;
  let navigatorList: HTMLDivElement;
  let viewModeBtn: HTMLButtonElement;
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let root: Root;

  const mockPrompts: SavedPrompt[] = [
    {
      id: 'prompt-1',
      title: 'Prompt One',
      content: 'Alpha prompt text',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    resetStatusForTesting();

    sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.dataset.viewMode = 'toc';

    statusContainer = document.createElement('div');
    statusContainer.id = 'luna-toc-status';
    statusContainer.className = 'navigator-status';
    statusContainer.setAttribute('aria-live', 'polite');
    statusContainer.setAttribute('role', 'status');

    headerContainer = document.createElement('div');
    headerContainer.id = 'navigator-header';
    headerContainer.className = 'navigator-header';

    searchContainer = document.createElement('div');
    searchContainer.id = 'navigator-search-container';

    myPromptsToolbarContainer = document.createElement('div');
    myPromptsToolbarContainer.id = 'myprompts-toolbar-container';
    myPromptsToolbarContainer.style.display = 'none';

    navigatorList = document.createElement('div');
    navigatorList.id = 'navigator-list';

    myPromptsList = document.createElement('div');
    myPromptsList.id = 'myprompts-list';
    myPromptsList.style.display = 'none';

    viewModeBtn = document.createElement('button');
    viewModeBtn.id = 'toggle-view-mode-btn';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    portalContainer = document.createElement('div');
    portalContainer.className = 'luna-toc-ui';

    sidebar.append(
      headerContainer,
      searchContainer,
      statusContainer,
      myPromptsToolbarContainer,
      viewModeBtn,
      navigatorList,
      myPromptsList
    );

    document.body.append(sidebar, rootContainer, portalContainer);
    setReactPortalContainer(portalContainer);

    sidebarController.init();
    sidebarController.setPromptCount(1);
    sidebarController.setMyPromptsCount(mockPrompts.length);

    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);
    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});

    root = createRoot(rootContainer);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      setSidebarStatus({ state: 'idle' });
      resetStatusForTesting();
      sidebarController.setViewMode('toc');
      sidebarController.resetReadyForTesting();
    });
    setReactPortalContainer(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('1. Initial idle state renders no children and lacks active class', () => {
    act(() => {
      setSidebarStatus({ state: 'idle' });
      root.render(<SidebarStatus />);
    });

    expect(statusContainer.children.length).toBe(0);
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });

  it('2. Loading without prompt count renders "Loading…"', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 0 });
    });

    expect(statusContainer.textContent).toBe('Loading…');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('3. Loading with prompt count renders progress format', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 42 });
    });

    expect(statusContainer.textContent).toBe('Loading... (42 so far)');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('4. Incremental loading progress updates dynamically in DOM', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 1 });
    });
    expect(statusContainer.textContent).toBe('Loading... (1 so far)');

    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 50 });
    });
    expect(statusContainer.textContent).toBe('Loading... (50 so far)');

    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 120 });
    });
    expect(statusContainer.textContent).toBe('Loading... (120 so far)');
  });

  it('5. Jumping progress updates render destination and animated three-dot spans', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({
        state: 'jumping',
        jump: { active: true, targetIndex: 9, currentProgressIndex: 3 },
      });
    });

    expect(statusContainer.textContent).toContain('To #10 · Now #4');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);

    const dots = statusContainer.querySelector('.jumping-dots');
    expect(dots).not.toBeNull();
    expect(dots?.getAttribute('aria-hidden')).toBe('true');
    expect(dots?.querySelectorAll('.dot').length).toBe(3);
  });

  it('6. Complete status reflects prompt count or destination lingering', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({
        state: 'jumping',
        jump: { active: true, targetIndex: 4, currentProgressIndex: 4 },
      });
    });
    expect(statusContainer.textContent).toContain('To #5');

    act(() => {
      setSidebarStatus({ state: 'complete', promptCount: 5 });
    });
    // Lingers on last jump text
    expect(statusContainer.textContent).toBe('To #5 · Now #5');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('7. Empty status renders "No prompts" persistently without timer retract', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'empty' });
    });

    expect(statusContainer.textContent).toBe('No prompts');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(statusContainer.textContent).toBe('No prompts');
  });

  it('8. Failed status renders "Jump failed" and retracts after linger timeout', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'failed' });
    });

    expect(statusContainer.textContent).toBe('Jump failed');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });

  it('9. Existing linger timeout retracts complete state to idle', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'complete', promptCount: 1 });
    });

    expect(statusContainer.textContent).toBe('1 prompt');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });

  it('10. Rapid status transitions settle on final state cleanly', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 5 });
      setSidebarStatus({ state: 'loading', promptCount: 10 });
      setSidebarStatus({
        state: 'jumping',
        jump: { active: true, targetIndex: 2 },
      });
      setSidebarStatus({ state: 'complete', promptCount: 10 });
    });

    expect(statusContainer.textContent).toContain('To #3');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('11. Status updates before React mounts display immediately upon mount', () => {
    // Dispatch status before root is rendered
    setSidebarStatus({ state: 'loading', promptCount: 300 });
    expect(getStatusSnapshot().text).toBe('Loading... (300 so far)');

    // Mount React
    act(() => {
      root.render(<SidebarStatus />);
    });

    expect(statusContainer.textContent).toBe('Loading... (300 so far)');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('12. Delayed initialization: React mounts before Sidebar DOM exists', () => {
    // Clear DOM and reset readiness
    sidebarController.resetReadyForTesting();
    document.body.innerHTML = '';
    const isolatedRootContainer = document.createElement('div');
    document.body.appendChild(isolatedRootContainer);
    const isolatedRoot = createRoot(isolatedRootContainer);

    // Render React before sidebar DOM exists
    act(() => {
      isolatedRoot.render(<SidebarStatus />);
    });

    expect(document.getElementById('luna-toc-status')).toBeNull();

    // Now create and append sidebar
    const delayedSidebar = document.createElement('div');
    delayedSidebar.id = 'luna-toc-sidebar';
    const delayedStatus = document.createElement('div');
    delayedStatus.id = 'luna-toc-status';
    delayedStatus.className = 'navigator-status';
    delayedSidebar.appendChild(delayedStatus);
    document.body.appendChild(delayedSidebar);

    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 15 });
    });

    // Publish readiness
    act(() => {
      sidebarController.init();
    });

    expect(delayedStatus.textContent).toBe('Loading... (15 so far)');
    expect(delayedStatus.classList.contains('navigator-status-active')).toBe(true);

    act(() => {
      isolatedRoot.unmount();
    });
  });

  it('13. Sidebar DOM exists before React mounts resolves immediately', () => {
    setSidebarStatus({ state: 'empty' });

    act(() => {
      root.render(<SidebarStatus />);
    });

    expect(statusContainer.textContent).toBe('No prompts');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);
  });

  it('14. Switching to MyPrompts maintains view isolation', () => {
    act(() => {
      root.render(
        <>
          <SidebarStatus />
          <MyPromptsView />
        </>
      );
      setSidebarStatus({ state: 'loading', promptCount: 20 });
    });

    expect(statusContainer.textContent).toBe('Loading... (20 so far)');

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(sidebar.dataset.viewMode).toBe('myPrompts');
    // Content is owned by React; CSS hides #luna-toc-status under data-view-mode='myPrompts'
  });

  it('15. Background updates while in MyPrompts update store without breaking DOM', () => {
    act(() => {
      root.render(<SidebarStatus />);
      sidebarController.setViewMode('myPrompts');
    });

    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 349 });
    });

    expect(getStatusSnapshot().text).toBe('Loading... (349 so far)');
    expect(statusContainer.textContent).toBe('Loading... (349 so far)');
  });

  it('16. Switching back to TOC during loading displays current progress', () => {
    act(() => {
      root.render(<SidebarStatus />);
      sidebarController.setViewMode('myPrompts');
      setSidebarStatus({ state: 'loading', promptCount: 500 });
    });

    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(statusContainer.textContent).toBe('Loading... (500 so far)');
  });

  it('17. Returning to TOC after completion and linger expiry renders idle', () => {
    act(() => {
      root.render(<SidebarStatus />);
      sidebarController.setViewMode('myPrompts');
      setSidebarStatus({ state: 'complete', promptCount: 10 });
    });

    act(() => {
      vi.advanceTimersByTime(2500);
      sidebarController.setViewMode('toc');
    });

    expect(getStatusSnapshot().state).toBe('idle');
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });

  it('18. React Portal mount and cleanup cleans up container styling on unmount', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 10 });
    });

    expect(statusContainer.classList.contains('navigator-status-active')).toBe(true);

    act(() => {
      root.unmount();
    });

    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
    expect(statusContainer.children.length).toBe(0);
  });

  it('19. No duplicate status elements exist in DOM', () => {
    act(() => {
      root.render(<SidebarStatus />);
    });

    expect(document.querySelectorAll('#luna-toc-status').length).toBe(1);
  });

  it('20. No regression to Header or MyPrompts when SidebarStatus is mounted alongside them', () => {
    act(() => {
      root.render(
        <>
          <SidebarHeader />
          <SidebarStatus />
          <MyPromptsView />
        </>
      );
      setSidebarStatus({ state: 'loading', promptCount: 5 });
    });

    expect(document.getElementById('luna-toc-sidebar-pin-btn')).not.toBeNull();
    expect(document.getElementById('navigator-title')).not.toBeNull();
    expect(document.getElementById('search-toggle-btn')).not.toBeNull();
    expect(statusContainer.textContent).toBe('Loading... (5 so far)');

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(document.getElementById('myprompts-toolbar-container')).not.toBeNull();
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(1);
  });

  it('21. Zero subscribers: sidebarStatus does NOT mutate DOM directly', () => {
    // Ensure root is unmounted (0 subscribers)
    act(() => {
      root.unmount();
      statusContainer.innerHTML = '';
      statusContainer.className = 'navigator-status';
    });

    // Calling setSidebarStatus directly with no React subscriber
    setSidebarStatus({ state: 'loading', promptCount: 99 });

    // Snapshot is updated
    expect(getStatusSnapshot().text).toBe('Loading... (99 so far)');
    // But Vanilla DOM was NOT mutated
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });

  it('22. Subscription cleanup does not reactivate Vanilla DOM mutations', () => {
    act(() => {
      root.render(<SidebarStatus />);
      setSidebarStatus({ state: 'loading', promptCount: 10 });
    });
    expect(statusContainer.textContent).toBe('Loading... (10 so far)');

    act(() => {
      root.unmount();
    });
    expect(statusContainer.textContent).toBe('');

    // Dispatched after unmount (0 subscribers)
    setSidebarStatus({ state: 'loading', promptCount: 20 });
    expect(getStatusSnapshot().text).toBe('Loading... (20 so far)');
    expect(statusContainer.textContent).toBe('');
    expect(statusContainer.classList.contains('navigator-status-active')).toBe(false);
  });
});
