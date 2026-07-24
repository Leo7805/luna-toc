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
  quality: 'derived' | 'observed';
  viewportWidth?: number;
  viewportHeight?: number;
}

interface EstimatedVisualUnit {
  startOffset: number;
  endOffset: number;
}

export interface ObservedSegmentSource {
  responseId: string;
  promptIndex: number;
  contentElements: HTMLElement[];
  viewportWidth: number;
  viewportHeight: number;
}

interface ObservedTextPosition {
  nodeIndex: number;
  characterOffset: number;
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
 * Creates viewport-spaced fingerprints from actual rendered text geometry.
 *
 * @example
 * const segments = await createObservedResponseSegments({
 *   responseId,
 *   promptIndex,
 *   contentElements,
 *   viewportWidth,
 *   viewportHeight,
 * });
 */
export async function createObservedResponseSegments(
  source: ObservedSegmentSource,
  options: DerivedSegmentOptions = APP_CONFIG.navigation.fingerprint
): Promise<ResponseSegmentFingerprint[]> {
  const contentElements = source.contentElements.filter(
    (element) => element.isConnected
  );
  const textNodes = collectTextNodes(contentElements);

  if (contentElements.length === 0 || textNodes.length === 0) return [];

  const contentRects = contentElements.map((element) =>
    element.getBoundingClientRect()
  );
  const contentTop = Math.min(...contentRects.map(({ top }) => top));
  const contentBottom = Math.max(
    ...contentRects.map(({ bottom }) => bottom)
  );
  const contentHeight = Math.max(0, contentBottom - contentTop);

  if (contentHeight <= 0 || source.viewportHeight <= 0) return [];

  const targetOffsets = calculateObservedSegmentTargetOffsets(
    contentHeight,
    source.viewportHeight,
    options
  );
  const candidates = targetOffsets
    .map((targetOffset) => {
      const position = findObservedTextPosition(
        textNodes,
        contentTop + targetOffset
      );
      if (!position) return null;

      const comparableText = normalizeComparableText(
        getTextFromObservedPosition(textNodes, position)
      );
      if (!comparableText) return null;

      return {
        positionRatio: targetOffset / contentHeight,
        comparableText,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        positionRatio: number;
        comparableText: string;
      } => Boolean(candidate)
    )
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex(
          ({ comparableText }) =>
            comparableText.slice(0, options.probeLength) ===
            candidate.comparableText.slice(0, options.probeLength)
        ) === index
    );

  return Promise.all(
    candidates.map(async ({ positionRatio, comparableText }, segmentIndex) => {
      const probeText = comparableText.slice(0, options.probeLength);
      const verificationText = comparableText.slice(
        probeText.length,
        probeText.length + options.verificationLength
      );

      return {
        responseId: source.responseId,
        promptIndex: source.promptIndex,
        segmentIndex,
        segmentCount: candidates.length,
        positionRatio,
        probeText,
        verificationHash: await createSha256(
          verificationText || probeText
        ),
        verificationLength: verificationText.length,
        quality: 'observed',
        viewportWidth: source.viewportWidth,
        viewportHeight: source.viewportHeight,
      };
    })
  );
}

/**
 * Returns vertical sample offsets spaced by rendered viewport fractions.
 */
export function calculateObservedSegmentTargetOffsets(
  contentHeight: number,
  viewportHeight: number,
  options: Pick<
    DerivedSegmentOptions,
    'segmentViewportRatio' | 'maximumSegmentsPerAssistant'
  > = APP_CONFIG.navigation.fingerprint
): number[] {
  if (contentHeight <= 0 || viewportHeight <= 0) return [];

  const targetSpacing = Math.max(
    1,
    viewportHeight * options.segmentViewportRatio
  );
  const segmentCount = Math.min(
    Math.max(1, Math.trunc(options.maximumSegmentsPerAssistant)),
    Math.max(1, Math.ceil(contentHeight / targetSpacing))
  );

  if (segmentCount === 1) return [0];

  return Array.from({ length: segmentCount }, (_, index) =>
    (contentHeight * index) / segmentCount
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

/**
 * Collects non-empty text nodes owned by rendered response content.
 */
function collectTextNodes(elements: HTMLElement[]): Text[] {
  return elements.flatMap((element) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT
    );
    const nodes: Text[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (currentNode.textContent?.trim()) {
        nodes.push(currentNode as Text);
      }
      currentNode = walker.nextNode();
    }

    return nodes;
  });
}

/**
 * Finds the first rendered character at or below a vertical target.
 */
function findObservedTextPosition(
  textNodes: Text[],
  targetY: number
): ObservedTextPosition | null {
  for (const [nodeIndex, textNode] of textNodes.entries()) {
    const textLength = textNode.data.length;
    if (textLength === 0) continue;

    const nodeRect = measureTextRange(textNode, 0, textLength);
    if (nodeRect.bottom < targetY) continue;

    let lowerOffset = 0;
    let upperOffset = textLength - 1;

    while (lowerOffset < upperOffset) {
      const middleOffset = Math.floor((lowerOffset + upperOffset) / 2);
      const characterRect = measureTextRange(
        textNode,
        middleOffset,
        middleOffset + 1
      );

      if (characterRect.bottom < targetY) {
        lowerOffset = middleOffset + 1;
      } else {
        upperOffset = middleOffset;
      }
    }

    return {
      nodeIndex,
      characterOffset: lowerOffset,
    };
  }

  const lastNode = textNodes.at(-1);
  if (!lastNode) return null;

  return {
    nodeIndex: textNodes.length - 1,
    characterOffset: Math.max(0, lastNode.data.length - 1),
  };
}

/**
 * Returns rendered text beginning at one measured DOM character.
 */
function getTextFromObservedPosition(
  textNodes: Text[],
  position: ObservedTextPosition
): string {
  return textNodes
    .slice(position.nodeIndex)
    .map((node, relativeIndex) =>
      relativeIndex === 0
        ? node.data.slice(position.characterOffset)
        : node.data
    )
    .join(' ');
}

/**
 * Measures a DOM text range using the browser's layout engine.
 */
function measureTextRange(
  textNode: Text,
  startOffset: number,
  endOffset: number
): DOMRect {
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  return range.getBoundingClientRect();
}
