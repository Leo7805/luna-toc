/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('applicationShell initialization idempotency', () => {
  let navInitSpy: ReturnType<typeof vi.fn>;
  let sidebarInitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';

    navInitSpy = vi.fn();
    sidebarInitSpy = vi.fn();

    vi.doMock('@/features/customTocTitles/customTocTitleStore', () => ({
      initializeCustomTocTitles: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/features/theme/chatGptTheme', () => ({
      getChatGPTTheme: vi.fn().mockReturnValue('dark'),
      observeChatGPTTheme: vi.fn(),
      writeResolvedChatGPTTheme: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/features/theme/themeSettings', () => ({
      applyTheme: vi.fn(),
      readThemeSettings: vi.fn().mockResolvedValue({ followChatGPT: true }),
      subscribeThemeSettings: vi.fn(),
    }));
    vi.doMock('@/features/theme/promptColorSettings', () => ({
      applyPromptColorStyles: vi.fn(),
      readPromptColorSettings: vi.fn().mockResolvedValue({
        favouriteColor: 'original',
        renamedColor: 'original',
      }),
      subscribePromptColorSettings: vi.fn(),
    }));
    vi.doMock('@/navigation/navigatorController', () => ({
      navigatorController: { init: navInitSpy, attach: vi.fn() },
    }));
    vi.doMock('@/features/sidebar/sidebarController', () => ({
      sidebarController: {
        init: sidebarInitSpy,
        setPromptCount: vi.fn(),
        setViewMode: vi.fn(),
        clearSearch: vi.fn(),
        setNavigatorTitle: vi.fn(),
        handleSavePrompt: vi.fn(),
        getViewSnapshot: vi.fn().mockReturnValue({ viewMode: 'toc' }),
        setMyPromptsCount: vi.fn(),
        refreshMyPromptsIfActive: vi.fn(),
      },
    }));
    vi.doMock('@/features/sidebar/FloatingPanel', () => ({
      initFloatingPanel: vi.fn(),
    }));
    vi.doMock('@/features/sidebarVisibility', () => ({
      initializeSidebarVisibility: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/features/tooltip', () => ({
      buttonTooltip: { init: vi.fn() },
      previewTooltip: { init: vi.fn() },
    }));
    vi.doMock('@/features/myPrompts/myPrompts', () => ({
      myPrompts: {
        initAutocomplete: vi.fn(),
        onPromptsChanged: vi.fn(),
        getMyPrompts: vi.fn().mockResolvedValue([]),
      },
    }));
    vi.doMock('@/features/tocFilter/tocFilterStore', () => ({
      openTocFilterMenu: vi.fn(),
      resetTocFilterMode: vi.fn(),
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('preserves strict Promise reference identity across concurrent calls', async () => {
    const { initializeApplication } = await import('@/app/applicationShell');

    const p1 = initializeApplication();
    const p2 = initializeApplication();

    expect(p1).toBe(p2);
    await p1;

    expect(document.querySelectorAll('#luna-toc-sidebar')).toHaveLength(1);
    expect(navInitSpy).toHaveBeenCalledTimes(1);
    expect(sidebarInitSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves strict Promise reference identity on sequential calls after completion', async () => {
    const { initializeApplication } = await import('@/app/applicationShell');

    const p1 = initializeApplication();
    await p1;

    const p2 = initializeApplication();
    expect(p2).toBe(p1);

    expect(document.querySelectorAll('#luna-toc-sidebar')).toHaveLength(1);
    expect(navInitSpy).toHaveBeenCalledTimes(1);
    expect(sidebarInitSpy).toHaveBeenCalledTimes(1);
  });

  it('waits for startup visibility before attaching the navigator', async () => {
    const { initializeSidebarVisibility } = await import('@/features/sidebarVisibility');
    let finishVisibility!: () => void;
    vi.mocked(initializeSidebarVisibility).mockImplementationOnce(() => new Promise<void>((resolve) => { finishVisibility = resolve; }));
    const { navigatorController } = await import('@/navigation/navigatorController');
    const { initializeApplication } = await import('@/app/applicationShell');
    const initialized = initializeApplication();
    await vi.waitFor(() => expect(initializeSidebarVisibility).toHaveBeenCalled());
    expect(navigatorController.attach).not.toHaveBeenCalled();
    finishVisibility();
    await initialized;
    expect(navigatorController.attach).toHaveBeenCalledTimes(1);
  });

  it('fails deterministically without adopting or removing pre-existing sidebar', async () => {
    const foreignSidebar = document.createElement('div');
    foreignSidebar.id = 'luna-toc-sidebar';
    foreignSidebar.setAttribute('data-foreign-test', 'true');
    document.body.appendChild(foreignSidebar);

    const { initializeApplication } = await import('@/app/applicationShell');

    await expect(initializeApplication()).rejects.toThrow(
      'LunaTOC: cannot initialize application shell because #luna-toc-sidebar already exists in DOM'
    );

    // Verify foreign element was not removed or mutated
    expect(document.getElementById('luna-toc-sidebar')).toBe(foreignSidebar);
    expect(foreignSidebar.getAttribute('data-foreign-test')).toBe('true');
    expect(navInitSpy).not.toHaveBeenCalled();
    expect(sidebarInitSpy).not.toHaveBeenCalled();
  });

  it('preserves cached rejected Promise across subsequent calls', async () => {
    const foreignSidebar = document.createElement('div');
    foreignSidebar.id = 'luna-toc-sidebar';
    document.body.appendChild(foreignSidebar);

    const { initializeApplication } = await import('@/app/applicationShell');

    const firstAttempt = initializeApplication();
    await expect(firstAttempt).rejects.toThrow('LunaTOC: cannot initialize');

    const secondAttempt = initializeApplication();
    expect(secondAttempt).toBe(firstAttempt);
    await expect(secondAttempt).rejects.toThrow('LunaTOC: cannot initialize');
    expect(navInitSpy).not.toHaveBeenCalled();
  });

  it('aborts inside createSidebar if a sidebar element appears during asynchronous startup', async () => {
    const { initializeCustomTocTitles } = await import(
      '@/features/customTocTitles/customTocTitleStore'
    );
    // Simulate another instance injecting a sidebar across the await boundary
    vi.mocked(initializeCustomTocTitles).mockImplementationOnce(async () => {
      const raceSidebar = document.createElement('div');
      raceSidebar.id = 'luna-toc-sidebar';
      raceSidebar.setAttribute('data-race-injected', 'true');
      document.body.appendChild(raceSidebar);
    });

    const { initializeApplication } = await import('@/app/applicationShell');

    await expect(initializeApplication()).rejects.toThrow(
      'LunaTOC: cannot initialize application shell because #luna-toc-sidebar already exists in DOM'
    );

    const surviving = document.getElementById('luna-toc-sidebar');
    expect(surviving?.getAttribute('data-race-injected')).toBe('true');
    expect(sidebarInitSpy).not.toHaveBeenCalled();
  });

  it('creates .navigator-jump-controls before .navigator-content wrapping status and lists', async () => {
    const { initializeApplication } = await import('@/app/applicationShell');

    await initializeApplication();

    const sidebar = document.getElementById('luna-toc-sidebar');
    expect(sidebar).not.toBeNull();

    const topbar = sidebar?.querySelector('.navigator-topbar');
    const jumpControls = sidebar?.querySelector('.navigator-jump-controls');
    const content = sidebar?.querySelector('.navigator-content');
    const status = sidebar?.querySelector('#luna-toc-status');
    const tocList = sidebar?.querySelector('#navigator-list');
    const myPromptsList = sidebar?.querySelector('#myprompts-list');

    expect(topbar).not.toBeNull();
    expect(jumpControls).not.toBeNull();
    expect(content).not.toBeNull();
    expect(topbar?.nextElementSibling).toBe(jumpControls);
    expect(jumpControls?.nextElementSibling).toBe(content);
    expect(content?.children).toHaveLength(3);
    expect(content?.children[0]).toBe(status);
    expect(content?.children[1]).toBe(tocList);
    expect(content?.children[2]).toBe(myPromptsList);
  });
});
