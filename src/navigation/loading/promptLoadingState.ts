/**
 * Owns the "prompts are still arriving" loading flag and its fallback
 * settle timer.
 *
 * The authoritative end-of-load signal is the page hook's
 * `CHATGPT_CONVERSATION_ENDED` message. This module's settle timer is only
 * a fallback for signal-less routes (e.g. ChatGPT hydrating a conversation
 * entirely from its own client-side cache). The timer re-arms a bounded
 * number of times; once the budget is exhausted it calls the injected
 * `onSettleTimeout` callback so the controller can declare completion
 * anyway. Kept free of DOM / controller imports so it can be unit-tested
 * with fake timers.
 */
import { APP_CONFIG } from '@/config/config';

const MAX_SETTLE_RETRIES = 20;

let loading = true;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let settleRetries = 0;
let onSettleTimeout: (() => void) | null = null;

/**
 * Returns whether prompts are still being loaded for the active route.
 */
export function isLoading(): boolean {
  return loading;
}

/**
 * Sets the loading flag. Clearing it resets the retry budget so the next
 * load starts from a clean slate.
 */
export function setLoading(value: boolean): void {
  loading = value;
  if (!value) settleRetries = 0;
}

/**
 * Injects the callback fired when the fallback settle timer exhausts its
 * retry budget. The controller passes `markLoadingComplete`.
 */
export function setOnSettleTimeout(callback: () => void): void {
  onSettleTimeout = callback;
}

/**
 * Arms the fallback settle timer. Safe to call repeatedly — the previous
 * timer is cleared first. Each tick re-arms until `MAX_SETTLE_RETRIES` is
 * exhausted, then fires `onSettleTimeout`.
 */
export function startSettleTimer(): void {
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    if (!loading) return;
    settleRetries += 1;
    if (settleRetries <= MAX_SETTLE_RETRIES) {
      startSettleTimer();
      return;
    }
    onSettleTimeout?.();
  }, APP_CONFIG.ui.sidebar.loadingSettleMs);
}

/**
 * Cancels the fallback settle timer without firing the callback.
 */
export function clearSettleTimer(): void {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}