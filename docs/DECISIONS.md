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
* Sidebar pin status is shared by every conversation in the same tab session;
  switching conversations or creating a conversation from a new chat does not
  change it.

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

## ADR 03: Fallback Navigation Without Native Prompt Buttons
* **Date**: 2026-06-19
* **Updated**: 2026-06-27

### Context
If ChatGPT's native navigation outline buttons cannot be found in the DOM, jumping to the top or bottom of the chat fell back to `window.scrollTo`. However, ChatGPT locks the page window height at `100vh` and scrolls a nested division container instead. Thus, `window.scrollTo` had no scrolling effect.

ChatGPT can also virtualize long conversations before its native prompt navigator appears. In that state, only a subset of user prompt nodes exists in the DOM, so index-based `scrollIntoView()` fallbacks can target the wrong rendered prompt or fail to find the target.

### Decision
Keep ChatGPT's native prompt navigator as the preferred path whenever its buttons exist.

When native prompt buttons are unavailable:

* Top/bottom controls scroll the detected ChatGPT scroll container directly to its absolute edge.
* Text prompt navigation first tries to match currently rendered DOM text, then performs a bounded virtual-list scan by scrolling until the target prompt text is rendered.
* Index-based DOM fallback is only used when all conversation prompts are currently rendered.

### Rationale
Native prompt buttons remain the only reliable way to navigate virtualized file/image prompts, so they stay first priority. Direct scroll-container edge jumps are more reliable than `scrollIntoView()` when the first or last prompt is not currently rendered. Text-based bounded scanning handles the virtualized/no-native-TOC gap without relying on inaccurate scroll-height ratios.

### Consequences
* Top/bottom fallback works even when the first or last prompt is not mounted in the DOM.
* Text prompt fallback can navigate through virtualized conversations when native prompt buttons are absent.
* File/image prompt navigation remains limited without ChatGPT's native prompt buttons because those prompts lack a stable text anchor.

### Independent Navigation Development Mode

ChatGPT navigation is selected by
`APP_CONFIG.platforms.chatgpt.navigationAlgorithm`. The default
`legacy-native` strategy preserves the native-button and legacy scan behavior.
The `independent-virtual` strategy uses only LunaTOC prompt IDs, fingerprints,
anchors, interpolation, and binary search; it does not call the native
ChatGPT TOC or silently fall back to the legacy scanner. Confirmed successful
positions are persisted as bounded anchor hints. Anchors participate only in
the first rough estimate of each search. Later attempts move relative to the
latest recognized Prompt position so ChatGPT virtual-list coordinate rebuilds
cannot reactivate stale absolute coordinates.

---

## ADR 04: Persistent Prompts Manager ("My Prompts") and Autocompleter
* **Date**: 2026-06-19
* **Updated**: 2026-07-22

### Context
Users need a way to persistently save custom prompt templates (surviving browser restarts and tab closures), manage them inside the sidebar, quickly add existing prompts to their personal collection, and easily autocomplete/reuse them inside ChatGPT's text input box.

### Decision
1. **Persistent Storage**: Use `chrome.storage.local` to store templates under the key `chatToc:myPrompts` (re-adding `"storage"` permission in the manifest).
2. **Sorting & Filtering**: Provide 4 sorting filters (Alphabetical A-Z/Z-A, Update Time Asc/Desc) inside the My Prompts view.
3. **Right-Click Quick Add**: Intercept `contextmenu` events on the TOC list item and directly open the Create Custom Prompt modal pre-filled with the prompt's content, avoiding UI clutter from redundant hover buttons.
4. **Autocomplete Overlay**: Listen to the `input` event on ChatGPT's `#prompt-textarea`. Trigger autocomplete overlays on a slash command (`//` or `#`) or when matching prompt titles, and insert contents using `document.execCommand('insertText')` to integrate with React's state management.
5. **Autocomplete Ranking**: Match query text anywhere in prompt titles. Rank
   exact and word-prefix matches first, then usage count, last-used time, and
   title. With an empty query, rank by usage count, last-used time, and title.
   Store usage metadata separately from prompt content.

