# B034 — Raw Markdown bold markers remain visible in ChatGPT answers

- Date: 2026-10-24
- Priority: P2
- Status: Implemented on `feat/b034-markdown-bold-repair`; [PR #21](https://github.com/PyRookie1/luna-toc-sc/pull/21) tracks automated CI and real-site compatibility.

## Symptom

Some ChatGPT assistant answers display complete `**bold text**` delimiters literally instead of rendering the enclosed text in bold.

## Scope and root cause

**Observed report:** Some answers show the paired markers literally. The live ChatGPT DOM for a reported occurrence has not yet been inspected.

**Working hypothesis, not confirmed on a live site:** The raw delimiter pair is present as ordinary text inside an assistant Markdown container. LunaTOC-SC previously had no display compatibility fallback for that case. The extension cannot determine why ChatGPT emitted or retained the raw markers, so this fix is limited to display repair.

## Fix

- Observe only assistant-owned `.markdown` containers on the supported ChatGPT sites.
- Replace safe, complete, unescaped double-asterisk pairs with DOM `strong` elements; never parse response text as HTML.
- Preserve malformed pairs, triple-star syntax, inline code, code elements, math content, user messages, and ordinary page text.
- Recheck streamed text and newly mounted answers while avoiding duplicate processing.
- Add a scoped bold-weight rule for generated elements; add unit and Chromium fixture regressions.

## Limitations and verification

Markers split across separate text nodes are conservatively left unchanged. The automated browser fixture does not prove behavior on a live, authenticated ChatGPT page; that compatibility remains unverified until separately tested.

## Privacy and rollback

The feature makes no network requests, adds no permissions, and writes no chat content to extension storage. Roll back by reverting the feature commit, which removes the observer startup, scoped CSS, tests, and documentation.
