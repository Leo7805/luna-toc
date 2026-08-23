/** Tests platform-independent visible prompt position resolution. */
import { describe, expect, it } from 'vitest';
import {
  resolveVisiblePromptPosition,
  type VisiblePromptPosition,
} from '@/navigation/jump/visiblePositionResolver';
import {
  createResponseFingerprints,
  createSha256,
} from '@/navigation/fingerprint/generator';
import type {
  NavigationFingerprintIndex,
  ResponseFingerprintRecord,
} from '@/navigation/fingerprint/index';
import { createDerivedResponseSegments } from '@/navigation/fingerprint/segments';

async function createRecord(
  responseId: string,
  promptIndex: number,
  text: string
): Promise<ResponseFingerprintRecord> {
  return {
    responseId,
    promptIndex,
    quality: 'derived',
    fingerprints: await createResponseFingerprints(
      { id: responseId, text },
      {
        countPerAssistant: 2,
        probeLength: 8,
        verificationLength: 16,
      }
    ),
  };
}

describe('visible prompt position resolver', () => {
  it('returns segment coordinates before whole-response matches', async () => {
    const text = 'A distinctive segment of the rendered response';
    const segments = await createDerivedResponseSegments(
      { id: 'response-segmented', text },
      6,
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
    const wholeResponseIndex = [
      await createRecord('different-response', 2, text),
    ];

    const position = await resolveVisiblePromptPosition(
      [{ id: 'visible-block', text }],
      wholeResponseIndex,
      segments
    );

    expect(position).toMatchObject({
      status: 'located',
      matchedBlocks: [
        {
          blockId: 'visible-block',
          promptIndex: 6,
          source: 'segment',
          segmentIndex: 0,
          segmentCount: 1,
          positionRatio: 0,
          segmentQuality: 'derived',
        },
      ],
    });
  });

  it('matches segments against viewport text instead of the full response', async () => {
    const verificationText = 'verification';
    const segmentIndex = [
      {
        responseId: 'response-1',
        promptIndex: 3,
        segmentIndex: 2,
        segmentCount: 4,
        positionRatio: 0.5,
        probeText: 'viewport',
        verificationHash: await createSha256(verificationText),
        verificationLength: verificationText.length,
        quality: 'observed' as const,
      },
    ];

    const position = await resolveVisiblePromptPosition(
      [
        {
          id: 'response-1',
          text: 'The complete response contains unrelated leading text',
        },
      ],
      [],
      segmentIndex,
      [{ id: 'response-1', text: `viewport${verificationText}` }]
    );

    expect(position).toMatchObject({
      status: 'located',
      matchedBlocks: [
        {
          blockId: 'response-1',
          promptIndex: 3,
          source: 'segment',
          segmentIndex: 2,
          segmentCount: 4,
          positionRatio: 0.5,
          segmentQuality: 'observed',
        },
      ],
    });
  });

  it('falls back when no viewport segment text is available', async () => {
    const index = [
      await createRecord('response-1', 4, 'Whole rendered response'),
    ];

    const position = await resolveVisiblePromptPosition(
      [{ id: 'visible-block', text: 'Whole rendered response' }],
      index,
      [
        {
          responseId: 'segment-response',
          promptIndex: 2,
          segmentIndex: 0,
          segmentCount: 1,
          positionRatio: 0,
          probeText: 'segment',
          verificationHash: await createSha256('verification'),
          verificationLength: 12,
          quality: 'derived',
        },
      ],
      []
    );

    expect(position).toMatchObject({
      status: 'located',
      matchedBlocks: [
        {
          blockId: 'visible-block',
          promptIndex: 4,
          source: 'fingerprint',
        },
      ],
    });
  });

  it('falls back to response IDs when fingerprints do not match', async () => {
    const index = [
      await createRecord('response-1', 4, 'Original response text'),
    ];

    await expect(
      resolveVisiblePromptPosition(
        [{ id: 'response-1', text: 'Different rendered text' }],
        index
      )
    ).resolves.toEqual({
      status: 'located',
      firstPromptIndex: 4,
      lastPromptIndex: 4,
      matchedPromptIndexes: [4],
      matchedBlockIds: ['response-1'],
      matchedBlocks: [
        {
          blockId: 'response-1',
          promptIndex: 4,
          source: 'response-id',
        },
      ],
    });
  });

  it('uses fingerprints when rendered IDs are unavailable', async () => {
    const index = [
      await createRecord(
        'response-1',
        2,
        'A distinctive rendered response used for location'
      ),
    ];

    const position = await resolveVisiblePromptPosition(
      [
        {
          id: 'chatgpt-assistant-0',
          text: 'A distinctive rendered response used for location',
        },
      ],
      index
    );

    expect(position).toMatchObject({
      status: 'located',
      firstPromptIndex: 2,
      lastPromptIndex: 2,
      matchedPromptIndexes: [2],
      matchedBlocks: [
        {
          blockId: 'chatgpt-assistant-0',
          promptIndex: 2,
          source: 'fingerprint',
        },
      ],
    });
  });

  it('prefers a fingerprint match over a conflicting response ID', async () => {
    const index = [
      await createRecord('response-1', 4, 'Original response text'),
      await createRecord(
        'response-2',
        2,
        'A distinctive rendered response used for location'
      ),
    ];

    const position = await resolveVisiblePromptPosition(
      [
        {
          id: 'response-1',
          text: 'A distinctive rendered response used for location',
        },
      ],
      index
    );

    expect(position).toMatchObject({
      status: 'located',
      matchedBlocks: [
        {
          blockId: 'response-1',
          promptIndex: 2,
          source: 'fingerprint',
        },
      ],
    });
  });

  it('returns the ordered range covered by multiple rendered responses', async () => {
    const index = [
      await createRecord('response-4', 4, 'Fourth response'),
      await createRecord('response-2', 2, 'Second response'),
      await createRecord('response-3', 3, 'Third response'),
    ];

    const position = await resolveVisiblePromptPosition(
      [
        { id: 'response-4', text: 'Fourth response' },
        { id: 'response-2', text: 'Second response' },
        { id: 'response-3', text: 'Third response' },
      ],
      index
    );

    expect(position).toEqual({
      status: 'located',
      firstPromptIndex: 2,
      lastPromptIndex: 4,
      matchedPromptIndexes: [2, 3, 4],
      matchedBlockIds: ['response-4', 'response-2', 'response-3'],
      matchedBlocks: [
        {
          blockId: 'response-4',
          promptIndex: 4,
          source: 'fingerprint',
        },
        {
          blockId: 'response-2',
          promptIndex: 2,
          source: 'fingerprint',
        },
        {
          blockId: 'response-3',
          promptIndex: 3,
          source: 'fingerprint',
        },
      ],
    });
  });

  it('rejects equally strong fingerprint candidates as ambiguous', async () => {
    const firstRecord = await createRecord(
      'response-1',
      1,
      'Shared rendered response'
    );
    const duplicateRecord: ResponseFingerprintRecord = {
      responseId: 'response-2',
      promptIndex: 5,
      quality: 'derived',
      fingerprints: firstRecord.fingerprints.map((fingerprint) => ({
        ...fingerprint,
        responseId: 'response-2',
      })),
    };

    const position = await resolveVisiblePromptPosition(
      [{ id: 'unknown', text: 'Shared rendered response' }],
      [firstRecord, duplicateRecord]
    );

    expect(position).toEqual({
      status: 'ambiguous',
      candidatePromptIndexes: [1, 5],
      ambiguousBlockIds: ['unknown'],
    });
  });

  it('rejects duplicate response IDs assigned to different prompts', async () => {
    const index: NavigationFingerprintIndex = [
      await createRecord('duplicate-response', 0, 'First text'),
      await createRecord('duplicate-response', 6, 'Second text'),
    ];

    const position = await resolveVisiblePromptPosition(
      [{ id: 'duplicate-response', text: 'Rendered text' }],
      index
    );

    expect(position).toEqual({
      status: 'ambiguous',
      candidatePromptIndexes: [0, 6],
      ambiguousBlockIds: ['duplicate-response'],
    });
  });

  it.each([
    [[], []],
    [[{ id: 'unknown', text: 'Unknown response' }], []],
  ])(
    'returns none when no visible position can be resolved',
    async (blocks, index) => {
      const position: VisiblePromptPosition =
        await resolveVisiblePromptPosition(blocks, index);

      expect(position).toEqual({ status: 'none' });
    }
  );
});