### Rationale
* Autocomplete increases text insertion speed and fits current typing workflows.
* Right-click straight to the creation modal reduces UI clutter in the sidebar.
* Storing prompts in `chrome.storage.local` matches the expectation of a permanent user-defined database, unlike session-bound states.
* Usage-aware ordering surfaces frequently selected prompts without allowing a
  weaker title match to outrank a stronger one.

### Consequences
* `"storage"` permission was restored in `manifest.json`.
* New file `myPrompts.js` was introduced to isolate prompts management and keep content.js focused on TOC layout.
* Usage metadata is local-only, is not included in prompt exports, and is
  removed on a best-effort basis when its prompt is deleted.

---

## ADR 05: Tab-Scoped Conversation TOC Cache
* **Date**: 2026-07-22

### Context
ChatGPT can restore previously visited conversations from client-side state
without returning another complete conversation mapping. Clearing the TOC on
every SPA route change therefore left revisited conversations without prompts
until a full page refresh.

### Decision
Cache each conversation's normalized user-prompt list and compact fingerprint
index in memory for the current content-script lifetime. Restore prompts
immediately on history navigation, generate fingerprints asynchronously, and
use snapshot revisions to reject stale generation results. Keep new-chat prompt
migration separate so temporary `WEB:` routes retain newly submitted prompts.

### Consequences
* Revisiting a conversation in the same tab restores its TOC immediately.
* Full Assistant responses are not cached; only bounded probes and hashes are.
* New conversation data invalidates the previous fingerprint index without
  delaying prompt rendering.
* Mounted Assistant DOM is collected after a short stabilization delay and
  upgrades the matching response from a derived to an observed fingerprint.
* Rendered messages without a known response ID mapping are ignored instead of
  guessing their prompt ownership.
* Observed DOM text keeps precedence for fingerprint content, while each new
  derived conversation payload remains authoritative for response-to-Prompt
  ownership. Out-of-range ownership is rejected before position matching.
* Virtual position observations use only Assistant elements intersecting the
  chat viewport; offscreen DOM retained by ChatGPT is not treated as visible.
* Prompt snapshots, fingerprints, and unconfirmed search observations are
  discarded on page refresh or tab close.
* Confirmed successful jump anchors may persist in local extension storage as
  bounded hints. They are validated against prompt identity and viewport width,
  expire after 30 days, and never replace live position verification.
* Anchor-cache schema changes invalidate older persisted coordinates rather
  than allowing incompatible positions to influence new searches.

---

## ADR 06: Vite-Based Extension Build
* **Date**: 2026-07-22
* **Updated**: 2026-07-22

### Context
The source was split into focused JavaScript files, but Manifest-declared
classic scripts depended on global `window.ChatToc...` APIs and an implicit
loading order. The growing script array made dependencies difficult to trace
and made later TypeScript adoption unnecessarily expensive.

### Decision
Use Vite with CRXJS to build the extension. Keep `src/content.ts` as the single
Isolated World source entry, and declare `src/page/pageHook.iife.ts` as a
separate `MAIN` world entry at `document_start`. Keep the root `manifest.json`
as the source Manifest and version authority; load the generated `dist/`
directory in Chrome.

Configure TypeScript with `allowJs` so modules can migrate incrementally. The
initial build migration preserves the existing internal global APIs; explicit
named imports and exports are a separate refactor.

The first incremental migration converts the four My Prompts modules to
TypeScript and named imports/exports. `applicationShell.js` now imports the
composed `myPrompts` API directly; unrelated feature globals remain until their
own focused migrations.

The second incremental migration converts conversation message normalization
and prompt marking to TypeScript. `navigatorController.js` imports those APIs
directly, while Outline imports the mark-state query and mark-change updates
are injected as a callback to avoid a circular module dependency.

The third incremental migration converts Follow, Jump, and Outline to
TypeScript. `navigatorController.js` imports their named APIs directly, and the
navigation dependency chain is explicit: Outline depends on Jump, and Jump
depends on Follow.

The fourth incremental migration converts Tooltip, Toggle Button, and Sidebar
Visibility to TypeScript. The application shell and tooltip consumers import
their named APIs directly instead of reading UI helpers from `window`.

The fifth incremental migration converts the Content entry, Application Shell,
and Navigator Controller to TypeScript. `content.ts` calls the exported
application initializer, and the shell imports the controller directly.

