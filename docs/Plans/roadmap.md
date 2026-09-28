# Roadmap

- [1](1-application-shell-refactor.md) — Refactor applicationShell.ts (in progress, batch 1 done)
- [2](2-session-storage-helper.md) — Consolidate sessionStorage helpers (after Plan 1)
- [3](3-floating-panel-primitive.md) — Extract `clampToViewport` + add `dataset.dragged` to floating panel (after Plan 1)
- [4](4-fingerprint-collector-flake.md) — Fix `renderedFingerprintCollector` test flakiness (independent of Plans 1-3)
- [5](5-toc-jump-target-selector.md) — Restore TOC click-to-jump on new ChatGPT DOM: switch to `[data-search-result-target]` + bridge API `message.id` + handle `flex-direction: column-reverse`