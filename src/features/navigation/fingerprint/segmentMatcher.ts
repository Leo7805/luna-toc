/**
 * Matches visible viewport text against response-segment fingerprints.
 */
import {
  verifyFingerprintMatch,
  type RenderedTextBlock,
} from './matcher';
import type {
  NavigationSegmentIndex,
  ResponseSegmentFingerprint,
} from './segments';
export type { NavigationSegmentIndex } from './segments';

export interface SegmentFingerprintMatch {
  responseId: string;
  promptIndex: number;
  segmentIndex: number;
  segmentCount: number;
  positionRatio: number;
  quality: ResponseSegmentFingerprint['quality'];
  blockIds: string[];
}

export type SegmentMatchSelection =
  | { status: 'none' }
  | { status: 'matched'; match: SegmentFingerprintMatch }
  | { status: 'ambiguous'; matches: SegmentFingerprintMatch[] };

/**
 * Returns verified segment matches for visible viewport text blocks.
 *
 * @example
 * const matches = await matchSegmentIndex(blocks, segmentIndex);
 */
export async function matchSegmentIndex(
  blocks: RenderedTextBlock[],
  segmentIndex: NavigationSegmentIndex
): Promise<SegmentFingerprintMatch[]> {
  const matches: SegmentFingerprintMatch[] = [];

  for (const segment of segmentIndex) {
    const blockIds: string[] = [];

    for (const block of blocks) {
      if (await verifyFingerprintMatch(block.text, segment)) {
        blockIds.push(block.id);
      }
    }

    if (blockIds.length === 0) continue;

    matches.push({
      responseId: segment.responseId,
      promptIndex: segment.promptIndex,
      segmentIndex: segment.segmentIndex,
      segmentCount: segment.segmentCount,
      positionRatio: segment.positionRatio,
      quality: segment.quality,
      blockIds,
    });
  }

  return matches.sort(
    (first, second) =>
      getQualityScore(second.quality) - getQualityScore(first.quality) ||
      first.promptIndex - second.promptIndex ||
      first.segmentIndex - second.segmentIndex
  );
}

/**
 * Selects a segment only when the strongest quality has one logical match.
 */
export function selectBestSegmentMatch(
  matches: SegmentFingerprintMatch[]
): SegmentMatchSelection {
  if (matches.length === 0) return { status: 'none' };

  const highestQuality = Math.max(
    ...matches.map(({ quality }) => getQualityScore(quality))
  );
  const strongestMatches = matches.filter(
    ({ quality }) => getQualityScore(quality) === highestQuality
  );
  const uniqueMatches = strongestMatches.filter(
    (match, index, candidates) =>
      candidates.findIndex(
        (candidate) =>
          candidate.responseId === match.responseId &&
          candidate.promptIndex === match.promptIndex &&
          candidate.segmentIndex === match.segmentIndex
      ) === index
  );

  if (uniqueMatches.length !== 1) {
    return {
      status: 'ambiguous',
      matches: uniqueMatches,
    };
  }

  return {
    status: 'matched',
    match: uniqueMatches[0]!,
  };
}

/**
 * Converts segment quality into matching precedence.
 */
function getQualityScore(
  quality: ResponseSegmentFingerprint['quality']
): number {
  return quality === 'observed' ? 2 : 1;
}
