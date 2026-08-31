# Plan 4: Fix `renderedFingerprintCollector` Test Flakiness

## Background

`test/platforms/chatgpt/renderedFingerprintCollector.test.ts` has 5 tests; 2 of them (using fake timers + MutationObserver) flake intermittently when run as part of the full suite (`pnpm test`). When run in isolation, all 5 pass deterministically. The flakiness is **pre-existing** — confirmed reproducible on a clean checkout before this branch's changes (via `git stash`) — and unrelated to the applicationShell refactor.

The 2 flaky tests:

1. `collects the latest text after DOM mutations settle` (line 105)
2. `uses the current conversation context after a route switch` (line 136)

Both fail with `expected vi.fn() to be called 1 times, but got 0 times`.

## Root Cause

The collector ([`src/platforms/chatgpt/renderedFingerprintCollector.ts`](src/platforms/chatgpt/renderedFingerprintCollector.ts)) wires a `MutationObserver` that resets a `setTimeout` debounce timer on every DOM mutation:

```ts
observer = new MutationObserver(scheduleCollection);
// ...
function scheduleCollection(): void {
  if (!context || !observedRoot) return;
  if (collectionTimer !== null) clearTimeout(collectionTimer);
  collectionTimer = setTimeout(() => { /* collect */ }, debounceMs);
}
```

The tests use `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()`. The flakiness comes from how jsdom's `MutationObserver` polyfill schedules its callback relative to fake timers:

- jsdom's `MutationObserver` polyfill queues its callback as a **microtask** (per the WHATWG spec).
- `await Promise.resolve()` drains **one** microtask, but pending callbacks chained from that microtask (e.g. `setTimeout` chained work) may not all drain in a single tick.
- `vi.advanceTimersByTimeAsync(N)` advances the fake clock and drains microtasks between timer fires — but the order between "drain MutationObserver microtask" and "fire debounce timer" can race.

Net effect: in some runs, the MutationObserver callback fires, resets the debounce timer, and the test's `vi.advanceTimersByTimeAsync(50)` fires the timer correctly. In other runs, the MutationObserver callback hasn't fired by the time the test asserts, the debounce timer was never reset, and `onFingerprintRecord` was never called.

When the same tests run with real timers (or in isolation, where microtask scheduling is more deterministic), they pass reliably.

## Approach

**Test-only fix; no source change.** The collector's design (MutationObserver + debounced collect) is correct; the test pattern is fragile. Switch to a deterministic timer-and-microtask-drain helper.

### Options

**A. Replace `await Promise.resolve()` with `await vi.advanceTimersByTimeAsync(0)`.** `advanceTimersByTimeAsync(0)` advances by 0ms (no timers fire) but drains all pending microtasks. One-line replacement per call site.

**B. Add an explicit microtask-drain helper to the test file:**

```ts
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
```

Three `Promise.resolve()` cycles drain the chain. Robust against MutationObserver chained microtasks.

**C. Use `vi.runAllTimersAsync()`** to drain all timers and microtasks. May run more than needed but is simplest.

**Recommendation: B.** Explicit microtask drain is the most defensive and makes the test's intent visible. A is more idiomatic but less obviously correct; C is heavier than needed.

## TODO 大纲

- [ ] 1. Add `flushMicrotasks` helper to `renderedFingerprintCollector.test.ts`
- [ ] 2. Replace `await Promise.resolve()` calls in the 2 flaky tests with `await flushMicrotasks()`
- [ ] 3. Run `pnpm test` 10 times to confirm no regressions
- [ ] 4. Run `pnpm test` for the full suite 5 times to confirm no cross-test pollution

## 改动清单

- Modify [`test/platforms/chatgpt/renderedFingerprintCollector.test.ts`](test/platforms/chatgpt/renderedFingerprintCollector.test.ts)
  - Add a `flushMicrotasks` helper near the top of the file (after imports)
  - In the 2 flaky tests, replace each `await Promise.resolve();` with `await flushMicrotasks();`

No source files are modified. No new dependencies.

## 步骤

- [ ] 1.1 Read the current test file to identify exact line numbers of `await Promise.resolve()` calls in the 2 flaky tests
- [ ] 1.2 Add the helper function at the top of the `describe` block:

  ```ts
  async function flushMicrotasks(): Promise<void> {
    // MutationObserver callbacks queue microtasks that may chain further
    // microtasks. Drain three cycles to ensure the observer callback and
    // any work it triggers have all settled.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  ```

- [ ] 2.1 In the "collects the latest text" test, replace the two `await Promise.resolve();` calls with `await flushMicrotasks();`
- [ ] 2.2 In the "uses the current conversation context after a route switch" test, replace the single `await Promise.resolve();` call with `await flushMicrotasks();`
- [ ] 3.1 Run `pnpm test test/platforms/chatgpt/renderedFingerprintCollector.test.ts` 10 times; all 5 tests pass each time
- [ ] 3.2 Run `pnpm test` (full suite) 5 times; 186/186 tests pass each time

## 验证

- [ ] `pnpm typecheck` passes (test-only change; trivial)
- [ ] `pnpm test test/platforms/chatgpt/renderedFingerprintCollector.test.ts` × 10: all 5 tests pass every run
- [ ] `pnpm test` (full suite) × 5: all 186 tests pass every run
- [ ] `pnpm test` (single run) still passes 186/186

## 风险

- **Test fragility persists if MutationObserver polyfill behavior changes.** The 3-cycle drain is heuristic. If vitest/jsdom updates break it, we'd need to revisit. Mitigation: add a comment explaining why 3 cycles.
- **No source code change.** Collector behavior is unchanged. No risk to runtime behavior.
- **Other tests using fake timers:** A quick grep found only this one test file uses fake timers with MutationObserver interaction. No collateral changes needed.

## Out of Scope

- Replacing `MutationObserver` with explicit `collect()` calls in the source. Would require redesigning the collector's contract.
- Replacing `setTimeout` debounce with `requestAnimationFrame` or similar. Different timing semantics; not necessary for this fix.
- Adding `jsdom` config (e.g. `runScripts: "dangerously"`). Affects other tests; out of scope.