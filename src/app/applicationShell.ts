/**
 * Builds the LunaTOC sidebar shell and coordinates application-level features.
 */
import { myPrompts } from '../features/myPrompts/myPrompts';
import type { NavigatorMessage } from '../features/conversationPrompts/message';
import { initializeSidebarVisibility } from '../features/sidebarVisibility';
import { createToggleButton } from '../features/toggleButton';
import { buttonTooltip, previewTooltip } from '../features/tooltip';
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
import { initializeNavigationSettings } from '@/features/navigation/navigationSettings';
import { mountSidebarReactApp } from '@/reactHost/reactHost';
import { navigatorController } from './navigatorController';

type ConversationEdge = 'top' | 'bottom';
type ViewMode = 'toc' | 'myPrompts';

interface JumpControlsPosition {
  top?: number;
  topRatio?: number;
}

const JUMP_CONTROLS_POSITION_STORAGE_KEY = 'chatTocJumpControlsPosition';
const NAVIGATOR_EMPTY_HINT_TEXT = 'Waiting for prompts...';

let viewMode: ViewMode = 'toc';
let searchQuery = '';
let myPromptsRefreshQueued = false;

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
 * Creates the sidebar DOM and registers application-level controls.
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
  document.body.appendChild(sidebar);
  mountSidebarReactApp(sidebar, {
    title: getConversationTitle(),
    emptyHint: NAVIGATOR_EMPTY_HINT_TEXT,
  });
  bindSidebarControls();
  return sidebar;
}

/**
 * Registers controls that switch views or delegate navigation behavior.
 */
function bindSidebarControls(): void {
  const searchInput = getRequiredElement<HTMLInputElement>('navigator-search');

  getRequiredElement<HTMLButtonElement>('search-toggle-btn').addEventListener(
    'click',
    () => {
      const isHidden = window.getComputedStyle(searchInput).display === 'none';
      searchInput.style.display = isHidden ? 'block' : 'none';

      if (isHidden) {
        searchInput.focus();
        return;
      }

      clearSearch();
      renderCurrentView();
    }
  );
  getRequiredElement<HTMLButtonElement>('navigator-title').addEventListener(
    'click',
    handleTitleClick
  );
  getRequiredElement<HTMLButtonElement>('jump-chat-top-btn').addEventListener(
    'click',
    () => handleJumpControlClick('top')
  );
  getRequiredElement<HTMLButtonElement>('jump-chat-top-btn').addEventListener(
    'dblclick',
    () => handleJumpControlDoubleClick('top')
  );
  getRequiredElement<HTMLButtonElement>(
    'jump-chat-bottom-btn'
  ).addEventListener('click', () => handleJumpControlClick('bottom'));
  getRequiredElement<HTMLButtonElement>(
    'jump-chat-bottom-btn'
  ).addEventListener('dblclick', () => handleJumpControlDoubleClick('bottom'));
  getRequiredElement<HTMLButtonElement>(
    'toggle-view-mode-btn'
  ).addEventListener('click', toggleViewMode);
  searchInput.addEventListener('input', (event) => {
    searchQuery = (event.currentTarget as HTMLInputElement).value;
    renderCurrentView();
  });
}

function clearSearch(): void {
  searchQuery = '';
  const searchInput = document.getElementById(
    'navigator-search'
  ) as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';
  navigatorController.setSearchQuery('');
}

function renderCurrentView(): void {
  if (viewMode === 'myPrompts') {
    renderMyPrompts();
    return;
  }

  navigatorController.setSearchQuery(searchQuery);
}

function renderMyPrompts(): void {
  const list = document.getElementById('navigator-list');
  const hint = document.querySelector<HTMLElement>('.navigator-hint');
  if (!list) return;
  if (hint) hint.hidden = true;

  myPrompts.renderMyPrompts(list, searchQuery, () => {
    renderCurrentView();
  });
}

function handleTitleClick(): void {
  if (viewMode === 'myPrompts') {
    scrollNavigatorListToEdge('top', 'smooth');
    return;
  }

  clearSearch();
  navigatorController.resetView();
}

