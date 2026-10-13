# B001 — First Prompt Disappears During New-Chat Route Migration

## Symptom

Starting a new ChatGPT conversation navigates through a three-stage route lifecycle:
`https://chatgpt.com/` → `https://chatgpt.com/c/local-...` → `https://chatgpt.com/c/<permanent-id>`
Prompt #1 renders upon submission and persists during `/c/local-*`, but vanishes when the route updates to `<permanent-id>`. Prompt #2 renders normally, and page refresh restores Prompt #1.

## Root Cause

`isNewChatRouteKey` recognized `new-chat:` and `WEB:`, but not `local-*`.
The first transition (`new-chat:/` → `local-*`) was classified as a temporary migration, preserving state. However, the second transition (`local-*` → `<permanent-id>`) was treated as a normal conversation switch. `shouldPreserveMessages` evaluated to `false`, resetting active navigator state.

## Fix

1. Composer-captured prompts are stored in accumulated conversation state.
2. Temporary route migration uses move semantics: copies accumulated messages and snapshots to the next identity, then purges the temporary source state.
3. Classified `local-*` as a temporary route key so migration executes across both transitions (`new-chat:/` → `local-*` → `<permanent-id>`).
4. Real conversation switches (`real-A` → `real-B`) remain strictly isolated without state migration.

## Regression Tests

Automated suites verify the complete three-stage transition (`new-chat:/` → `local-*` → `<permanent-id>`), prompt survival during empty streaming payloads, server deduplication, temporary state cleanup, fresh new-chat isolation, and permanent conversation isolation.

## Why It Matters

A clean SPA lifecycle case study involving multi-stage asynchronous identity transitions, temporary-to-permanent state migration with move semantics, and cross-conversation isolation under streaming updates.
