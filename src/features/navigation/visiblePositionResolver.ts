/**
 * Resolves the prompt-index range represented by currently rendered responses.
 */
import {
  matchFingerprintIndex,
  selectBestPromptMatch,
  type RenderedTextBlock,
} from './fingerprint/matcher';
import type { NavigationFingerprintIndex } from './fingerprint/index';
import {
  matchSegmentIndex,
  selectBestSegmentMatch,
  type NavigationSegmentIndex,
} from './fingerprint/segmentMatcher';

export interface VisiblePromptBlockMatch {
  blockId: string;
  promptIndex: number;
  source: 'segment' | 'response-id' | 'fingerprint';
  segmentIndex?: number;
  segmentCount?: number;
  positionRatio?: number;
  segmentQuality?: 'derived' | 'observed';
}

export interface LocatedVisiblePromptPosition {
  status: 'located';
  firstPromptIndex: number;
  lastPromptIndex: number;
  matchedPromptIndexes: number[];
  matchedBlockIds: string[];
  matchedBlocks: VisiblePromptBlockMatch[];
}

export interface AmbiguousVisiblePromptPosition {
  status: 'ambiguous';
  candidatePromptIndexes: number[];
  ambiguousBlockIds: string[];
}

export type VisiblePromptPosition =
  | { status: 'none' }
  | LocatedVisiblePromptPosition
  | AmbiguousVisiblePromptPosition;

/**
 * Resolves visible prompt indexes using generic fingerprints first and
 * response IDs only as a platform-provided fallback.
 *
 * @example
 * const position = await resolveVisiblePromptPosition(blocks, index);
 * if (position.status === 'located') {
 *   console.log(position.firstPromptIndex, position.lastPromptIndex);
 * }
 */
export async function resolveVisiblePromptPosition(
  blocks: RenderedTextBlock[],
  fingerprintIndex: NavigationFingerprintIndex,
  segmentIndex: NavigationSegmentIndex = []
): Promise<VisiblePromptPosition> {
  if (
    blocks.length === 0 ||
    (fingerprintIndex.length === 0 && segmentIndex.length === 0)
  ) {
    return { status: 'none' };
  }

  const promptIndexesByResponseId = indexPromptIndexesByResponseId(
    fingerprintIndex,
    segmentIndex
  );
  const matchedPromptIndexes = new Set<number>();
  const matchedBlockIds = new Set<string>();
  const matchedBlocks: VisiblePromptBlockMatch[] = [];
  const candidatePromptIndexes = new Set<number>();
  const ambiguousBlockIds = new Set<string>();

  for (const block of blocks) {
    const segmentSelection = selectBestSegmentMatch(
      await matchSegmentIndex([block], segmentIndex)
    );

    if (segmentSelection.status === 'matched') {
      const segment = segmentSelection.match;
      matchedPromptIndexes.add(segment.promptIndex);
      matchedBlockIds.add(block.id);
      matchedBlocks.push({
        blockId: block.id,
        promptIndex: segment.promptIndex,
        source: 'segment',
        segmentIndex: segment.segmentIndex,
        segmentCount: segment.segmentCount,
        positionRatio: segment.positionRatio,
        segmentQuality: segment.quality,
      });
      continue;
    }

    const selection = selectBestPromptMatch(
      await matchFingerprintIndex([block], fingerprintIndex)
    );

    if (selection.status === 'matched') {
      matchedPromptIndexes.add(selection.match.promptIndex);
      matchedBlockIds.add(block.id);
      matchedBlocks.push({
        blockId: block.id,
        promptIndex: selection.match.promptIndex,
        source: 'fingerprint',
      });
      continue;
    }

    const directPromptIndexes = promptIndexesByResponseId.get(block.id);

    if (directPromptIndexes?.size === 1) {
      const promptIndex = [...directPromptIndexes][0]!;

      matchedPromptIndexes.add(promptIndex);
      matchedBlockIds.add(block.id);
      matchedBlocks.push({
        blockId: block.id,
        promptIndex,
        source: 'response-id',
      });
      continue;
    }

    if (directPromptIndexes && directPromptIndexes.size > 1) {
      directPromptIndexes.forEach((index) =>
        candidatePromptIndexes.add(index)
      );
      ambiguousBlockIds.add(block.id);
      continue;
    }

    if (selection.status === 'ambiguous') {
      selection.matches.forEach(({ promptIndex }) =>
        candidatePromptIndexes.add(promptIndex)
      );
      ambiguousBlockIds.add(block.id);
    }

    if (segmentSelection.status === 'ambiguous') {
      segmentSelection.matches.forEach(({ promptIndex }) =>
        candidatePromptIndexes.add(promptIndex)
      );
      ambiguousBlockIds.add(block.id);
    }
  }

  if (ambiguousBlockIds.size > 0) {
    matchedPromptIndexes.forEach((index) =>
      candidatePromptIndexes.add(index)
    );

    return {
      status: 'ambiguous',
      candidatePromptIndexes: [...candidatePromptIndexes].sort(
        (first, second) => first - second
      ),
      ambiguousBlockIds: [...ambiguousBlockIds],
    };
  }

  const sortedPromptIndexes = [...matchedPromptIndexes].sort(
    (first, second) => first - second
  );

  if (sortedPromptIndexes.length === 0) return { status: 'none' };

  return {
    status: 'located',
    firstPromptIndex: sortedPromptIndexes[0]!,
    lastPromptIndex: sortedPromptIndexes.at(-1)!,
    matchedPromptIndexes: sortedPromptIndexes,
    matchedBlockIds: [...matchedBlockIds],
    matchedBlocks,
  };
}

/**
 * Groups all cached prompt indexes by response ID for direct DOM matching.
 */
function indexPromptIndexesByResponseId(
  fingerprintIndex: NavigationFingerprintIndex,
  segmentIndex: NavigationSegmentIndex
): Map<string, Set<number>> {
  const promptIndexesByResponseId = new Map<string, Set<number>>();

  fingerprintIndex.forEach(({ responseId, promptIndex }) => {
    const promptIndexes =
      promptIndexesByResponseId.get(responseId) || new Set<number>();

    promptIndexes.add(promptIndex);
    promptIndexesByResponseId.set(responseId, promptIndexes);
  });
  segmentIndex.forEach(({ responseId, promptIndex }) => {
    const promptIndexes =
      promptIndexesByResponseId.get(responseId) || new Set<number>();

    promptIndexes.add(promptIndex);
    promptIndexesByResponseId.set(responseId, promptIndexes);
  });

  return promptIndexesByResponseId;
}