The sixth incremental migration converts the Popup and Main World page hook to
TypeScript. With every executable file under `src/` migrated, JavaScript is now
generated only as a build artifact in `dist/`.

The tooling migration converts `vite.config.js` and `scripts/version.js` to
TypeScript. Node-side files use a dedicated strict `tsconfig.node.json`, and
`tsx` runs the npm version lifecycle without changing the public versioning
commands. A post-build naming step removes `.ts` and `.html` from generated
entry chunk names after CRXJS has completed its own bundle and Manifest work.

### Consequences
* Feature source files no longer need individual entries in `manifest.json`.
* The page hook is injected directly by Chrome instead of through a DOM script
  element created by the application shell.
* Development and release installation require `npm run build` and loading
  `dist/` in Chrome.
* `dist/` and `node_modules/` remain untracked generated directories.
* Future JavaScript-to-TypeScript migration can proceed one module at a time.
* My Prompts no longer publishes internal modules or its composed API on
  `window`.
* Conversation message and prompt-mark modules no longer publish APIs on
  `window`.
* Follow, Jump, and Outline no longer publish APIs on `window` or depend on
  source-script loading order.
* Tooltip, Toggle Button, and Sidebar Visibility no longer publish APIs on
  `window` or require side-effect imports from the Content Script entry.
* The Isolated World source graph no longer publishes custom APIs on `window`;
  only the compiled JavaScript bundle is executed by Chrome.
* `allowJs` is no longer needed in the TypeScript configuration because no
  executable JavaScript remains under `src/`.
* Browser code, build configuration, and release tooling are all type-checked.
* Generated entry files use clean names such as `content-<hash>.js` and
  `popup-<hash>.js` while Chrome continues to load only JavaScript from `dist/`.

---

## ADR 07: Incremental React UI Foundation
* **Date**: 2026-07-22

### Context
The extension's imperative DOM code and single large stylesheet make increasingly
stateful interfaces harder to maintain, but a full UI rewrite would add unnecessary
risk to the existing navigation and My Prompts behavior.

### Decision
Adopt React 19 incrementally with Tailwind CSS v4 and shadcn/ui using Base UI.
Keep all React components under `src/components`, with shadcn primitives in
`components/ui` and future shared or feature-specific components in sibling
directories. Map `@/` to the complete `src/` directory.

Keep Tailwind out of the document-level Content Script styles. Load its
compiled stylesheet as an inline string inside a dedicated React Shadow Root,
and scope shadcn theme variables to `.luna-toc-ui`. Keep React portals inside
the same Shadow Root. Existing DOM features and CSS remain in place until each
interface is migrated behind that React boundary.

### Consequences
* React interfaces can be migrated one at a time without rewriting the content
  script or existing feature logic.
* Tailwind and shadcn generated rules cannot modify ChatGPT's document styles.
* Every React mount container must live inside the Shadow Root and include the
  `.luna-toc-ui` class.
* Tailwind class prefixes are unnecessary because the Shadow Root provides the
  CSS boundary.
* Dialogs, popovers, tooltips, and other portals must target the Portal
  container provided by the React host instead of `document.body`.
* Existing relative imports can remain; new modules may use the project-wide
  `@/` alias.
* The My Prompts create/edit dialog is the first migrated React interface. Its
  controller bridges the legacy `showDialog()` API to React, while prompt
  persistence remains in `promptLibrary.ts`.
* The My Prompts composer suggestion menu is rendered by React inside the same
  Shadow Root. Trigger parsing, caret positioning data, keyboard handling, and
  prompt insertion remain in `promptAutocomplete.ts`.
* Autocomplete rows show titles only for faster scanning; prompt content is
  available through the native hover title.

---

## ADR 08: React Popup and Follow-ChatGPT Theme
* **Date**: 2026-07-22

### Context
The static Popup exposed separate Dark and Light buttons and required users to
choose an extension theme independently from ChatGPT. ChatGPT exposes its
resolved theme through the `light` or `dark` class on the document root.

### Decision
Render the Popup with React while preserving its existing Tips and Note visual
design. Store a theme preference containing a follow-ChatGPT flag and the last
manual Dark/Light choice. Detect and observe ChatGPT's root class in the Content
Script, and share the latest resolved theme with the Popup through
`chrome.storage.local`.

