/**
 * Builds prompt-indexed response fingerprints without blocking long tasks.
 */
import { APP_CONFIG } from '@/config/config';
import {
  createResponseFingerprints,
  type FingerprintOptions,
  type ResponseFingerprint,
} from './generator';
import type {
  NavigationTextMessage,
  NavigationTurn,
} from '@/features/navigation/navigationData';

export interface FingerprintIndexOptions extends FingerprintOptions {
  buildBatchSize: number;
  buildTimeBudgetMs: number;
}

export interface ResponseFingerprintTask {
  promptIndex: number;
  response: NavigationTextMessage;
}

export interface PromptFingerprintIndex {
  promptIndex: number;
  fingerprints: ResponseFingerprint[];
}

export type MainThreadYield = () => Promise<void>;

/**
 * Flattens prompt responses into ordered fingerprint-generation tasks.
 *
 * @example
 * const tasks = flattenResponseTasks(navigationTurns);
 */
export function flattenResponseTasks(
  turns: NavigationTurn[]
): ResponseFingerprintTask[] {
  return turns.flatMap((turn) =>
    turn.responses.map((response) => ({
      promptIndex: turn.promptIndex,
      response,
    }))
  );
}

/**
 * Yields execution to the browser event loop between fingerprint batches.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Builds response fingerprints grouped by their owning prompt index.
 *
 * @example
 * const index = await buildFingerprintIndex(navigationTurns);
 */
export async function buildFingerprintIndex(
  turns: NavigationTurn[],
  options: FingerprintIndexOptions = APP_CONFIG.navigation.fingerprint,
  yieldControl: MainThreadYield = yieldToMainThread
): Promise<PromptFingerprintIndex[]> {
  const index = turns.map<PromptFingerprintIndex>((turn) => ({
    promptIndex: turn.promptIndex,
    fingerprints: [],
  }));
  const fingerprintsByPrompt = new Map(
    index.map((entry) => [entry.promptIndex, entry.fingerprints])
  );
  const tasks = flattenResponseTasks(turns);
  const batchSize = Math.max(1, options.buildBatchSize);
  const timeBudgetMs = Math.max(0, options.buildTimeBudgetMs);
  let batchStartedAt = performance.now();
  let batchTaskCount = 0;

  for (const [taskIndex, task] of tasks.entries()) {
    const fingerprints = await createResponseFingerprints(
      task.response,
      options
    );

    fingerprintsByPrompt.get(task.promptIndex)?.push(...fingerprints);
    batchTaskCount += 1;

    const hasMoreTasks = taskIndex < tasks.length - 1;
    const reachedBatchSize = batchTaskCount >= batchSize;
    const reachedTimeBudget =
      performance.now() - batchStartedAt >= timeBudgetMs;

    if (hasMoreTasks && (reachedBatchSize || reachedTimeBudget)) {
      await yieldControl();
      batchStartedAt = performance.now();
      batchTaskCount = 0;
    }
  }

  return index;
}
