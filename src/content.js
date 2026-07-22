/**
 * LunaTOC content script entry point.
 */
import './features/outline.js';
import './features/follow.js';
import './features/conversationPrompts/message.js';
import './features/conversationPrompts/promptMark.js';
import './features/jump.js';
import './features/tooltip.js';
import './features/toggleButton.js';
import './features/sidebarVisibility.js';
import './app/navigatorController.js';
import './app/applicationShell.js';

window.LunaTocApplicationShell.init();
