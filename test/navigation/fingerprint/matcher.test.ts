/** Tests verified fingerprint matching against generic rendered text blocks. */
import { describe, expect, it } from 'vitest';
import {
  findProbeOffsets,
  matchFingerprintIndex,
  selectBestPromptMatch,
  verifyFingerprintMatch,
} from '@/navigation/fingerprint/matcher';
import {
  createResponseFingerprints,
  type FingerprintOptions,
} from '@/navigation/fingerprint/generator';
import type { ResponseFingerprintRecord } from '@/navigation/fingerprint/index';

const options: FingerprintOptions = {
  countPerAssistant: 3,
  probeLength: 4,
  verificationLength: 8,
};

async function createRecord(
  promptIndex: number,
  responseId: string,
  text: string
): Promise<ResponseFingerprintRecord> {
  return {
    responseId,
    promptIndex,
    quality: 'derived',
    fingerprints: await createResponseFingerprints(
      { id: responseId, text },
      options
    ),
  };
}

describe('fingerprint matcher', () => {
  it('finds every probe occurrence after whitespace normalization', () => {
    expect(findProbeOffsets('alpha\n beta alpha', 'alpha')).toEqual([
      0, 11,
    ]);
  });

  it('requires both the probe and trailing hash to match', async () => {
    const [fingerprint] = await createResponseFingerprints(
      { id: 'response', text: 'sameGOODTEXTrest' },
      options
    );

    await expect(
      verifyFingerprintMatch('sameBADTEXT!rest', fingerprint!)
    ).resolves.toBe(false);
    await expect(
      verifyFingerprintMatch('sameGOODTEXTrest', fingerprint!)
    ).resolves.toBe(true);
  });

  it('preserves probe boundary spaces when locating verification text', async () => {
    const [fingerprint] = await createResponseFingerprints(
      { id: 'response', text: 'abc defghijklmnop' },
      options
    );

    expect(fingerprint?.probeText).toBe('abc ');
    await expect(
      verifyFingerprintMatch('abc\n  defghijklmnop', fingerprint!)
    ).resolves.toBe(true);
  });

  it('checks later occurrences when an earlier probe has the wrong suffix', async () => {
    const [fingerprint] = await createResponseFingerprints(
      { id: 'response', text: 'sameGOODTEXTrest' },
      options
    );

    await expect(
      verifyFingerprintMatch(
        'sameBADTEXT! filler sameGOODTEXTrest',
        fingerprint!
      )
    ).resolves.toBe(true);
  });

  it('aggregates multiple verified fingerprints under their prompt', async () => {
    const firstResponse = await createRecord(
      0,
      'response-1',
      'first response text'
    );
    const secondResponse = await createRecord(
      0,
      'response-2',
      'second response text'
    );
    const index = [
      firstResponse,
      secondResponse,
      await createRecord(1, 'response-3', 'unrelated response'),
    ];
    const matches = await matchFingerprintIndex(
      [
        { id: 'block-1', text: 'first\n response text' },
        { id: 'block-2', text: 'second response text' },
      ],
      index
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      promptIndex: 0,
      responseIds: ['response-1', 'response-2'],
      blockIds: ['block-1', 'block-2'],
    });
    expect(selectBestPromptMatch(matches)).toMatchObject({
      status: 'matched',
      match: { promptIndex: 0 },
    });
  });

  it('returns an ambiguous selection for equally strong prompts', async () => {
    const firstIndex = await createRecord(0, 'response-1', 'shared response');
    const secondIndex: ResponseFingerprintRecord = {
      responseId: 'response-2',
      promptIndex: 1,
      quality: 'derived',
      fingerprints: firstIndex.fingerprints.map((fingerprint) => ({
        ...fingerprint,
        responseId: 'response-2',
      })),
    };
    const matches = await matchFingerprintIndex(
      [{ id: 'block', text: 'shared response' }],
      [firstIndex, secondIndex]
    );

    expect(selectBestPromptMatch(matches)).toMatchObject({
      status: 'ambiguous',
      matches: [{ promptIndex: 0 }, { promptIndex: 1 }],
    });
  });

  it('returns no selection for empty text or an empty index', async () => {
    const index = [await createRecord(0, 'response', 'response text')];
    const matches = await matchFingerprintIndex(
      [{ id: 'empty', text: '' }],
      index
    );

    expect(matches).toEqual([]);
    expect(selectBestPromptMatch(matches)).toEqual({ status: 'none' });
    await expect(matchFingerprintIndex([], [])).resolves.toEqual([]);
  });

  it('does not mutate rendered blocks or fingerprint indexes', async () => {
    const blocks = [{ id: 'block', text: 'response text' }];
    const index = [await createRecord(0, 'response', 'response text')];
    const originalBlocks = structuredClone(blocks);
    const originalIndex = structuredClone(index);

    await matchFingerprintIndex(blocks, index);

    expect(blocks).toEqual(originalBlocks);
    expect(index).toEqual(originalIndex);
  });
});
