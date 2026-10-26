/**
 * Boots the LunaTOC content-script features. The sidebar DOM, controller
 * state, and feature wiring are owned by sibling modules; this file is the
 * orchestrator that wires them together.
 */
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { initializeSidebarVisibility, setSidebarLayoutMode } from '@/features/sidebarVisibility';
import { initializeChatGptSideBySide, setChatGptSideBySideEnabled, syncChatGptSideBySide } from '@/features/sidebar/chatGptSideBySide';
import { initializeJumpControlsPosition } from '@/features/sidebar/jumpControlsPosition';
import { DEFAULT_SIDEBAR_PREFERENCES, readSidebarPreferences, sidebarAppearance, subscribeSidebarPreferences, type SidebarPreferences } from '@/features/sidebar/sidebarPreferences';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';
import { buttonTooltip, previewTooltip } from '@/features/tooltip';
import {
  getChatGPTTheme,
  observeChatGPTTheme,
  writeResolvedChatGPTTheme,
} from '@/features/theme/chatGptTheme';
import {
  readThemeSettings,
  subscribeThemeSettings,
  type ResolvedTheme,
  type ThemeSettings,
} from '@/features/theme/themeSettings';
import { getLunaTocTheme, setLunaTocTheme } from '@/features/theme/lunaTocTheme';
import { APP_CONFIG } from '@/config/config';
import { navigatorController } from '@/navigation/navigatorController';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { createJumpToEdgeControls } from '@/features/sidebar/jumpToEdgeControls';

let currentSidebarPreferences: SidebarPreferences = DEFAULT_SIDEBAR_PREFERENCES;

/** Reapplies local sidebar colors whenever a theme or preference changes. */
function applySidebarAppearance(): void {
  const theme = getLunaTocTheme();
  const colors = sidebarAppearance(currentSidebarPreferences, theme);
  const sidebar = document.getElementById('luna-toc-sidebar');
  if (colors.background) sidebar?.style.setProperty('--ct-bg-sidebar', colors.background);
  else sidebar?.style.removeProperty('--ct-bg-sidebar');
  if (colors.header) sidebar?.style.setProperty('--ct-bg-header', colors.header);
  else sidebar?.style.removeProperty('--ct-bg-header');
  document.getElementById('luna-toc-floating-dock')?.style.setProperty(
    '--luna-toc-reveal-bg', colors.reveal
  );
}


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

  const sidebar = document.createElement('div');
  const sidebarConfig = APP_CONFIG.ui.sidebar;

  sidebar.id = 'luna-toc-sidebar';
  sidebar.className =
    'luna-toc-navigator-initializing luna-toc-navigator-hidden';
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
        <div class="navigator-header">
          <button
            class="navigator-icon-btn navigator-header-icon-btn luna-toc-sidebar-pin-btn"
            id="luna-toc-sidebar-pin-btn"
            type="button"
            aria-label="固定侧边栏"
            aria-pressed="false"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
            </svg>
          </button>
          <button
            id="navigator-title"
            type="button"
            aria-label="重置目录视图"
            data-tooltip=""
            data-tooltip-overflow-only="true"
          ></button>
          <button
            class="navigator-icon-btn navigator-header-icon-btn"
            id="search-toggle-btn"
            type="button"
            aria-label="显示或隐藏搜索框"
            disabled
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
        <input
          id="navigator-search"
          type="search"
          placeholder="搜索提示词..."
          autocomplete="off"
        />
        <div id="myprompts-toolbar-container"></div>
      </div>
      <div
        id="luna-toc-status"
        class="navigator-status"
        aria-live="polite"
        role="status"
      ></div>
      <div class="navigator-jump-controls">
        <button class="navigator-icon-btn" id="toggle-view-mode-btn" type="button" aria-label="切换到 Tips" title="切换到 Tips">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="15 2 6 13 11 13 9 22 18 11 13 11 15 2"></polygon>
          </svg>
        </button>
      </div>
      <div id="navigator-list"></div>
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
      syncChatGptSideBySide();
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

  const applyTheme = (theme: ResolvedTheme): void => {
    setLunaTocTheme(theme);
    applySidebarAppearance();
  };
  const handleChatGPTTheme = (theme: ResolvedTheme): void => {
    void writeResolvedChatGPTTheme(theme);
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
  void readThemeSettings().then(applySettings);
  subscribeThemeSettings((nextSettings) => {
    applySettings(nextSettings);
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

/**
 * Starts the application after all feature and controller scripts load.
 */
export async function initializeApplication(): Promise<void> {
  applyStackingConfig();
  initTheme();
  navigatorController.init({
    onPromptCountChanged: sidebarController.setPromptCount,
    onPromptAdded: () => sidebarController.setViewMode('toc'),
    onRouteChanged: () => {
      sidebarController.clearSearch();
      sidebarController.setNavigatorTitle();
    },
    onSavePrompt: sidebarController.handleSavePrompt,
    onTitleChanged: sidebarController.setNavigatorTitle,
  });
  const sidebar = await createSidebar();
  sidebarController.init();
  initSidebarResize(sidebar);
  createJumpToEdgeControls(() => sidebarController.isMyPromptsView());
  initializeJumpControlsPosition(sidebar);
  const toggleButton = createSidebarToggleButton();
  initializeChatGptSideBySide(sidebar);
  initializeSidebarVisibility(sidebar, toggleButton, {
    onOpened: () => {
      navigatorController.resumeActivePromptTracking();
      if (!sidebarController.isMyPromptsView()) {
        navigatorController.refreshCurrentConversation();
      }
    },
    onClosed: () => navigatorController.pauseActivePromptTracking(),
  });
  const applyPreferences = (preferences: SidebarPreferences): void => {
    currentSidebarPreferences = preferences;
    setChatGptSideBySideEnabled(preferences.layoutMode === 'side-by-side');
    setSidebarLayoutMode(preferences.layoutMode);
    applySidebarAppearance();
  };
  applySidebarAppearance();
  void readSidebarPreferences().then(applyPreferences).catch(() => {
    applyPreferences(DEFAULT_SIDEBAR_PREFERENCES);
  });
  subscribeSidebarPreferences(applyPreferences);
  previewTooltip.init({ anchorSelector: '#navigator-list' });
  buttonTooltip.init();
  myPrompts.initAutocomplete();
  navigatorController.attach();

  myPrompts.onPromptsChanged((prompts) => {
    sidebarController.setMyPromptsCount(prompts.length);
    sidebarController.refreshMyPromptsIfActive();
  });
  void myPrompts.getMyPrompts().then((prompts) => {
    sidebarController.setMyPromptsCount(prompts.length);
  });
}