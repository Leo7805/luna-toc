/** @vitest-environment jsdom */
/**
 * Tests the per-subsystem debug toggle for the click-to-jump visibility
 * dump (mounted + visible user messages on every jump click).
 *
 * The toggle is intentionally independent of the global
 * `NAVIGATION_DEBUG_STORAGE_KEY`: a developer working on "I clicked the
 * TOC and nothing happened" should be able to turn on just the
 * visibility dump without enabling the full diagnostic event stream.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isJumpVizDebugEnabled,
  JUMP_VIZ_DEBUG_STORAGE_KEY,
} from '@/platforms/chatgpt/navigationDiagnostics';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('jump viz debug toggle', () => {
  it('defaults to disabled when the key is absent', () => {
    expect(isJumpVizDebugEnabled()).toBe(false);
  });

  it('enables when the storage value is exactly "1"', () => {
    localStorage.setItem(JUMP_VIZ_DEBUG_STORAGE_KEY, '1');
    expect(isJumpVizDebugEnabled()).toBe(true);
  });

  it('stays disabled for any other value, including "0" or whitespace', () => {
    localStorage.setItem(JUMP_VIZ_DEBUG_STORAGE_KEY, '0');
    expect(isJumpVizDebugEnabled()).toBe(false);

    localStorage.setItem(JUMP_VIZ_DEBUG_STORAGE_KEY, '');
    expect(isJumpVizDebugEnabled()).toBe(false);

    localStorage.setItem(JUMP_VIZ_DEBUG_STORAGE_KEY, ' true');
    expect(isJumpVizDebugEnabled()).toBe(false);
  });

  it('falls back to disabled when storage access throws', () => {
    const storage: Pick<Storage, 'getItem'> = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
    };
    expect(isJumpVizDebugEnabled(storage)).toBe(false);
  });

  it('reads from a custom storage object (for tests / advanced callers)', () => {
    const map = new Map<string, string>();
    map.set(JUMP_VIZ_DEBUG_STORAGE_KEY, '1');
    const storage: Pick<Storage, 'getItem'> = {
      getItem: (key) => map.get(key) ?? null,
    };
    expect(isJumpVizDebugEnabled(storage)).toBe(true);
  });
});