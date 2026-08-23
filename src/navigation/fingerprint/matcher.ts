/**
 * Matches rendered text blocks against platform-independent prompt fingerprints.
 */
import { createSha256 } from './generator';
import type { NavigationFingerprintIndex } from './index';
import { normalizeComparableText } from './comparableText';

export interface RenderedTextBlock {
  id: string;
  text: string;
}

export interface PromptFingerprintMatch {
  promptIndex: number;
  matchedFingerprintCount: number;
  responseIds: string[];
  blockIds: string[];
}

export interface VerifiableFingerprint {
  probeText: string;
  verificationHash: string;
  verificationLength: number;
}

export type PromptMatchSelection =
  | { status: 'none' }
  | { status: 'matched'; match: PromptFingerprintMatch }
  | { status: 'ambiguous'; matches: PromptFingerprintMatch[] };

/**
 * Finds every occurrence of a probe in normalized rendered text.
 *
 * @example
 * findProbeOffsets('alpha beta alpha', 'alpha') returns [0, 11].
 */
export function findProbeOffsets(text: string, probeText: string): number[] {
  const normalizedText = normalizeComparableText(text);
  const normalizedProbe = normalizeComparableText(probeText);

  if (!normalizedText || !normalizedProbe) return [];

  return findProbeOffsetsInNormalizedText(normalizedText, normalizedProbe);
}

/**
 * Verifies whether any matching probe occurrence has the expected trailing hash.
 *
 * @example
 * const matches = await verifyFingerprintMatch(renderedText, fingerprint);
 */
export async function verifyFingerprintMatch(
  renderedText: string,
  fingerprint: VerifiableFingerprint
): Promise<boolean> {
  const normalizedText = normalizeComparableText(renderedText);
  const probeText = fingerprint.probeText;
  const offsets = findProbeOffsetsInNormalizedText(
    normalizedText,
    probeText
  );

  for (const offset of offsets) {
    const verificationStart = offset + probeText.length;
    const verificationText = normalizedText.slice(
      verificationStart,
      verificationStart + fingerprint.verificationLength
    );

    if (
      fingerprint.verificationLength > 0 &&
      verificationText.length !== fingerprint.verificationLength
    ) {
      continue;
    }

    const hashSource = verificationText || probeText;

    if ((await createSha256(hashSource)) === fingerprint.verificationHash) {
      return true;
    }
  }

  return false;
}

/**
 * Matches visible text blocks and groups verified fingerprints by prompt index.
 *
 * @example
 * const matches = await matchFingerprintIndex(blocks, fingerprintIndex);
 */
export async function matchFingerprintIndex(
  blocks: RenderedTextBlock[],
  fingerprintIndex: NavigationFingerprintIndex
): Promise<PromptFingerprintMatch[]> {
  const normalizedBlocks = blocks.map((block) => ({
    id: block.id,
    text: normalizeComparableText(block.text),
  }));
  const matchesByPrompt = new Map<
    number,
    {
      matchedFingerprintCount: number;
      responseIds: Set<string>;
      blockIds: Set<string>;
    }
  >();

  for (const record of fingerprintIndex) {
    const promptMatch = matchesByPrompt.get(record.promptIndex) || {
      matchedFingerprintCount: 0,
      responseIds: new Set<string>(),
      blockIds: new Set<string>(),
    };
    let matchedFingerprintCount = 0;
    const matchingResponseBlockIds = new Set<string>();

    for (const fingerprint of record.fingerprints) {
      const matchingBlockIds: string[] = [];

      for (const block of normalizedBlocks) {
        if (await verifyFingerprintMatch(block.text, fingerprint)) {
          matchingBlockIds.push(block.id);
        }
      }

      if (matchingBlockIds.length === 0) continue;

      matchedFingerprintCount += 1;
      matchingBlockIds.forEach((blockId) =>
        matchingResponseBlockIds.add(blockId)
      );
    }

    if (matchedFingerprintCount === 0) continue;

    promptMatch.matchedFingerprintCount += matchedFingerprintCount;
    promptMatch.responseIds.add(record.responseId);
    matchingResponseBlockIds.forEach((blockId) =>
      promptMatch.blockIds.add(blockId)
    );
    matchesByPrompt.set(record.promptIndex, promptMatch);
  }

  const matches = Array.from(
    matchesByPrompt,
    ([
      promptIndex,
      { matchedFingerprintCount, responseIds, blockIds },
    ]) => ({
      promptIndex,
      matchedFingerprintCount,
      responseIds: [...responseIds],
      blockIds: [...blockIds],
    })
  );

  return matches.sort(
    (first, second) =>
      second.matchedFingerprintCount - first.matchedFingerprintCount ||
      first.promptIndex - second.promptIndex
  );
}

/**
 * Selects a prompt only when it has a unique highest fingerprint score.
 *
 * @example
 * const selection = selectBestPromptMatch(matches);
 */
export function selectBestPromptMatch(
  matches: PromptFingerprintMatch[]
): PromptMatchSelection {
  if (matches.length === 0) return { status: 'none' };

  const highestScore = Math.max(
    ...matches.map(({ matchedFingerprintCount }) => matchedFingerprintCount)
  );
  const strongestMatches = matches.filter(
    ({ matchedFingerprintCount }) =>
      matchedFingerprintCount === highestScore
  );

  if (strongestMatches.length > 1) {
    return {
      status: 'ambiguous',
      matches: strongestMatches,
    };
  }

  return {
    status: 'matched',
    match: strongestMatches[0]!,
  };
}

/**
 * Finds overlapping probe occurrences in already normalized text.
 */
function findProbeOffsetsInNormalizedText(
  normalizedText: string,
  normalizedProbe: string
): number[] {
  if (!normalizedText || !normalizedProbe) return [];

  const offsets: number[] = [];
  let searchStart = 0;

  while (searchStart <= normalizedText.length - normalizedProbe.length) {
    const offset = normalizedText.indexOf(normalizedProbe, searchStart);

    if (offset === -1) break;

    offsets.push(offset);
    searchStart = offset + 1;
  }

  return offsets;
}
