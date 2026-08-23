/**
 * Builds and merges quality-tagged response fingerprints in bounded batches.
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
} from '@/navigation/navigationData';

export interface FingerprintIndexOptions extends FingerprintOptions {
  buildBatchSize: number;
  buildTimeBudgetMs: number;
}

export interface ResponseFingerprintTask {
  promptIndex: number;
  response: NavigationTextMessage;
}

export type FingerprintQuality = 'derived' | 'observed';

export interface ResponseFingerprintRecord {
  responseId: string;
  promptIndex: number;
  quality: FingerprintQuality;
  fingerprints: ResponseFingerprint[];
}

export type NavigationFingerprintIndex = ResponseFingerprintRecord[];

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
 * Returns whether an incoming record may replace the current response record.
 *
 * @example
 * shouldReplaceFingerprintRecord(derivedRecord, observedRecord) === true;
 */
export function shouldReplaceFingerprintRecord(
  current: ResponseFingerprintRecord,
  incoming: ResponseFingerprintRecord
): boolean {
  if (current.responseId !== incoming.responseId) return false;

  return incoming.quality === 'observed' || current.quality === 'derived';
}

/**
 * Merges response records without allowing derived data to replace observed data.
 *
 * @example
 * const merged = mergeFingerprintRecords(currentIndex, incomingIndex);
 */
export function mergeFingerprintRecords(
  current: NavigationFingerprintIndex,
  incoming: NavigationFingerprintIndex
): NavigationFingerprintIndex {
  const merged = current.map(cloneFingerprintRecord);
  const recordIndexes = new Map(
    merged.map((record, index) => [record.responseId, index])
  );

  incoming.forEach((record) => {
    const existingIndex = recordIndexes.get(record.responseId);

    if (existingIndex === undefined) {
      recordIndexes.set(record.responseId, merged.length);
      merged.push(cloneFingerprintRecord(record));
      return;
    }

    const currentRecord = merged[existingIndex]!;

    if (shouldReplaceFingerprintRecord(currentRecord, record)) {
      merged[existingIndex] = cloneFingerprintRecord(record);
    } else if (
      currentRecord.quality === 'observed' &&
      record.quality === 'derived' &&
      currentRecord.promptIndex !== record.promptIndex
    ) {
      merged[existingIndex] = {
        ...cloneFingerprintRecord(currentRecord),
        promptIndex: record.promptIndex,
      };
    }
  });

  return merged;
}

/**
 * Adds or replaces one response record using the quality precedence rules.
 */
export function upsertFingerprintRecord(
  current: NavigationFingerprintIndex,
  incoming: ResponseFingerprintRecord
): NavigationFingerprintIndex {
  return mergeFingerprintRecords(current, [incoming]);
}

/**
 * Builds one fingerprint record per non-empty response.
 *
 * @example
 * const index = await buildFingerprintIndex(navigationTurns, 'derived');
 */
export async function buildFingerprintIndex(
  turns: NavigationTurn[],
  quality: FingerprintQuality = 'derived',
  options: FingerprintIndexOptions = APP_CONFIG.navigation.fingerprint,
  yieldControl: MainThreadYield = yieldToMainThread
): Promise<NavigationFingerprintIndex> {
  const index: NavigationFingerprintIndex = [];
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

    if (fingerprints.length > 0) {
      index.push({
        responseId: task.response.id,
        promptIndex: task.promptIndex,
        quality,
        fingerprints,
      });
    }

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

/**
 * Clones one response record and its fingerprint objects.
 */
function cloneFingerprintRecord(
  record: ResponseFingerprintRecord
): ResponseFingerprintRecord {
  return {
    responseId: record.responseId,
    promptIndex: record.promptIndex,
    quality: record.quality,
    fingerprints: record.fingerprints.map((fingerprint) => ({
      ...fingerprint,
    })),
  };
}
