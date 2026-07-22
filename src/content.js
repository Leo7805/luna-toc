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
import './features/myPrompts/promptStore.js';
import './features/myPrompts/promptLibrary.js';
import './features/myPrompts/promptAutocomplete.js';
import './features/myPrompts/myPrompts.js';
import './app/navigatorController.js';
import './app/applicationShell.js';

window.LunaTocApplicationShell.init();
