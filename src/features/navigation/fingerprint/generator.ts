/**
 * Generates compact text fingerprints for platform-independent AI responses.
 */
import { APP_CONFIG } from '@/config/config';
import type { NavigationTextMessage } from '@/features/navigation/navigationData';
import { normalizeComparableText } from './comparableText';

export interface FingerprintOptions {
  countPerAssistant: number;
  probeLength: number;
  verificationLength: number;
}

export interface ResponseFingerprint {
  responseId: string;
  sampleIndex: number;
  textOffset: number;
  probeText: string;
  verificationHash: string;
  verificationLength: number;
}

/**
 * Calculates evenly distributed sample offsets for normalized response text.
 *
 * @example
 * calculateFingerprintOffsets(1000, {
 *   countPerAssistant: 3,
 *   probeLength: 40,
 *   verificationLength: 256,
 * });
 */
export function calculateFingerprintOffsets(
  textLength: number,
  options: FingerprintOptions
): number[] {
  if (textLength <= 0 || options.countPerAssistant <= 0) return [];

  const sampleWindowLength =
    options.probeLength + options.verificationLength;
  const sampleCount = Math.min(
    options.countPerAssistant,
    Math.max(1, Math.ceil(textLength / sampleWindowLength))
  );
  const maximumOffset = Math.max(0, textLength - sampleWindowLength);

  if (sampleCount === 1) return [0];

  return Array.from({ length: sampleCount }, (_, index) =>
    Math.round((maximumOffset * index) / (sampleCount - 1))
  );
}

/**
 * Creates SHA-256 hexadecimal text using the native Web Crypto API.
 *
 * @example
 * const hash = await createSha256('verification text');
 */
export async function createSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Creates bounded fingerprints for one normalized AI response.
 *
 * @example
 * const fingerprints = await createResponseFingerprints({
 *   id: 'response-1',
 *   text: 'A sufficiently long AI response',
 * });
 */
export async function createResponseFingerprints(
  response: NavigationTextMessage,
  options: FingerprintOptions = APP_CONFIG.navigation.fingerprint
): Promise<ResponseFingerprint[]> {
  const text = normalizeComparableText(response.text);
  const offsets = calculateFingerprintOffsets(text.length, options);

  return Promise.all(
    offsets.map(async (textOffset, sampleIndex) => {
      const probeText = text.slice(
        textOffset,
        textOffset + options.probeLength
      );
      const verificationText = text.slice(
        textOffset + probeText.length,
        textOffset + probeText.length + options.verificationLength
      );
      const hashSource = verificationText || probeText;

      return {
        responseId: response.id,
        sampleIndex,
        textOffset,
        probeText,
        verificationHash: await createSha256(hashSource),
        verificationLength: verificationText.length,
      };
    })
  );
}
