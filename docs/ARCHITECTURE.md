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
        content[content.ts]
        outline[outline.ts]
        outlineNavigation[outlineNavigation.ts]
        follow[follow.ts]
        promptNavigation[promptNavigation.ts]
        navigationData[navigationData.ts]
        chatGptAdapter[ChatGPT navigationAdapter.ts]
        msg[message.ts]
        mark[promptMark.ts]
        vis[sidebarVisibility.ts]
        btn[toggleButton.ts]
        tip[tooltip.ts]
        navigator[navigatorController.ts]
        shell[applicationShell.ts]
        popup[popup.tsx]
    end

    subgraph isolatedWorld["Isolated World"]
        contentBundle[dist content bundle]
    end

    subgraph mainWorld["Main World (Page Context)"]
        hook[pageHook.iife.ts]
        chatgpt[ChatGPT Application]
    end

    manifest --> vite
    content --> shell
    shell --> navigator
    shell --> vis
    shell --> btn
    shell --> tip
    navigator --> outline
    navigator --> promptNavigation
    chatGptAdapter --> navigationData
    navigator --> follow
    outline --> outlineNavigation
    outlineNavigation --> promptNavigation
    promptNavigation --> follow
    vite --> contentBundle
    vite --> hook
    hook ===>|window.postMessage| navigator
    chatgpt -.->|Fetch API / History API| hook
