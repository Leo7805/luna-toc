# Plan 5: Restore TOC Click-to-Jump on New ChatGPT DOM

## Background

LunaTOC 1.11.4 TOC click fails on the current ChatGPT web. Two
distinct regressions share the same symptom, both confirmed against the
user's own conversation and corroborated by a GitHub issue from another
user on long conversations inside Projects.

1. **DOM selector death** — `[data-message-author-role="user"]` and
   `[data-message-id]` return 0 hits on the new ChatGPT DOM. ChatGPT
   replaced them with `[data-user-message-bubble="true"]` (one boolean
   marker per user prompt container, no native id).
2. **Negative scrollTop** — `thread-scroll-container` uses
   `flex-direction: column-reverse`; valid scrollTop range is `[-max, 0]`.
   LunaTOC's plan math works in positive space, so `container.scrollTop = N`
   (positive) is silently clamped to 0 — virtual search never moves.

## Approach

Two surgical fixes at the boundary between LunaTOC's positive-space math
and ChatGPT's column-reverse DOM:

- Switch the user-message selector so `getVisibleUserMessages`,
  `findRenderedChatGptPrompt`, and the IntersectionObserver can resolve
- Flip the scrollTop sign in the one `scrollTo` closure that actually
  touches `container.scrollTop`

## Changes (this commit)

| File | What |
|---|---|
| [src/platforms/chatgpt/virtualSearchAdapter.ts](src/platforms/chatgpt/virtualSearchAdapter.ts) | `USER_MESSAGE_SELECTOR` → `[data-user-message-bubble="true"]` |
| [src/platforms/chatgpt/nativePromptNavigation.ts](src/platforms/chatgpt/nativePromptNavigation.ts) | same selector at both call sites |
| [src/navigation/jump/promptNavigation.ts](src/navigation/jump/promptNavigation.ts) | `scrollTo` flips sign when container `flex-direction === 'column-reverse'` |

## Out of scope (Plan 6)

`findRenderedChatGptPrompt` returns null because new-DOM user bubbles
have no `data-message-id` attribute and LunaTOC's anchor pipeline uses
id matching. Even with column-reverse fixed, the search algorithm reports
`anchorCount: 0` and never falls back to text matching inside
`searchVirtualPrompt`. A separate plan will add a text-matching fallback
to the anchor pipeline (or inject a stable id from
`[data-content-search-unit-key]`).

## Verification

`pnpm build` clean. Reload extension. Click any TOC entry in a
25-prompt conversation: `SCROLL_APPLIED` now shows
`scrollTopAfter != scrollTopBefore` (negative values in column-reverse).
Page scrolls on click; final `JUMP_FINISHED` may still report
`unresolved` until Plan 6 lands.