/** @vitest-environment jsdom */
/** Tests viewport segments measured from rendered DOM geometry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateObservedSegmentTargetOffsets,
  createObservedResponseSegments,
  extractRenderedTextWithinVerticalBounds,
} from '@/navigation/fingerprint/segments';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('observed response segments', () => {
  it('spaces samples across actual viewport-sized content', () => {
    expect(
      calculateObservedSegmentTargetOffsets(1_600, 800, {
        segmentViewportRatio: 0.75,
        maximumSegmentsPerAssistant: 20,
      })
    ).toEqual([0, 1_600 / 3, 3_200 / 3]);
  });

  it('creates observed fingerprints from measured text positions', async () => {
    const content = document.createElement('div');
    const textNode = document.createTextNode(
      'abcdefghijklmnopqrstuvwxyz'.repeat(20)
    );
    content.append(textNode);
    document.body.append(content);
    setElementRect(content, { top: 100, height: 900 });
    mockTextRangeLayout(textNode, { top: 100, height: 900 });

    const segments = await createObservedResponseSegments(
      {
        responseId: 'response-1',
        promptIndex: 4,
        contentElements: [content],
        viewportWidth: 1_280,
        viewportHeight: 400,
      },
      {
        probeLength: 8,
        verificationLength: 16,
        segmentViewportRatio: 0.75,
        segmentOverlapRatio: 0.15,
        estimatedCharsPerVisualLine: 60,
        estimatedRowsPerViewport: 30,
        maximumSegmentsPerAssistant: 20,
      }
    );

    expect(segments).toHaveLength(3);
    expect(segments.map(({ segmentIndex }) => segmentIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(segments[1]).toMatchObject({
      responseId: 'response-1',
      promptIndex: 4,
      segmentCount: 3,
      quality: 'observed',
      viewportWidth: 1_280,
      viewportHeight: 400,
    });
    expect(segments[1]?.positionRatio).toBeCloseTo(1 / 3);
    expect(segments[1]?.verificationHash).toHaveLength(64);
  });

  it('extracts only text intersecting the requested vertical bounds', () => {
    const content = document.createElement('div');
    const textNode = document.createTextNode(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    );
    content.append(textNode);
    document.body.append(content);
    setElementRect(content, { top: 100, height: 260 });
    mockTextRangeLayout(textNode, { top: 100, height: 260 });

    const text = extractRenderedTextWithinVerticalBounds(
      [content],
      200,
      300
    );

    expect(text.length).toBeGreaterThan(5);
    expect(text).not.toContain('A');
    expect(text).not.toContain('Z');
  });
});

/**
 * Defines element geometry used by rendered segment tests.
 */
function setElementRect(
  element: HTMLElement,
  { top, height }: { top: number; height: number }
): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      right: 800,
      bottom: top + height,
      left: 0,
      width: 800,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Maps text offsets to monotonically increasing vertical Range geometry.
 */
function mockTextRangeLayout(
  textNode: Text,
  { top, height }: { top: number; height: number }
): void {
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let startOffset = 0;
    let endOffset = 0;

    return {
      setStart: (_node: Node, offset: number) => {
        startOffset = offset;
      },
      setEnd: (_node: Node, offset: number) => {
        endOffset = offset;
      },
      getBoundingClientRect: () => {
        const length = Math.max(1, textNode.data.length);
        const rangeTop = top + (startOffset / length) * height;
        const rangeBottom = top + (endOffset / length) * height;

        return {
          x: 0,
          y: rangeTop,
          top: rangeTop,
          right: 800,
          bottom: rangeBottom,
          left: 0,
          width: 800,
          height: Math.max(0, rangeBottom - rangeTop),
          toJSON: () => ({}),
        } as DOMRect;
      },
    } as unknown as Range;
  });
}