```

### Main World (`pageHook.iife.ts`)

- **Purpose**: Declared as a `MAIN` world IIFE content script and injected by Chrome at `document_start`. It intercepts ChatGPT's own native API calls and events.
- **Responsibilities**:
  1. **Fetch Hooking**: Overrides `window.fetch` to intercept chat history payloads (`/backend-api/conversation/*`) and SSE streamed responses (`/backend-api/f/conversation`), posting raw message data back to the Isolated World.
  2. **History Hooking**: Overrides `history.pushState` and `history.replaceState` to notify the content script of SPA route transitions.
  3. **Media Query Spoofing**: Proxies `window.matchMedia` and responsive listeners to fake a wide viewport (e.g. `1400px`), forcing ChatGPT's React app to keep its native navigation buttons mounted even when the user resizes or splits their screen.

### Isolated World (Content Scripts)

- **Purpose**: `src/content.ts` is declared in `manifest.json` and runs in a sandboxed context where it can access the DOM and Chrome APIs but not ChatGPT's global JavaScript scope.
- **Loading**: `src/content.ts` starts the application shell, and each module imports its explicit dependencies. Vite bundles that graph into one generated Content Script; only the entry remains in the source Manifest.
- **Source modules**:
  - [outline.ts](../src/features/navigation/outline.ts): Extracts, caches, renders, and expands answer-heading child outlines.
  - [outlineNavigation.ts](../src/features/navigation/outlineNavigation.ts): Navigates from a displayed child-outline item to its live ChatGPT heading, restoring the parent prompt first when needed.
  - [follow.ts](../src/features/navigation/follow.ts): Provides typed chat-scroll tracking and sidebar auto-follow control through named exports.
  - [message.ts](../src/features/conversationPrompts/message.ts): Defines typed ChatGPT conversation models and normalizes user inputs, files, and images into TOC messages.
  - [promptMark.ts](../src/features/conversationPrompts/promptMark.ts): Provides typed session-scoped prompt marking and mark-button behavior through named exports.
  - [promptNavigation.ts](../src/features/navigation/promptNavigation.ts): Provides the replaceable main-prompt navigation boundary, currently using ChatGPT's native buttons first and DOM/virtualized-scroll fallbacks second.
  - [navigationData.ts](../src/features/navigation/navigationData.ts): Defines platform-independent prompt/response turns for future fingerprinting and navigation algorithms.
  - [navigationAdapter.ts](../src/platforms/chatgpt/navigationAdapter.ts): Converts ChatGPT's active conversation branch into generic navigation turns while excluding tool and attachment content from AI responses.
  - [tooltip.ts](../src/features/tooltip.ts): Provides typed preview-tooltip and button-tooltip APIs through named exports.
  - [toggleButton.ts](../src/features/toggleButton.ts): Provides the typed floating toggle-button factory and session-bound drag positioning.
  - [sidebarVisibility.ts](../src/features/sidebarVisibility.ts): Provides typed sidebar showing, auto-hiding, pinning, and inert accessibility control.
  - [promptStore.ts](../src/features/myPrompts/promptStore.ts): Defines the saved-prompt model and provides typed persistence, caching, and change notifications.
  - [promptUsageStore.ts](../src/features/myPrompts/promptUsageStore.ts): Persists autocomplete usage counts and last-used timestamps separately from exportable prompt content.
  - [promptLibrary.ts](../src/features/myPrompts/promptLibrary.ts): Manages the saved prompt list, persistence operations, legacy confirmation dialogs, sorting, import, and export through named exports.
  - [promptEditor.ts](../src/features/myPrompts/promptEditor.ts): Bridges the legacy My Prompts API to the React create/edit dialog without coupling React components to storage.
  - [promptAutocomplete.ts](../src/features/myPrompts/promptAutocomplete.ts): Manages ChatGPT composer matching, keyboard navigation, menu positioning data, and prompt insertion through named exports.
  - [promptAutocompleteView.ts](../src/features/myPrompts/promptAutocompleteView.ts): Bridges composer autocomplete state to the React suggestion menu.
  - [myPrompts.ts](../src/features/myPrompts/myPrompts.ts): Composes the typed My Prompts modules and exports the unified `myPrompts` API consumed by the application shell.
  - [navigatorController.ts](../src/app/navigatorController.ts): Provides typed conversation data, TOC rendering, prompt navigation coordination, route resets, and active-prompt tracking.
  - [applicationShell.ts](../src/app/applicationShell.ts): Provides the typed sidebar shell, view-mode coordination, shared UI, and application initializer.
  - [content.ts](../src/content.ts): Calls the application initializer as the minimal Isolated World entry.
  - [themeSettings.ts](../src/features/theme/themeSettings.ts): Defines, persists, and migrates the follow/manual theme preference shared by the Popup and Content Script.
  - [chatGptTheme.ts](../src/features/theme/chatGptTheme.ts): Detects ChatGPT's resolved root-class theme and shares the latest value with the Popup.
  - [popup.tsx](../src/popup/popup.tsx): Mounts the React Popup application.

### React UI Foundation

- React is introduced incrementally: existing DOM-driven features remain unchanged until their individual UI boundaries are migrated.
- [components/ui](../src/components/ui) contains shadcn/ui primitives; feature-specific and shared React components will live in sibling component directories.
- [reactHost.tsx](../src/reactHost/reactHost.tsx) owns the React Shadow Root, injects the compiled Tailwind stylesheet, and exposes the internal Portal container.
- [PromptEditorDialog.tsx](../src/components/my-prompts/PromptEditorDialog.tsx) renders the first migrated My Prompts interface while saving remains in the feature layer.
- [PromptAutocomplete.tsx](../src/components/my-prompts/PromptAutocomplete.tsx) renders matched prompts at viewport coordinates supplied by the composer feature.
- [PopupApp.tsx](../src/components/popup/PopupApp.tsx) renders the extension Popup, including the follow-ChatGPT and manual theme controls.
- Popup layout and component styling use Tailwind utilities; `popup.css` remains the Tailwind entry and retains only theme tokens and document-level base rules.
- `@/` resolves to the entire `src/` directory for browser code, React components, styles, and utilities.
- Tailwind CSS is loaded as an inline string inside the React Shadow Root, so generated global rules cannot affect ChatGPT or the legacy Content Script UI.
- shadcn theme variables are scoped to `.luna-toc-ui`, which is applied to both the React and Portal containers inside the Shadow Root.
- The React host mirrors the document's `data-theme` value onto itself so Shadow DOM components follow LunaTOC theme changes without selecting across the boundary.

### Build Outputs

- `src/config/config.ts` centralizes compile-time values intended for deliberate project tuning; runtime user preferences remain in their existing storage modules.
- Pure logic tests live under `test/`, run with Vitest in a Node environment, and use the same `@/` source alias as browser code.
- `manifest.json` is the source Manifest and authoritative extension version.
- `vite.config.ts` uses Vite and CRXJS to discover extension entries and cleans source extensions from generated entry names after CRXJS finishes writing the build.
- `dist/manifest.json` is generated for Chrome and rewrites source entry paths to built assets.
- `dist/` is generated and ignored by Git; run `npm run build` before loading or packaging the extension.
- All executable files under `src/` are TypeScript; Chrome runs only the JavaScript generated in `dist/`.
- `src/content.ts` starts both the legacy application shell and the isolated React host; the Tailwind entry is imported only by the React host using Vite's `?inline` query.
- `scripts/version.ts` is executed through `tsx`, while `tsconfig.node.json` strictly checks Node-side tooling separately from browser code.

---

## 2. Communication Protocol

Data flows from the page's Hook script to the content script using window messages:

- `CHATGPT_CONVERSATION_DATA`: Sends the full JSON conversation tree on page load or full conversation update.
- `CHATGPT_NEW_USER_MESSAGE`: Streams newly submitted user prompts in real-time.
- `CHATGPT_ROUTE_CHANGED`: Dispatched instantly when a routing URL transition takes place.
- `CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF`: Sent from the content script to toggle media query spoofing on/off when the sidebar visibility state toggles.