function handleJumpControlClick(edge: ConversationEdge): void {
  if (viewMode === 'myPrompts') {
    scrollNavigatorListToEdge(edge, 'smooth');
    return;
  }
  navigatorController.jumpToEdge(edge);
}

function handleJumpControlDoubleClick(edge: ConversationEdge): void {
  if (viewMode === 'myPrompts') {
    scrollNavigatorListToEdge(edge, 'auto');
    return;
  }
  navigatorController.jumpToAbsoluteEdge(edge);
}

function scrollNavigatorListToEdge(
  edge: ConversationEdge,
  behavior: ScrollBehavior = 'smooth'
): void {
  const list = document.getElementById('navigator-list');
  if (!list) return;
  list.scrollTo({
    top: edge === 'top' ? 0 : list.scrollHeight,
    behavior,
  });
}

/**
 * Opens the saved-prompt dialog for a conversation TOC item.
 * @param {Object} message
 */
function handleSavePrompt(message: NavigatorMessage): void {
  myPrompts.showDialog(
    {
      content: message.text,
      title: message.text.slice(0, 30),
    },
    () => {
      if (viewMode !== 'myPrompts') {
        toggleViewMode();
      } else {
        renderCurrentView();
      }
    }
  );
}

function toggleViewMode(): void {
  const button = document.getElementById(
    'toggle-view-mode-btn'
  ) as HTMLButtonElement | null;
  if (!button) return;

  previewTooltip.hide();
  viewMode = viewMode === 'toc' ? 'myPrompts' : 'toc';
  const isMyPrompts = viewMode === 'myPrompts';

  button.classList.toggle('mode-myprompts-active', isMyPrompts);
  button.setAttribute(
    'aria-label',
    isMyPrompts ? 'Switch to Table of Contents' : 'Switch to My Prompts'
  );
  button.title = isMyPrompts
    ? 'Switch to Table of Contents'
    : 'Switch to My Prompts';

  if (!isMyPrompts) {
    const toolbar = document.getElementById('myprompts-toolbar-container');
    if (toolbar) toolbar.innerHTML = '';
  }

  clearSearch();
  setNavigatorTitle();
  renderCurrentView();
}

function getConversationTitle(): string {
  const match = location.pathname.match(/\/c\/([^/]+)/);
  const conversationId = match?.[1];

  if (conversationId) {
    const conversationLink = document.querySelector<HTMLElement>(
      `a[href*="/c/${conversationId}"]`
    );
    const sidebarTitle = conversationLink?.innerText?.trim();
    if (sidebarTitle) return sidebarTitle;
  }

  return (
    document.title
      .replace(/\s*[-–]\s*ChatGPT$/i, '')
      .replace(/^ChatGPT\s*[-–]\s*/i, '')
      .trim() || 'ChatTOC'
  );
}

function setNavigatorTitle(): void {
  const title = document.getElementById('navigator-title');
  if (!title) return;
  title.textContent =
    viewMode === 'myPrompts' ? 'MY PROMPTS' : getConversationTitle();
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

function initJumpControlsPositioning(): void {
  const jumpControls = document.querySelector<HTMLElement>(
    '.navigator-jump-controls'
  );
  if (!jumpControls) return;
  const controls = jumpControls;

  restoreJumpControlsPosition(controls);
  window.addEventListener('resize', () => {
    keepJumpControlsInViewport(controls);
  });
  controls.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
    event.preventDefault();

    const rect = controls.getBoundingClientRect();
    const startY = event.clientY;
    const startTop = rect.top;
    let didDrag = false;

    controls.setPointerCapture(event.pointerId);
    controls.classList.add('navigator-jump-controls-dragging');

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaY = moveEvent.clientY - startY;
      if (!didDrag && Math.abs(deltaY) < 4) return;
      didDrag = true;
      setJumpControlsPosition(
        controls,
        clampJumpControlsTop(startTop + deltaY, rect.height)
      );
    }

    function handlePointerUp(): void {
      try {
        controls.releasePointerCapture(event.pointerId);
      } catch {}

      controls.classList.remove('navigator-jump-controls-dragging');
      controls.removeEventListener('pointermove', handlePointerMove);
      controls.removeEventListener('pointerup', handlePointerUp);
      controls.removeEventListener('pointercancel', handlePointerUp);
      if (didDrag) saveJumpControlsPosition(controls);
    }

    controls.addEventListener('pointermove', handlePointerMove);
    controls.addEventListener('pointerup', handlePointerUp);
    controls.addEventListener('pointercancel', handlePointerUp);
  });
}

