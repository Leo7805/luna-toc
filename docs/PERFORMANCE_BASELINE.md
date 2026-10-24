# Stage 08 — Synthetic TOC performance baseline

Date: 2026-10-23. Repository: PyRookie1/luna-toc-sc.
Base main commit: 3f9d06a0984038b44467927b3243ebcb08a0a002.

## Reproduce

Run after installing the lockfile dependencies with `npm ci`:

- `npm run perf:toc`: focused performance and structural-regression suite.
- `npm test`: all tests, including the performance suite.
- `npm run typecheck` and `npm run build`: type and extension checks.

The fixture generates **100, 500 and 2,000** synthetic prompt descriptors
with predictable IDs and text. The Vitest/jsdom test records initial DOM
construction, three unchanged renders (median), a search with no matches,
and 20 alternating active-row changes (median latency plus DOM class-operation
counts). An additional fixture resolves the first and final prompt IDs from
two mounted DOM bubbles across the same dataset sizes; this exercises mounted
message index lookup only, not the unmounted far-jump scrolling loop. The
measurement excludes full ChatGPT responses, the network, browser layout/paint
and virtualized conversation pagination. The benchmark prints
structured `[LunaTOC performance]` JSON lines in test logs. Durations are
observations, never pass/fail limits; the class-operation bounds are a
deterministic regression guard.

Environment for recorded runs: GitHub Actions ubuntu-24.04, Node 22,
Vitest with jsdom. These are separate CI invocations and timings may vary with
runner allocation and background load.

## Before-and-after evidence

Before: [workflow 39908933601](https://github.com/PyRookie1/luna-toc-sc/actions/runs/39908933601),
benchmark-only commit dfda39b4e5d450642b158b6bf30dad0289ac0a2f.

After: [workflow 39909171958](https://github.com/PyRookie1/luna-toc-sc/actions/runs/39909171958),
source and regression-test commit b9a8e172ac1924863edd08e5d4953257bce47328.

| Prompts | Cold render before / after (ms) | Unchanged render median before / after (ms) | Search miss before / after (ms) | Active transition median before / after (ms) | Remove calls in 20 transitions before / after |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 126.068 / 83.874 | 17.900 / 19.976 | 38.207 / 49.546 | 1.585 / 0.073 | 2,000 / 20 |
| 500 | 300.378 / 368.136 | 47.530 / 37.824 | 64.928 / 74.192 | 1.834 / 0.037 | 10,000 / 20 |
| 2,000 | 1124.350 / 1233.441 | 126.012 / 127.708 | 569.025 / 537.188 | 15.351 / 0.035 | 40,000 / 20 |

The high-frequency `updateActiveItemUI()` path previously removed the active
class from **every** row. It now tracks its previous active element and updates
only the old and new rows. Re-render reconciles this pointer when rows are
reused, replaced, hidden by search, or reset. The number of active-class
removals per transition no longer grows with the number of prompts. The timed
result is directionally consistent but is not an estimate of Chrome speedup.

The cold render, unchanged render and search data show no consistent speedup.
Those pathways were intentionally not rewritten without a demonstrated
bottleneck. Synthetic CI times must not become rigid time gates.

## ChatGPT fetch trade-off and recovery

The existing `src/config/config.ts` value
`interceptChatGptPaginationNumTurns: 100` rewrites ChatGPT pagination
requests through `chatGptFetchBumper.ts`. Synthetic DOM timings cannot reveal
its real response sizes, network round trips, JSON parsing costs, or user
time-to-target. Leave it unchanged in Stage 08. Its `number | null` setting
already allows the code-level rewrite to be disabled by setting `null`, but this
is **not** an end-user setting. Do not claim that `100` is faster or slower
without controlled, non-sensitive real-host data.

No user storage schema, permissions, external requests or package dependencies
were changed. Reverting the targeted renderer commit restores previous
highlight behavior. No data migration or backup change is required.

## Outstanding boundaries

- Real Chrome startup time, paint responsiveness and JS heap use: unmeasured.
- Far-distance jump through *unmounted* ChatGPT messages: functionality has
  existing mocked unit tests, but no trustworthy end-to-end timing baseline.
- Host-side pagination at `num_turns=100` versus default: network impact
  unmeasured; no production payload collection, telemetry or API experiments.
- Real-host interaction and virtual-scroll browser automation belong to the
  subsequent automated browser-testing stage, not to manual work by the user.

CI test success is not equivalent to real ChatGPT environment performance
acceptance.


## Stage 10 — Chromium synthetic large-conversation fixture

The browser E2E suite builds a local fixture containing 500 user/assistant message pairs and records time-to-500-item TOC plus a far-target click/jump. The fixture is served from a mocked `chatgpt.com` origin; all HTTP(S) traffic outside the fixture is blocked. The log line `[LunaTOC browser synthetic]` includes the workload, environment, TOC build time and jump time.

These measurements are browser-level regression observations for a fully mounted synthetic DOM, not measurements of live ChatGPT virtualization, real network latency, memory use or user-perceived production performance. There is deliberately no hard millisecond gate until repeated runner variance and a stable baseline are established. Actual numbers and the workflow URL must be added after the Stage 10 CI run completes; no performance gain is claimed in advance.
