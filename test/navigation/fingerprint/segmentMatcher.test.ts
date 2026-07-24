/** Tests matching visible viewport text to logical response segments. */
import { describe, expect, it } from 'vitest';
import { createSha256 } from '@/features/navigation/fingerprint/generator';
import { normalizeComparableText } from '@/features/navigation/fingerprint/comparableText';
import {
  matchSegmentIndex,
  selectBestSegmentMatch,
} from '@/features/navigation/fingerprint/segmentMatcher';
import type { ResponseSegmentFingerprint } from '@/features/navigation/fingerprint/segments';

async function createSegment({
  responseId,
  promptIndex,
  segmentIndex,
  quality,
  text,
}: {
  responseId: string;
  promptIndex: number;
  segmentIndex: number;
  quality: ResponseSegmentFingerprint['quality'];
  text: string;
}): Promise<ResponseSegmentFingerprint> {
  const comparableText = normalizeComparableText(text);
  const probeText = comparableText.slice(0, 4);
  const verificationText = comparableText.slice(4, 12);

  return {
    responseId,
    promptIndex,
    segmentIndex,
    segmentCount: 3,
    positionRatio: segmentIndex / 3,
    probeText,
    verificationHash: await createSha256(
      verificationText || probeText
    ),
    verificationLength: verificationText.length,
    quality,
  };
}

describe('segment matcher', () => {
  it('matches a verified viewport segment', async () => {
    const segment = await createSegment({
      responseId: 'response-1',
      promptIndex: 8,
      segmentIndex: 2,
      quality: 'derived',
      text: 'segment-two-content',
    });
    const matches = await matchSegmentIndex(
      [{ id: 'visible-block', text: 'segment-two-content' }],
      [segment]
    );

    expect(selectBestSegmentMatch(matches)).toMatchObject({
      status: 'matched',
      match: {
        promptIndex: 8,
        segmentIndex: 2,
        quality: 'derived',
      },
    });
  });

  it('prefers observed geometry over a derived match', async () => {
    const derived = await createSegment({
      responseId: 'response-derived',
      promptIndex: 3,
      segmentIndex: 1,
      quality: 'derived',
      text: 'shared-segment-text',
    });
    const observed = await createSegment({
      responseId: 'response-observed',
      promptIndex: 7,
      segmentIndex: 2,
      quality: 'observed',
      text: 'shared-segment-text',
    });
    const selection = selectBestSegmentMatch(
      await matchSegmentIndex(
        [{ id: 'visible-block', text: 'shared-segment-text' }],
        [derived, observed]
      )
    );

    expect(selection).toMatchObject({
      status: 'matched',
      match: {
        promptIndex: 7,
        segmentIndex: 2,
        quality: 'observed',
      },
    });
  });

  it('reports equally strong observed segments as ambiguous', async () => {
    const first = await createSegment({
      responseId: 'response-1',
      promptIndex: 1,
      segmentIndex: 0,
      quality: 'observed',
      text: 'shared-segment-text',
    });
    const second = await createSegment({
      responseId: 'response-2',
      promptIndex: 5,
      segmentIndex: 1,
      quality: 'observed',
      text: 'shared-segment-text',
    });

    expect(
      selectBestSegmentMatch(
        await matchSegmentIndex(
          [{ id: 'visible-block', text: 'shared-segment-text' }],
          [first, second]
        )
      )
    ).toMatchObject({
      status: 'ambiguous',
      matches: [{ promptIndex: 1 }, { promptIndex: 5 }],
    });
  });

  it('returns none when the probe or verification hash differs', async () => {
    const segment = await createSegment({
      responseId: 'response-1',
      promptIndex: 1,
      segmentIndex: 0,
      quality: 'observed',
      text: 'matchingGOODtext',
    });

    await expect(
      matchSegmentIndex(
        [{ id: 'visible-block', text: 'matchingBAD-text' }],
        [segment]
      )
    ).resolves.toEqual([]);
  });
});
