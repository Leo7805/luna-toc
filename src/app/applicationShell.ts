/**
 * Boots the LunaTOC content-script features. The sidebar DOM, controller
 * state, and feature wiring are owned by sibling modules; this file is the
 * orchestrator that wires them together.
 */
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { initializeSidebarVisibility } from '@/features/sidebarVisibility';
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
import { APP_CONFIG } from '@/config/config';
import { initializeNavigationSettings } from '@/navigation/navigationSettings';
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

  const sidebar = document.createElement('div');
  const sidebarConfig = APP_CONFIG.ui.sidebar;

  sidebar.id = 'luna-toc-sidebar';
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
        <div class="navigator-header">
          <button
            class="navigator-icon-btn navigator-header-icon-btn luna-toc-sidebar-pin-btn"
            id="luna-toc-sidebar-pin-btn"
            type="button"
            aria-label="Enable sidebar auto-hide"
            aria-pressed="true"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
            </svg>
          </button>
          <button
            id="navigator-title"
            type="button"
            aria-label="Reset TOC view"
            data-tooltip=""
            data-tooltip-overflow-only="true"
          ></button>
          <button
            class="navigator-icon-btn navigator-header-icon-btn"
            id="search-toggle-btn"
            type="button"
            aria-label="Toggle search"
            disabled
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
        <div
          id="luna-toc-status"
          class="navigator-status"
          aria-live="polite"
          role="status"
        ></div>
        <input
          id="navigator-search"
          type="search"
          placeholder="Search prompts..."
          autocomplete="off"
        />
        <div id="myprompts-toolbar-container"></div>
      </div>
      <div class="navigator-jump-controls">
        <button class="navigator-icon-btn" id="jump-chat-top-btn" type="button" aria-label="Jump to top">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 5h12M12 19V9M7 14l5-5 5 5" />
          </svg>
        </button>
        <button class="navigator-icon-btn" id="toggle-view-mode-btn" type="button" aria-label="Switch to My Prompts" title="Switch to My Prompts">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="15 2 6 13 11 13 9 22 18 11 13 11 15 2"></polygon>
          </svg>
        </button>
        <button class="navigator-icon-btn" id="jump-chat-bottom-btn" type="button" aria-label="Jump to bottom">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 19h12M12 5v10M7 10l5 5 5-5" />
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
    document.documentElement.dataset.theme = theme;
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
  await initializeNavigationSettings();
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
  initFloatingPanel();

  const toggleButton = createSidebarToggleButton();
  initializeSidebarVisibility(sidebar, toggleButton);
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