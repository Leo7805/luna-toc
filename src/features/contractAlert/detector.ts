/**
 * Compatibility-alert detector. The page-hook (MAIN world) and content-script
 * (ISOLATED world) post mismatch records here via `recordMismatch`. The
 * `ContractAlert` component subscribes and renders a top-most dialog when
 * the pending list is non-empty.
 *
 * The detector itself is world-agnostic (pure module state); whether records
 * are *displayed* is the responsibility of the caller, gated by the
 * `showCompatibilityAlert` Options toggle.
 */
import {
  APP_CONFIG,
  type ChatGptContractId,
  type ChatGptRuntimeConfig,
} from '@/config/config';

/** One detected mismatch between an expected contract value and the observed one. */
export interface MismatchRecord {
  contractId: ChatGptContractId;
  /** Human-readable label, looked up from the committed contract table. */
  label: string;
  /** The value the extension expects. */
  expected: string;
  /** The value the extension actually observed (may be a diagnostic message). */
  actual: string;
  /** Epoch milliseconds when the mismatch was first recorded. */
  observedAt: number;
}

type Listener = (records: MismatchRecord[]) => void;

const pending = new Map<ChatGptContractId, MismatchRecord>();
const listeners = new Set<Listener>();

/**
 * Adds (or refreshes) a mismatch record for `contractId`. Subsequent calls
 * with the same `contractId` are deduped; only the first observation is kept
 * until the record is dismissed.
 */
export function recordMismatch(
  contractId: ChatGptContractId,
  expected: string,
  actual: string
): void {
  const existing = pending.get(contractId);
  if (existing) return;

  const entry = APP_CONFIG.platforms.chatgpt.contract[contractId];
  pending.set(contractId, {
    contractId,
    label: entry?.label ?? contractId,
    expected,
    actual,
    observedAt: Date.now(),
  });
  notify();
}

/** Removes a single record by contract id (no-op if absent). */
export function dismissMismatch(contractId: ChatGptContractId): void {
  if (pending.delete(contractId)) notify();
}

/** Clears all pending records and notifies subscribers. */
export function dismissAllMismatches(): void {
  if (pending.size === 0) return;
  pending.clear();
  notify();
}

/** Returns a snapshot of the pending records (insertion order). */
export function getPendingMismatches(): MismatchRecord[] {
  return Array.from(pending.values());
}

/**
 * Subscribes to mismatch-list changes. The listener fires synchronously on
 * every record/dismiss with the current snapshot. Returns an unsubscribe fn.
 */
export function subscribeMismatches(listener: Listener): () => void {
  listeners.add(listener);
  listener(Array.from(pending.values()));
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  const snapshot = Array.from(pending.values());
  for (const listener of listeners) listener(snapshot);
}

/**
 * Determines whether a mismatch record should be retained for display.
 * Currently the detector only emits when the Options toggle is on, but this
 * helper centralizes the gate so callers can compose it cleanly.
 */
export function shouldDisplayAlert(
  runtimeConfig: Pick<ChatGptRuntimeConfig, 'showCompatibilityAlert'>
): boolean {
  return runtimeConfig.showCompatibilityAlert === true;
}