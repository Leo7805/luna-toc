/** Tests deterministic response fingerprint generation. */
import { describe, expect, it } from 'vitest';
import {
  calculateFingerprintOffsets,
  createResponseFingerprints,
  createSha256,
  type FingerprintOptions,
} from '@/features/navigation/fingerprint/generator';
import { normalizeComparableText } from '@/features/navigation/fingerprint/comparableText';

const options: FingerprintOptions = {
  countPerAssistant: 3,
  probeLength: 40,
  verificationLength: 256,
};

describe('response fingerprints', () => {
  it('normalizes whitespace consistently', () => {
    expect(normalizeComparableText(' Hello\n\t  world ')).toBe('Hello world');
    expect(normalizeComparableText('Hello world')).toBe('Hello world');
  });

  it('does not create fingerprints for empty text', async () => {
    await expect(
      createResponseFingerprints({ id: 'empty', text: ' \n ' }, options)
    ).resolves.toEqual([]);
  });

  it('creates one fingerprint for a short response', async () => {
    const fingerprints = await createResponseFingerprints(
      { id: 'short', text: 'Short answer' },
      options
    );

    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0]).toMatchObject({
      responseId: 'short',
      sampleIndex: 0,
      textOffset: 0,
      probeText: 'Short answer',
      verificationLength: 0,
    });
    expect(fingerprints[0]?.verificationHash).toHaveLength(64);
  });

  it('samples a long response across its full length', async () => {
    const text = Array.from(
      { length: 1000 },
      (_, index) => String(index % 10)
    ).join('');
    const fingerprints = await createResponseFingerprints(
      { id: 'long', text },
      options
    );

    expect(calculateFingerprintOffsets(text.length, options)).toEqual([
      0, 352, 704,
    ]);
    expect(fingerprints.map(({ textOffset }) => textOffset)).toEqual([
      0, 352, 704,
    ]);
    expect(fingerprints).toHaveLength(options.countPerAssistant);
    fingerprints.forEach((fingerprint) => {
      expect(fingerprint.probeText).toHaveLength(options.probeLength);
      expect(fingerprint.verificationLength).toBe(
        options.verificationLength
      );
    });
  });

  it('creates stable hashes that distinguish verification text', async () => {
    const firstHash = await createSha256('same text');
    const secondHash = await createSha256('same text');
    const differentHash = await createSha256('different text');

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(differentHash);
  });
});