Keep existing users on their saved manual theme during migration. Default new
users to following ChatGPT. Present manual Dark/Light selection as one toggle
button and disable it while following ChatGPT.

### Consequences
* ChatGPT theme changes update LunaTOC immediately when following is enabled.
* Disabling follow mode restores the user's last manual theme.
* The Popup is now a React entry styled with Tailwind utilities; `popup.css`
  remains the Tailwind entry and retains only theme tokens and document-level
  base rules.
* No additional extension permissions are required.

---

## ADR 09: Navigation Feature Boundary
* **Date**: 2026-07-24

### Context
Main-prompt navigation, child-outline navigation, outline rendering, and
sidebar follow behavior were split across root-level feature files. The main
jump implementation also prioritizes ChatGPT's native prompt navigator, which
we intend to replace independently later.

### Decision
Group the complete TOC navigation feature under `features/navigation`.
Separate main-prompt navigation in `promptNavigation.ts`, child-heading
navigation in `outlineNavigation.ts`, child-outline extraction and display in
`outline.ts`, and follow policy in `follow.ts`.

Keep the current navigation algorithm unchanged during this move. Callers use
the stable exports from `promptNavigation.ts`, allowing its native-first
implementation to be replaced without changing the navigator or outline UI.

### Consequences
* Navigation-related files no longer add to the `features` root.
* A displayed child outline remains the prerequisite for initiating a child
  jump, while `outlineNavigation.ts` handles headings later virtualized away.
* Main-prompt algorithm replacement is isolated from child-outline display and
  sidebar follow behavior.

---

## ADR 10: Platform-Independent Navigation Data
* **Date**: 2026-07-24

### Context
Future position-based navigation should work with ChatGPT, Copilot, Claude, and
other AI pages whose conversation payloads and role fields differ. Fingerprints
also need stable AI text rather than platform-specific attachments or tool
output.

### Decision
Represent navigation input as generic prompt/response turns. Keep conversion
from ChatGPT's active conversation branch in a platform adapter, and retain only
visible Assistant text for future fingerprint generation. Exclude tool messages,
attachments, and structured non-text content.

Generate at most the configured number of fingerprints per response. Normalize
raw and rendered content into comparable Unicode letters and numbers, removing
Markdown image/link payloads, URLs, and formatting symbols. Distribute samples
across long responses, use a short plain-text probe for fast lookup, and verify
ambiguous matches with a SHA-256 hash of the following bounded text. Build the
conversation index in bounded batches and yield to the event loop between
batches so long conversations do not monopolize the Content Script's main
thread. Match rendered text by locating probes first, verifying their trailing
hashes, and accepting a prompt only when it has a unique highest
verified-fingerprint count.

Keep rendered-text extraction in platform adapters. The ChatGPT adapter reads
only mounted Assistant-owned Markdown containers, combines multiple Markdown
blocks belonging to one response, and excludes nested tool or attachment UI.

Keep one active fingerprint record per response. Mark records derived from raw
conversation data as `derived` and records created from rendered content as
`observed`. An observed record replaces a derived record for the same response,
while later derived updates cannot replace an observed record. Preserve observed
records across snapshot revisions, then discard records whose response IDs are
absent when the new derived index completes.

### Consequences
* Fingerprint and search modules can operate without ChatGPT data types.
* Supporting another AI page requires a new adapter rather than changes to the
  navigation algorithm.
* Fingerprints contain only bounded text probes and hashes rather than complete
  AI responses.
* Derived raw text and observed rendered text share the same lightweight
  comparable-text transformation without requiring a Markdown renderer.
* Each non-empty response has at most one active fingerprint record containing
  its `responseId`, `promptIndex`, quality, and bounded fingerprints.
* Matching still aggregates verified response records by `promptIndex`.
* Equally strong prompt matches are reported as ambiguous instead of selecting
  an arbitrary navigation target.
* Visible-position resolution tries generic fingerprints before using a
  platform response ID as fallback, allowing each future platform adapter to
  provide its own optional identity mechanism.
* Existing prompt extraction and navigation behavior remain unchanged until
  the generic model is connected in a later step.
