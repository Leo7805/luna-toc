/**
 * Boots the LunaTOC content-script features. The sidebar DOM, controller
 * state, and feature wiring are owned by sibling modules; this file is the
 * orchestrator that wires them together.
 */
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { initializeSidebarVisibility } from '@/features/sidebarVisibility';
import { buttonTooltip, previewTooltip } from '@/features/tooltip';
import {
  getChatGPTTheme,
  observeChatGPTTheme,
  writeResolvedChatGPTTheme,
} from '@/features/theme/chatGptTheme';
import {
  applyTheme,
  readThemeSettings,
  subscribeThemeSettings,
  type ResolvedTheme,
  type ThemeSettings,
} from '@/features/theme/themeSettings';
import {
  applyPromptColorStyles,
  readPromptColorSettings,
  subscribePromptColorSettings,
  type PromptColorSettings,
} from '@/features/theme/promptColorSettings';
import { APP_CONFIG } from '@/config/config';
import { initializeCustomTocTitles } from '@/features/customTocTitles/customTocTitleStore';
import {
  openTocFilterMenu,
  resetTocFilterMode,
} from '@/features/tocFilter/tocFilterStore';
import { navigatorController } from '@/navigation/navigatorController';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { initFloatingPanel } from '@/features/sidebar/FloatingPanel';

/**
 * Resolves when document.body exists during document_start execution.
 * @returns {Promise<HTMLElement>}
 */
function waitForBody(): Promise<HTMLElement> {
  return new Promise<HTMLElement>((resolve) => {
    if (document.body) {
      resolve(document.body);
      return;
    }

    const timer = setInterval(() => {
      if (!document.body) return;
      clearInterval(timer);
      resolve(document.body);
    }, 50);
  });
}

/**
 * Creates the sidebar DOM and appends it to document.body. The initial
 * title is left empty; `sidebarController.init()` fills it synchronously
 * via `setNavigatorTitle()`.
 * @returns {Promise<HTMLElement>}
 */
async function createSidebar(): Promise<HTMLElement> {
  await waitForBody();

  if (document.getElementById('luna-toc-sidebar')) {
    throw new Error(
      'LunaTOC: cannot initialize application shell because #luna-toc-sidebar already exists in DOM'
    );
  }

  const sidebar = document.createElement('div');
  const sidebarConfig = APP_CONFIG.ui.sidebar;

  sidebar.id = 'luna-toc-sidebar';
  sidebar.dataset.viewMode = 'toc';
  sidebar.className = 'luna-toc-navigator-initializing';
  sidebar.style.setProperty(
    '--navigator-width',
    `${sidebarConfig.defaultWidthPx}px`
  );
  sidebar.style.setProperty(
    '--navigator-min-width',
    `${sidebarConfig.minimumWidthPx}px`
  );
  sidebar.style.setProperty(
    '--navigator-max-width',
    `${sidebarConfig.maximumWidthPx}px`
  );
  sidebar.innerHTML = `
      <div id="navigator-resizer"></div>
      <div class="navigator-topbar">
        <div id="navigator-header" class="navigator-header"></div>
        <div id="navigator-search-container"></div>
        <div id="myprompts-toolbar-container" style="display: none;"></div>
      </div>
      <div
        id="luna-toc-status"
        class="navigator-status"
        aria-live="polite"
        role="status"
      ></div>
      <div class="navigator-jump-controls"></div>
      <div id="navigator-list"></div>
      <div id="myprompts-list" class="navigator-list" style="display: none;"></div>
    `;

  document.body.appendChild(sidebar);
  return sidebar;
}

