/**
 * Popup entry point.
 * Controls the theme toggle in the ChatTOC popup.
 * Persists the selected theme in chrome.storage.local so that
 * the content script can read it and apply data-theme to the page.
 */

const STORAGE_KEY = 'chatToc:theme';
const DEFAULT_THEME = 'dark';
type Theme = 'dark' | 'light';

const darkBtn = getRequiredButton('theme-dark-btn');
const lightBtn = getRequiredButton('theme-light-btn');

/**
 * Applies a theme to the popup body and updates button active states.
 * @param {'dark' | 'light'} theme
 */
function applyTheme(theme: Theme): void {
  document.body.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  darkBtn.classList.toggle('theme-btn-active', theme === 'dark');
  lightBtn.classList.toggle('theme-btn-active', theme === 'light');
}

/**
 * Saves the theme to storage and notifies all ChatGPT tabs to update.
 * @param {'dark' | 'light'} theme
 */
function setTheme(theme: Theme): void {
  applyTheme(theme);
  chrome.storage.local.set({ [STORAGE_KEY]: theme });
}

// Initialize popup with stored theme
chrome.storage.local.get(STORAGE_KEY, (result) => {
  const storedTheme = result[STORAGE_KEY];
  const theme: Theme = storedTheme === 'light' ? 'light' : DEFAULT_THEME;
  applyTheme(theme);
});

darkBtn.addEventListener('click', () => setTheme('dark'));
lightBtn.addEventListener('click', () => setTheme('light'));

function getRequiredButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Required popup button not found: #${id}`);
  }
  return element;
}
