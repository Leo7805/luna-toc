/**
 * @vitest-environment jsdom
 * Regression tests for real ChatGPT main-column targeting and fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest runs on Node; browser tsconfig intentionally omits Node typings.
import { readFileSync } from 'node:fs';
import {
  initializeChatGptSideBySide,
  syncChatGptSideBySide,
  disposeChatGptSideBySide,
  setChatGptSideBySideEnabled,
} from '@/features/sidebar/chatGptSideBySide';

const stylesheet = readFileSync('src/styles/content.css', 'utf8');
const SIDE_BY_SIDE = 'luna-toc-chat-side-by-side';
const WIDTH = '--luna-toc-reserved-sidebar-width';

function setupHost(): {
  root: HTMLElement;
  main: HTMLElement;
  nativeSidebar: HTMLElement;
  sidebar: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="root" style="width: 100vw">
      <nav id="chatgpt-native-nav"></nav>
      <main id="chatgpt-main" style="width: 100vw">
        <div id="thread"><article data-turn="assistant"></article></div>
        <div id="thread-bottom-container"><form id="chatgpt-composer"></form></div>
      </main>
    </div>
    <aside id="luna-toc-sidebar" class="luna-toc-navigator-hidden" aria-hidden="true"></aside>
    <div id="luna-toc-react-host"></div>
  `;
  const root = document.getElementById('root')!;
  const nativeSidebar = document.getElementById('chatgpt-native-nav')!;
  const main = document.getElementById('chatgpt-main')!;
  const sidebar = document.getElementById('luna-toc-sidebar')!;
  sidebar.style.setProperty('--navigator-width', '300px');
  return { root, main, nativeSidebar, sidebar };
}

function openSidebar(sidebar: HTMLElement): void {
  sidebar.classList.remove('luna-toc-navigator-hidden');
  sidebar.setAttribute('aria-hidden', 'false');
  setChatGptSideBySideEnabled(true);
  syncChatGptSideBySide();
}

function closeSidebar(sidebar: HTMLElement): void {
  sidebar.classList.add('luna-toc-navigator-hidden');
  sidebar.setAttribute('aria-hidden', 'true');
  syncChatGptSideBySide();
}

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true, value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => setViewportWidth(1200));

afterEach(() => {
  disposeChatGptSideBySide();
  if (originalInnerWidth) {
    Object.defineProperty(window, 'innerWidth', originalInnerWidth);
  }
  document.body.textContent = '';
});

describe('ChatGPT app beside LunaTOC sidebar', () => {
  it('targets the actual main including composer, not the outer #root', () => {
    const { root, main, nativeSidebar, sidebar } = setupHost();
    initializeChatGptSideBySide(sidebar);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);

    openSidebar(sidebar);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(true);
    expect(main.style.getPropertyValue(WIDTH)).toBe('300px');
    expect(root.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(root.style.getPropertyValue(WIDTH)).toBe('');
    expect(nativeSidebar.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(main.querySelector('#chatgpt-composer')).not.toBeNull();

    sidebar.style.setProperty('--navigator-width', '450px');
    syncChatGptSideBySide();
    expect(main.style.getPropertyValue(WIDTH)).toBe('450px');

    closeSidebar(sidebar);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(main.style.getPropertyValue(WIDTH)).toBe('');
    expect(main.style.width).toBe('100vw');
  });

  it('leaves the host layout alone in overlay mode even when the sidebar opens', () => {
    const { main, sidebar } = setupHost();
    initializeChatGptSideBySide(sidebar);
    sidebar.classList.remove('luna-toc-navigator-hidden');
    sidebar.setAttribute('aria-hidden', 'false');
    syncChatGptSideBySide();
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
    setChatGptSideBySideEnabled(true);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(true);
    setChatGptSideBySideEnabled(false);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
  });

  it('does not scan the chat DOM for streaming mutations in overlay mode', async () => {
    const { main, sidebar } = setupHost();
    initializeChatGptSideBySide(sidebar);
    const scan = vi.spyOn(document.body, 'querySelectorAll');
    main.querySelector('#thread')!.appendChild(document.createElement('span'));
    await Promise.resolve();
    expect(scan).not.toHaveBeenCalled();
    scan.mockRestore();
  });

  it('falls back to overlay in narrow windows and reapplies layout on resize', () => {
    const { main, sidebar } = setupHost();
    initializeChatGptSideBySide(sidebar);
    openSidebar(sidebar);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(true);

    setViewportWidth(859);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);

    setViewportWidth(860);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(true);

    setViewportWidth(700);
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(main.style.getPropertyValue(WIDTH)).toBe('');
  });

  it('never changes body, native navigation, or unrelated pages without a main', () => {
    document.body.innerHTML = `
      <aside id="luna-toc-sidebar" aria-hidden="false"></aside>
      <div id="luna-toc-react-host"></div>
      <div id="unrelated-web-app"></div>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    sidebar.style.setProperty('--navigator-width', '300px');
    initializeChatGptSideBySide(sidebar);
    expect(document.querySelector('.luna-toc-chat-side-by-side')).toBeNull();
    expect(document.body.style.width).toBe('');
    expect(document.getElementById('luna-toc-react-host')?.className).toBe('');
    expect(document.getElementById('unrelated-web-app')?.className).toBe('');
  });

  it('handles a replaced nested main after SPA navigation', async () => {
    const { root, main, sidebar } = setupHost();
    initializeChatGptSideBySide(sidebar);
    openSidebar(sidebar);

    const replacement = document.createElement('main');
    replacement.id = 'replacement-main';
    replacement.innerHTML = '<div id="thread-bottom-container"><form></form></div>';
    root.replaceChild(replacement, main);

    await Promise.resolve();
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(replacement.classList.contains(SIDE_BY_SIDE)).toBe(true);
    expect(replacement.style.getPropertyValue(WIDTH)).toBe('300px');
  });

  it('shrinks the common chat column when its header is a sibling of main', () => {
    const { root, main, nativeSidebar, sidebar } = setupHost();
    const chatColumn = document.createElement('div');
    chatColumn.id = 'chatgpt-chat-column';
    const header = document.createElement('header');
    header.id = 'chatgpt-conversation-header';
    root.insertBefore(chatColumn, main);
    chatColumn.append(header, main);

    initializeChatGptSideBySide(sidebar);
    openSidebar(sidebar);

    expect(chatColumn.classList.contains(SIDE_BY_SIDE)).toBe(true);
    expect(chatColumn.style.getPropertyValue(WIDTH)).toBe('300px');
    expect(main.classList.contains(SIDE_BY_SIDE)).toBe(false);
    expect(chatColumn.contains(header)).toBe(true);
    expect(nativeSidebar.classList.contains(SIDE_BY_SIDE)).toBe(false);

    closeSidebar(sidebar);
    expect(chatColumn.classList.contains(SIDE_BY_SIDE)).toBe(false);
  });

  it('uses a role=main fallback for a host with nonsemantic markup', () => {
    document.body.innerHTML = `
      <div id="root"><div role="main" id="chatgpt-main">
        <div id="thread-bottom-container"></div>
      </div></div>
      <aside id="luna-toc-sidebar" aria-hidden="false"
             style="--navigator-width: 300px"></aside>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    const chatMain = document.getElementById('chatgpt-main')!;
    initializeChatGptSideBySide(sidebar);
    setChatGptSideBySideEnabled(true);
    expect(chatMain.classList.contains(SIDE_BY_SIDE)).toBe(true);
    expect(document.getElementById('root')?.classList.contains(SIDE_BY_SIDE)).toBe(false);
  });

  it('contains host CSS rules that shrink the content main rather than the root', () => {
    expect(stylesheet).toMatch(
      /\.luna-toc-chat-side-by-side\s*\{[^}]*width:\s*auto\s*!important;/s
    );
    expect(stylesheet).toMatch(
      /\.luna-toc-chat-side-by-side\s*\{[^}]*max-width:\s*calc\(100% - var\(--luna-toc-reserved-sidebar-width\)\)\s*!important;/s
    );
    expect(stylesheet).toMatch(
      /\.luna-toc-chat-side-by-side\s*\{[^}]*margin-right:\s*var\(--luna-toc-reserved-sidebar-width\)\s*!important;/s
    );
  });
});
