/** Tests derived viewport-segment estimates for unrendered responses. */
import { describe, expect, it } from 'vitest';
import {
  calculateDerivedSegmentRanges,
  createDerivedResponseSegments,
  estimateDerivedVisualRows,
  type DerivedSegmentOptions,
} from '@/features/navigation/fingerprint/segments';

const options: DerivedSegmentOptions = {
  probeLength: 8,
  verificationLength: 16,
  segmentViewportRatio: 0.75,
  segmentOverlapRatio: 0.15,
  estimatedCharsPerVisualLine: 10,
  estimatedRowsPerViewport: 4,
  maximumSegmentsPerAssistant: 5,
};

describe('derived response segments', () => {
  it('estimates rows from newlines and long-line wrapping', () => {
    expect(estimateDerivedVisualRows('short\n123456789012345', 10)).toBe(
      3
    );
  });

  it('does not create segments for empty comparable text', async () => {
    expect(calculateDerivedSegmentRanges(' \n---\n ', options)).toEqual(
      []
    );
    await expect(
      createDerivedResponseSegments(
        { id: 'empty-response', text: ' \n---\n ' },
        0,
        options
      )
    ).resolves.toEqual([]);
  });

  it('creates one derived segment for a short response', async () => {
    const segments = await createDerivedResponseSegments(
      { id: 'response-1', text: 'Short response text' },
      3,
      options
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      responseId: 'response-1',
      promptIndex: 3,
      segmentIndex: 0,
      segmentCount: 1,
      positionRatio: 0,
      quality: 'derived',
    });
    expect(segments[0]?.verificationHash).toHaveLength(64);
  });

  it('splits a long response without Markdown newlines', async () => {
    const segments = await createDerivedResponseSegments(
      {
        id: 'long-response',
        text: 'abcdefghijklmnopqrstuvwxyz'.repeat(8),
      },
      7,
      options
    );

    expect(segments).toHaveLength(5);
    expect(segments.map(({ segmentIndex }) => segmentIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(segments.at(-1)?.positionRatio).toBeGreaterThan(0.7);
  });

  it('creates ordered overlapping ranges from multiline Markdown', () => {
    const text = [
      '# Heading',
      '',
      'First paragraph with enough text to wrap.',
      '',
      'Second paragraph with enough text to wrap.',
      '',
      'Closing line.',
    ].join('\n');
    const ranges = calculateDerivedSegmentRanges(text, options);

    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]?.startOffset).toBe(0);
    expect(ranges.at(-1)?.endOffset).toBe(text.length);
    expect(
      ranges.every(
        (range, index) =>
          index === 0 ||
          range.startOffset <= ranges[index - 1]!.endOffset
      )
    ).toBe(true);
  });

  it('never exceeds the configured segment limit', () => {
    const ranges = calculateDerivedSegmentRanges(
      '0123456789'.repeat(100),
      {
        ...options,
        maximumSegmentsPerAssistant: 3,
      }
    );

    expect(ranges).toHaveLength(3);
  });
});
