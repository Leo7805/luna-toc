# ChatTOC Architecture

This document describes the design, context boundaries, and module coordination of the ChatTOC Chrome extension.

## Overview

ChatTOC is a Chrome Extension that inserts a table-of-contents sidebar into ChatGPT's chat interface, helping users navigate long conversations and keep track of prompts.

---

## 1. Context Boundaries & Injection Model

Because Chrome Extensions run content scripts in an **Isolated World** (preventing direct access to the page's Javascript variables and window functions), ChatTOC splits its logic into two execution worlds:

```mermaid
graph TD
    manifest[manifest.json]
    vite[Vite + CRXJS]

    subgraph sourceModules["Source Modules"]
        content[content.js]
        outline[outline.js]
        follow[follow.js]
        jump[jump.js]
        msg[message.js]
        mark[promptMark.js]
        vis[sidebarVisibility.js]
        btn[toggleButton.js]
        tip[tooltip.js]
        navigator[navigatorController.js]
        shell[applicationShell.js]
    end

    subgraph isolatedWorld["Isolated World"]
        contentBundle[dist content bundle]
    end

    subgraph mainWorld["Main World (Page Context)"]
        hook[pageHook.iife.js]
        chatgpt[ChatGPT Application]
    end

    manifest --> vite
    content --> outline
    content --> follow
    content --> jump
    content --> shell
    shell --> navigator
    vite --> contentBundle
    vite --> hook
    hook ===>|window.postMessage| navigator
    chatgpt -.->|Fetch API / History API| hook
```

### Main World (`pageHook.iife.js`)

- **Purpose**: Declared as a `MAIN` world IIFE content script and injected by Chrome at `document_start`. It intercepts ChatGPT's own native API calls and events.
- **Responsibilities**:
  1. **Fetch Hooking**: Overrides `window.fetch` to intercept chat history payloads (`/backend-api/conversation/*`) and SSE streamed responses (`/backend-api/f/conversation`), posting raw message data back to the Isolated World.
  2. **History Hooking**: Overrides `history.pushState` and `history.replaceState` to notify the content script of SPA route transitions.
  3. **Media Query Spoofing**: Proxies `window.matchMedia` and responsive listeners to fake a wide viewport (e.g. `1400px`), forcing ChatGPT's React app to keep its native navigation buttons mounted even when the user resizes or splits their screen.

### Isolated World (Content Scripts)

- **Purpose**: `src/content.js` is declared in `manifest.json` and runs in a sandboxed context where it can access the DOM and Chrome APIs but not ChatGPT's global JavaScript scope.
- **Loading**: `src/content.js` imports the feature modules in dependency order. Vite bundles that graph into one generated Content Script; only the entry remains in the source Manifest.
- **Source modules**:
  - [outline.js](../src/features/outline.js): Extracts header trees (`H1`-`H6`) from assistant answers and manages outline expands/collapses.
  - [follow.js](../src/features/follow.js): Manages scroll tracking on the chat feed and coordinates when the sidebar is allowed to auto-scroll.
  - [message.ts](../src/features/conversationPrompts/message.ts): Defines typed ChatGPT conversation models and normalizes user inputs, files, and images into TOC messages.
  - [promptMark.ts](../src/features/conversationPrompts/promptMark.ts): Provides typed session-scoped prompt marking and mark-button behavior through named exports.
  - [jump.js](../src/features/jump.js): Controls smooth scrolling to messages, utilizing ChatGPT's native buttons (primary) or direct DOM `scrollIntoView` (fallback).
  - [tooltip.js](../src/features/tooltip.js): Shows full-text preview tooltips for truncated prompt lines.
  - [toggleButton.js](../src/features/toggleButton.js): Manages the floating circular toggle button and session-bound drag position.
  - [sidebarVisibility.js](../src/features/sidebarVisibility.js): Manages sidebar showing, auto-hiding, pinning, and inert accessibility state.
  - [promptStore.ts](../src/features/myPrompts/promptStore.ts): Defines the saved-prompt model and provides typed persistence, caching, and change notifications.
  - [promptLibrary.ts](../src/features/myPrompts/promptLibrary.ts): Manages the saved prompt list, dialogs, CRUD operations, sorting, import, and export through named exports.
  - [promptAutocomplete.ts](../src/features/myPrompts/promptAutocomplete.ts): Manages composer matching, autocomplete UI, keyboard navigation, and prompt insertion through named exports.
  - [myPrompts.ts](../src/features/myPrompts/myPrompts.ts): Composes the typed My Prompts modules and exports the unified `myPrompts` API consumed by the application shell.
  - [navigatorController.js](../src/app/navigatorController.js): Owns conversation data, TOC rendering, prompt navigation coordination, route resets, and active-prompt tracking.
  - [applicationShell.js](../src/app/applicationShell.js): Creates the sidebar shell, manages view modes and shared UI, and initializes the feature modules.
  - [content.js](../src/content.js): Imports the isolated-world modules and starts the application shell.

### Build Outputs

- `manifest.json` is the source Manifest and authoritative extension version.
- `vite.config.js` uses Vite and CRXJS to discover the Chrome extension entries.
- `dist/manifest.json` is generated for Chrome and rewrites source entry paths to built assets.
- `dist/` is generated and ignored by Git; run `npm run build` before loading or packaging the extension.
- TypeScript is configured with `allowJs` so source files can migrate from JavaScript incrementally.

---

## 2. Communication Protocol

Data flows from the page's Hook script to the content script using window messages:

- `CHATGPT_CONVERSATION_DATA`: Sends the full JSON conversation tree on page load or full conversation update.
- `CHATGPT_NEW_USER_MESSAGE`: Streams newly submitted user prompts in real-time.
- `CHATGPT_ROUTE_CHANGED`: Dispatched instantly when a routing URL transition takes place.
- `CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF`: Sent from the content script to toggle media query spoofing on/off when the sidebar visibility state toggles.
