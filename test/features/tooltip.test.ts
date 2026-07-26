/**
 * Tests shared tooltip visibility helpers.
 */
import { describe, expect, it } from 'vitest';

import { isElementTextTruncated } from '@/features/tooltip';

describe('isElementTextTruncated', () => {
  it('returns true when content is wider than the visible element', () => {
    const element = {
      clientWidth: 120,
      scrollWidth: 180,
    } as HTMLElement;

    expect(isElementTextTruncated(element)).toBe(true);
  });

  it('returns false when the full content fits', () => {
    const element = {
      clientWidth: 120,
      scrollWidth: 120,
    } as HTMLElement;

    expect(isElementTextTruncated(element)).toBe(false);
  });
});
