/**
 * Builds approximate viewport-sized fingerprints from unrendered responses.
 */
import { APP_CONFIG } from '@/config/config';
import type { NavigationTextMessage } from '@/features/navigation/navigationData';
import { normalizeComparableText } from './comparableText';
import { createSha256 } from './generator';

export interface DerivedSegmentOptions {
  probeLength: number;
  verificationLength: number;
  segmentViewportRatio: number;
  segmentOverlapRatio: number;
  estimatedCharsPerVisualLine: number;
  estimatedRowsPerViewport: number;
  maximumSegmentsPerAssistant: number;
}

export interface DerivedSegmentRange {
  startOffset: number;
  endOffset: number;
  positionRatio: number;
}

export interface ResponseSegmentFingerprint {
  responseId: string;
  promptIndex: number;
  segmentIndex: number;
  segmentCount: number;
  positionRatio: number;
  probeText: string;
  verificationHash: string;
  verificationLength: number;
  quality: 'derived';
}

interface EstimatedVisualUnit {
  startOffset: number;
  endOffset: number;
}

/**
 * Estimates visual rows from logical lines and long-line wrapping.
 *
 * @example
 * estimateDerivedVisualRows('First line\nSecond line', 60) === 2;
 */
export function estimateDerivedVisualRows(
  text: string,
  estimatedCharsPerVisualLine: number
): number {
  return createEstimatedVisualUnits(
    text,
    estimatedCharsPerVisualLine
  ).length;
}

/**
 * Calculates overlapping source ranges for approximate viewport segments.
 *
 * @example
 * const ranges = calculateDerivedSegmentRanges(markdown, options);
 */
export function calculateDerivedSegmentRanges(
  text: string,
  options: DerivedSegmentOptions = APP_CONFIG.navigation.fingerprint
): DerivedSegmentRange[] {
  if (!normalizeComparableText(text)) return [];

  const units = createEstimatedVisualUnits(
    text,
    options.estimatedCharsPerVisualLine
  );
  if (units.length === 0) return [];

  const rowsPerSegment = Math.max(
    1,
    options.estimatedRowsPerViewport *
      options.segmentViewportRatio
  );
  const segmentCount = Math.min(
    Math.max(1, Math.trunc(options.maximumSegmentsPerAssistant)),
    Math.max(1, Math.ceil(units.length / rowsPerSegment))
  );
  const unitsPerSegment = Math.ceil(units.length / segmentCount);
  const overlapUnits = Math.max(
    0,
    Math.round(unitsPerSegment * options.segmentOverlapRatio)
  );

  return Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const coreStartIndex = Math.min(
      units.length - 1,
      segmentIndex * unitsPerSegment
    );
    const coreEndIndex = Math.min(
      units.length,
      (segmentIndex + 1) * unitsPerSegment
    );
    const startIndex = Math.max(0, coreStartIndex - overlapUnits);
    const endIndex = Math.min(
      units.length,
      coreEndIndex + overlapUnits
    );

    return {
      startOffset: units[startIndex]!.startOffset,
      endOffset: units[endIndex - 1]!.endOffset,
      positionRatio:
        units.length === 1 ? 0 : coreStartIndex / (units.length - 1),
    };
  });
}

/**
 * Creates derived segment fingerprints without requiring rendered DOM.
 *
 * @example
 * const segments = await createDerivedResponseSegments(
 *   response,
 *   promptIndex
 * );
 */
export async function createDerivedResponseSegments(
  response: NavigationTextMessage,
  promptIndex: number,
  options: DerivedSegmentOptions = APP_CONFIG.navigation.fingerprint
): Promise<ResponseSegmentFingerprint[]> {
  const ranges = calculateDerivedSegmentRanges(response.text, options);
  const candidates = ranges
    .map((range) => ({
      range,
      comparableText: normalizeComparableText(
        response.text.slice(range.startOffset, range.endOffset)
      ),
    }))
    .filter(({ comparableText }) => comparableText.length > 0);

  return Promise.all(
    candidates.map(async ({ range, comparableText }, segmentIndex) => {
      const probeText = comparableText.slice(0, options.probeLength);
      const verificationText = comparableText.slice(
        probeText.length,
        probeText.length + options.verificationLength
      );

      return {
        responseId: response.id,
        promptIndex,
        segmentIndex,
        segmentCount: candidates.length,
        positionRatio: range.positionRatio,
        probeText,
        verificationHash: await createSha256(
          verificationText || probeText
        ),
        verificationLength: verificationText.length,
        quality: 'derived',
      };
    })
  );
}

/**
 * Converts source lines and estimated wrapping into visual-row units.
 */
function createEstimatedVisualUnits(
  text: string,
  estimatedCharsPerVisualLine: number
): EstimatedVisualUnit[] {
  const safeLineLength = Math.max(
    1,
    Math.trunc(estimatedCharsPerVisualLine)
  );
  const units: EstimatedVisualUnit[] = [];
  let lineStartOffset = 0;

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length === 0) {
      units.push({
        startOffset: lineStartOffset,
        endOffset: lineStartOffset,
      });
    } else {
      for (
        let lineOffset = 0;
        lineOffset < line.length;
        lineOffset += safeLineLength
      ) {
        units.push({
          startOffset: lineStartOffset + lineOffset,
          endOffset:
            lineStartOffset +
            Math.min(line.length, lineOffset + safeLineLength),
        });
      }
    }

    lineStartOffset += line.length + 1;
  }

  return units;
}
