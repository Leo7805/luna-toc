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
  sidebar.id = 'luna-toc-sidebar';
  sidebar.className = 'luna-toc-navigator-initializing';
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
          <button id="navigator-title" type="button" aria-label="Reset TOC view">
            ${escapeHtml(getConversationTitle())}
          </button>
          <button
            class="navigator-icon-btn navigator-header-icon-btn"
            id="search-toggle-btn"
            type="button"
            aria-label="Toggle search"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
        <p class="navigator-hint">${NAVIGATOR_EMPTY_HINT_TEXT}</p>
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

function initSidebarResize(sidebar: HTMLElement): void {
  const resizer = document.getElementById('navigator-resizer');
  if (!resizer) return;

  resizer.addEventListener('mousedown', (event: MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    function handleMouseMove(moveEvent: MouseEvent): void {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(520, Math.max(240, startWidth + delta));
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
