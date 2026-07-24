/**
 * Builds approximate viewport-sized fingerprints from unrendered responses.
 */
import { APP_CONFIG } from '@/config/config';
import type {
  NavigationTextMessage,
  NavigationTurn,
} from '@/features/navigation/navigationData';
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

export type NavigationSegmentIndex = ResponseSegmentFingerprint[];

export type SegmentBuildYield = () => Promise<void>;

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
 * Builds derived response segments in bounded batches without blocking the UI.
 */
export async function buildDerivedSegmentIndex(
  turns: NavigationTurn[],
  options: DerivedSegmentOptions & {
    buildBatchSize: number;
    buildTimeBudgetMs: number;
  } = APP_CONFIG.navigation.fingerprint,
  yieldControl: SegmentBuildYield = yieldSegmentBuild
): Promise<NavigationSegmentIndex> {
  const tasks = turns.flatMap((turn) =>
    turn.responses.map((response) => ({
      promptIndex: turn.promptIndex,
      response,
    }))
  );
  const index: NavigationSegmentIndex = [];
  const batchSize = Math.max(1, options.buildBatchSize);
  const timeBudgetMs = Math.max(0, options.buildTimeBudgetMs);
  let batchStartedAt = performance.now();
  let batchTaskCount = 0;

  for (const [taskIndex, task] of tasks.entries()) {
    index.push(
      ...(await createDerivedResponseSegments(
        task.response,
        task.promptIndex,
        options
      ))
    );
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
 * Merges response segments while preserving observed geometry over derived data.
 */
export function mergeSegmentIndexes(
  current: NavigationSegmentIndex,
  incoming: NavigationSegmentIndex
): NavigationSegmentIndex {
  const mergedByResponse = groupClonedSegments(current);
  const incomingByResponse = groupClonedSegments(incoming);

  incomingByResponse.forEach((incomingSegments, responseId) => {
    const currentSegments = mergedByResponse.get(responseId) || [];
    const incomingIsObserved = incomingSegments.some(
      ({ quality }) => quality === 'observed'
    );
    const currentIsObserved = currentSegments.some(
      ({ quality }) => quality === 'observed'
    );

    if (incomingIsObserved || !currentIsObserved) {
      mergedByResponse.set(responseId, incomingSegments);
      return;
    }

    const promptIndex = incomingSegments[0]?.promptIndex;
    mergedByResponse.set(
      responseId,
      currentSegments.map((segment) => ({
        ...segment,
        promptIndex: promptIndex ?? segment.promptIndex,
      }))
    );
  });

  return Array.from(mergedByResponse.values()).flat();
}

/**
 * Adds or replaces all segments belonging to one rendered response.
 */
export function upsertResponseSegments(
  current: NavigationSegmentIndex,
  incoming: ResponseSegmentFingerprint[]
): NavigationSegmentIndex {
  return mergeSegmentIndexes(current, incoming);
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
 * Extracts rendered text whose character geometry intersects vertical bounds.
 */
export function extractRenderedTextWithinVerticalBounds(
  contentElements: HTMLElement[],
  top: number,
  bottom: number
): string {
  if (bottom <= top) return '';

  const textNodes = collectTextNodes(
    contentElements.filter((element) => element.isConnected)
  );
  if (textNodes.length === 0) return '';

  const start = findObservedTextPosition(textNodes, top);
  const end = findObservedTextPosition(textNodes, bottom);
  if (!start || !end) return '';

  return getTextBetweenObservedPositions(textNodes, start, end);
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
 * Returns rendered text bounded by two measured DOM characters.
 */
function getTextBetweenObservedPositions(
  textNodes: Text[],
  start: ObservedTextPosition,
  end: ObservedTextPosition
): string {
  return textNodes
    .slice(start.nodeIndex, end.nodeIndex + 1)
    .map((node, relativeIndex, selectedNodes) => {
      const isFirst = relativeIndex === 0;
      const isLast = relativeIndex === selectedNodes.length - 1;
      const startOffset = isFirst ? start.characterOffset : 0;
      const endOffset = isLast
        ? end.characterOffset + 1
        : node.data.length;

      return node.data.slice(startOffset, endOffset);
    })
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

function yieldSegmentBuild(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function groupClonedSegments(
  segments: NavigationSegmentIndex
): Map<string, ResponseSegmentFingerprint[]> {
  const grouped = new Map<string, ResponseSegmentFingerprint[]>();

  segments.forEach((segment) => {
    const responseSegments = grouped.get(segment.responseId) || [];
    responseSegments.push({ ...segment });
    grouped.set(segment.responseId, responseSegments);
  });

  return grouped;
}
