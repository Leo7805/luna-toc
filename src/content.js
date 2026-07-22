/**
 * LunaTOC content script entry point.
 */
import './features/tooltip.js';
import './features/toggleButton.js';
import './features/sidebarVisibility.js';
import './app/navigatorController.js';
import './app/applicationShell.js';

window.LunaTocApplicationShell.init();
