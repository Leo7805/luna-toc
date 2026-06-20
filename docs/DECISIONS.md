# Architectural Decisions Log

This document records the key architectural decisions, rationale, and consequences for ChatTOC.

---

## ADR 01: Session-Bound State Storage (sessionStorage)
* **Date**: 2026-06-19

### Context
We needed to decide how to persist user-facing state, including marked/starred prompts, sidebar pin status, and the floating toggle button's dragged coordinates. The manifest requested the `"storage"` extension permission, but it was unused.

### Decision
Keep all state stored in standard browser `sessionStorage` (scoped to the tab session) rather than migrating to persistent `chrome.storage.local`. 

### Rationale
These states are intentionally designed to be session-bound and scoped to the active tab. Storing them permanently across browser restarts or sharing them globally across tabs is undesirable for the desired UX of this extension.

### Consequences
* The unused `"storage"` permission was removed from `manifest.json` to prevent Chrome Web Store review warnings/rejections.
* Marked prompts and positions will continue to reset when the tab is closed.

---

## ADR 02: Event-Driven SPA Routing Detection
* **Date**: 2026-06-19

### Context
ChatGPT is a Single Page Application (SPA). To refresh the sidebar when a user clicks a different conversation, the content script previously ran a `setInterval` polling check on `location.pathname` every 250ms.

### Decision
Hijack the HTML5 History API (`history.pushState` and `history.replaceState`) in the main page context (`pageHook.js`) and notify the content script via `window.postMessage`, combined with a standard `'popstate'` listener in `content.js` for browser navigation.

### Rationale
Polling timers keep the CPU awake, which degrades system idle states and laptop battery life. Event-driven hooks execute 0% code when idle, and trigger the refresh instantly without the up to 250ms lag of polling.

### Consequences
* The polling timer was completely removed from the codebase.
* Router updates are now instantaneous and zero-overhead.

---

## ADR 03: Element-Based Viewport Edge Scrolling (Fallback)
* **Date**: 2026-06-19

### Context
If ChatGPT's native navigation outline buttons cannot be found in the DOM, jumping to the top or bottom of the chat fell back to `window.scrollTo`. However, ChatGPT locks the page window height at `100vh` and scrolls a nested division container instead. Thus, `window.scrollTo` had no scrolling effect.

### Decision
Query the first/last user prompt messages in the DOM (`[data-message-author-role="user"]`) and call `.scrollIntoView({ behavior: 'smooth', block: 'center' })` on them as the fallback.

### Rationale
`scrollIntoView()` automatically instructs the browser to find whichever nested parent container is actually scrollable and scroll it, making the fallback robust and container-selector agnostic.

### Consequences
* Fallback edge-jumping now functions correctly even if ChatGPT modifies its layout containers.
* The extension maintains its primary path of clicking ChatGPT's native navigation buttons (which supports React virtualized list mounting) and only falls back to element-based scrolling when native buttons are absent.

---

## ADR 04: Persistent Prompts Manager ("My Prompts") and Autocompleter
* **Date**: 2026-06-19

### Context
Users need a way to persistently save custom prompt templates (surviving browser restarts and tab closures), manage them inside the sidebar, quickly add existing prompts to their personal collection, and easily autocomplete/reuse them inside ChatGPT's text input box.

### Decision
1. **Persistent Storage**: Use `chrome.storage.local` to store templates under the key `chatToc:myPrompts` (re-adding `"storage"` permission in the manifest).
2. **Sorting & Filtering**: Provide 4 sorting filters (Alphabetical A-Z/Z-A, Update Time Asc/Desc) inside the My Prompts view.
3. **Right-Click Quick Add**: Intercept `contextmenu` events on the TOC list item and directly open the Create Custom Prompt modal pre-filled with the prompt's content, avoiding UI clutter from redundant hover buttons.
4. **Autocomplete Overlay**: Listen to the `input` event on ChatGPT's `#prompt-textarea`. Trigger autocomplete overlays on a slash command (`//` or `#`) or when matching prompt titles, and insert contents using `document.execCommand('insertText')` to integrate with React's state management.

### Rationale
* Autocomplete increases text insertion speed and fits current typing workflows.
* Right-click straight to the creation modal reduces UI clutter in the sidebar.
* Storing prompts in `chrome.storage.local` matches the expectation of a permanent user-defined database, unlike session-bound states.

### Consequences
* `"storage"` permission was restored in `manifest.json`.
* New file `myPrompts.js` was introduced to isolate prompts management and keep content.js focused on TOC layout.
* Storage is automatically migrated from `chatToc:favorites` to `chatToc:myPrompts` on first load.