function saveJumpControlsPosition(jumpControls: HTMLElement): void {
  const rect = jumpControls.getBoundingClientRect();
  storageSet(JUMP_CONTROLS_POSITION_STORAGE_KEY, {
    topRatio: getJumpControlsTopRatio(rect.top, rect.height),
  });
}

function restoreJumpControlsPosition(jumpControls: HTMLElement): void {
  const savedPosition = storageGet<JumpControlsPosition>(
    JUMP_CONTROLS_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls);
  if (nextTop != null) setJumpControlsPosition(jumpControls, nextTop);
}

function keepJumpControlsInViewport(jumpControls: HTMLElement): void {
  const rect = jumpControls.getBoundingClientRect();
  const savedPosition = storageGet<JumpControlsPosition>(
    JUMP_CONTROLS_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls, rect);
  if (nextTop == null || Math.abs(nextTop - rect.top) < 1) return;
  setJumpControlsPosition(jumpControls, nextTop);
  saveJumpControlsPosition(jumpControls);
}

function setJumpControlsPosition(jumpControls: HTMLElement, top: number): void {
  jumpControls.style.top = `${top}px`;
}

function storageGet<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clampJumpControlsTop(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  return Math.min(maxTop, Math.max(minTop, top));
}

function getJumpControlsTopRatio(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  const range = maxTop - minTop;
  if (range <= 0) return 0;
  return (clampJumpControlsTop(top, height) - minTop) / range;
}

function getSavedJumpControlsTop(
  savedPosition: JumpControlsPosition | null,
  jumpControls: HTMLElement,
  rect?: DOMRect
): number | null {
  if (!savedPosition) return null;
  const panelRect = rect || jumpControls.getBoundingClientRect();

  if (
    typeof savedPosition.topRatio === 'number' &&
    Number.isFinite(savedPosition.topRatio)
  ) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - panelRect.height - 8);
    return clampJumpControlsTop(
      minTop + savedPosition.topRatio * (maxTop - minTop),
      panelRect.height
    );
  }
  if (
    typeof savedPosition.top === 'number' &&
    Number.isFinite(savedPosition.top)
  ) {
    return clampJumpControlsTop(savedPosition.top, panelRect.height);
  }
  return null;
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
 * Starts the application after all feature and controller scripts load.
 */
export async function initializeApplication(): Promise<void> {
  await initializeNavigationSettings();
  initTheme();
  navigatorController.init({
    onRouteChanged() {
      clearSearch();
      setNavigatorTitle();
    },
    onSavePrompt: handleSavePrompt,
    onTitleChanged: setNavigatorTitle,
  });
  const sidebar = await createSidebar();
  initSidebarResize(sidebar);
  initJumpControlsPositioning();

  const toggleButton = createToggleButton();
  initializeSidebarVisibility(sidebar, toggleButton);
  previewTooltip.init({ anchorSelector: '#navigator-list' });
  buttonTooltip.init();
  myPrompts.initAutocomplete();
  navigatorController.attach();

  myPrompts.onPromptsChanged(() => {
    if (viewMode !== 'myPrompts' || myPromptsRefreshQueued) return;
    myPromptsRefreshQueued = true;
    queueMicrotask(() => {
      myPromptsRefreshQueued = false;
      if (viewMode === 'myPrompts') renderCurrentView();
    });
  });
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Required application element not found: #${id}`);
  }
  return element as T;
}