function initSidebarResize(sidebar: HTMLElement): void {
  const resizer = document.getElementById('navigator-resizer');
  if (!resizer) return;
  const sidebarConfig = APP_CONFIG.ui.sidebar;

  resizer.addEventListener('mousedown', (event: MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    function handleMouseMove(moveEvent: MouseEvent): void {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(
        sidebarConfig.maximumWidthPx,
        Math.max(sidebarConfig.minimumWidthPx, startWidth + delta)
      );
      sidebar.style.setProperty('--navigator-width', `${nextWidth}px`);
    }

    function handleMouseUp(): void {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });
}

function initTheme(): void {
  let settings: ThemeSettings | null = null;

  const handleChatGPTTheme = (theme: ResolvedTheme): void => {
    void writeResolvedChatGPTTheme(theme).catch((error) => {
      console.error('[LunaTOC] Failed to write resolved theme:', error);
    });
    if (settings?.followChatGPT) applyTheme(theme);
  };
  const applySettings = (nextSettings: ThemeSettings): void => {
    settings = nextSettings;
    applyTheme(
      nextSettings.followChatGPT
        ? getChatGPTTheme()
        : nextSettings.manualTheme
    );
  };

  observeChatGPTTheme(handleChatGPTTheme);
  void readThemeSettings()
    .then(applySettings)
    .catch((error) => {
      console.error('[LunaTOC] Failed to read theme settings:', error);
    });
  subscribeThemeSettings((nextSettings) => {
    applySettings(nextSettings);
  });
}

function initPromptColors(): void {
  const currentSettings: PromptColorSettings = {
    favouriteColor: 'original',
    renamedColor: 'original',
  };

  let hasLiveFavUpdate = false;
  let hasLiveRenamedUpdate = false;

  subscribePromptColorSettings((patch) => {
    if (patch.favouriteColor !== undefined) {
      hasLiveFavUpdate = true;
      currentSettings.favouriteColor = patch.favouriteColor;
    }
    if (patch.renamedColor !== undefined) {
      hasLiveRenamedUpdate = true;
      currentSettings.renamedColor = patch.renamedColor;
    }
    applyPromptColorStyles(currentSettings);
  });

  void readPromptColorSettings()
    .then((stored) => {
      let shouldApply = false;
      if (!hasLiveFavUpdate) {
        currentSettings.favouriteColor = stored.favouriteColor;
        shouldApply = true;
      }
      if (!hasLiveRenamedUpdate) {
        currentSettings.renamedColor = stored.renamedColor;
        shouldApply = true;
      }
      if (shouldApply) {
        applyPromptColorStyles(currentSettings);
      }
    })
    .catch((error) => {
      console.error('[LunaTOC] Failed to read prompt color settings:', error);
    });
}

/**
 * Publishes semantic global layers as CSS variables shared by legacy and
 * Shadow DOM interfaces.
 */
function applyStackingConfig(): void {
  const { baseZIndex, offsets } = APP_CONFIG.ui.stacking;
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty(
    '--ct-z-sidebar',
    String(baseZIndex + offsets.sidebar)
  );
  rootStyle.setProperty('--ct-z-toggle', String(baseZIndex + offsets.toggle));
  rootStyle.setProperty(
    '--ct-z-popover',
    String(baseZIndex + offsets.popover)
  );
  rootStyle.setProperty('--ct-z-modal', String(baseZIndex + offsets.modal));
}

let initializationPromise: Promise<void> | null = null;

/**
 * Starts the application after all feature and controller scripts load.
 * Returns the cached Promise on repeated calls for runtime idempotency.
 * @returns {Promise<void>}
 */
export function initializeApplication(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    if (document.getElementById('luna-toc-sidebar')) {
      throw new Error(
        'LunaTOC: cannot initialize application shell because #luna-toc-sidebar already exists in DOM'
      );
    }

    applyStackingConfig();
    await initializeCustomTocTitles();
    initTheme();
    initPromptColors();
    navigatorController.init({
      onPromptCountChanged: sidebarController.setPromptCount,
      onPromptAdded: () => sidebarController.setViewMode('toc'),
      onRouteChanged: () => {
        sidebarController.clearSearch();
        sidebarController.setNavigatorTitle();
        resetTocFilterMode();
      },
      onSavePrompt: sidebarController.handleSavePrompt,
      onTitleChanged: sidebarController.setNavigatorTitle,
    });
    const sidebar = await createSidebar();
    sidebar.addEventListener('contextmenu', (event) => {
      if (sidebarController.getViewSnapshot().viewMode !== 'toc') return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea')) return;
      if (target.closest('.navigator-item')) return;

      event.preventDefault();
      openTocFilterMenu({ left: event.clientX, top: event.clientY });
    });
    sidebarController.init();
    initSidebarResize(sidebar);
    initFloatingPanel();

    initializeSidebarVisibility(sidebar);
    previewTooltip.init({
      anchorSelector: '#navigator-list, #myprompts-list',
    });
    buttonTooltip.init();
    myPrompts.initAutocomplete();
    navigatorController.attach();

    myPrompts.onPromptsChanged((prompts) => {
      sidebarController.setMyPromptsCount(prompts.length);
      sidebarController.refreshMyPromptsIfActive();
    });
    void myPrompts
      .getMyPrompts()
      .then((prompts) => {
        sidebarController.setMyPromptsCount(prompts.length);
      })
      .catch((error) => {
        console.error('[LunaTOC] Failed to load initial prompt count:', error);
      });
  })();

  return initializationPromise;
}