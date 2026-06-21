/**
 * popup.js
 * Controls the theme toggle in the ChatTOC popup.
 * Persists the selected theme in chrome.storage.local so that
 * the content script can read it and apply data-theme to the page.
 */

const STORAGE_KEY = 'chatToc:theme';
const DEFAULT_THEME = 'dark';

const darkBtn = document.getElementById('theme-dark-btn');
const lightBtn = document.getElementById('theme-light-btn');

/**
 * Applies a theme to the popup body and updates button active states.
 * @param {'dark' | 'light'} theme
 */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  darkBtn.classList.toggle('theme-btn-active', theme === 'dark');
  lightBtn.classList.toggle('theme-btn-active', theme === 'light');
}

/**
 * Saves the theme to storage and notifies all ChatGPT tabs to update.
 * @param {'dark' | 'light'} theme
 */
function setTheme(theme) {
  applyTheme(theme);
  chrome.storage.local.set({ [STORAGE_KEY]: theme });
}

// Initialize popup with stored theme
chrome.storage.local.get(STORAGE_KEY, (result) => {
  const theme = result[STORAGE_KEY] || DEFAULT_THEME;
  applyTheme(theme);
});

darkBtn.addEventListener('click', () => setTheme('dark'));
lightBtn.addEventListener('click', () => setTheme('light'));
