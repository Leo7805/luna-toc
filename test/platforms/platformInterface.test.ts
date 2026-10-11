/**
 * Tests platform registration, resolution, and active navigation adapter contracts.
 */
import { describe, expect, it } from 'vitest';
import { getActivePlatform, getPlatformById, PLATFORMS } from '@/platforms';

describe('platformInterface and registration', () => {
  it('registers supported platforms in PLATFORMS', () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(ids).toContain('chatgpt');
    expect(ids).toContain('copilot');
  });

  it('retrieves platform by id', () => {
    const chatgpt = getPlatformById('chatgpt');
    expect(chatgpt.id).toBe('chatgpt');
    expect(chatgpt.displayName).toBe('ChatGPT');

    const copilot = getPlatformById('copilot');
    expect(copilot.id).toBe('copilot');
    expect(copilot.displayName).toBe('Microsoft Copilot');
  });

  it('throws when getting an unknown platform id', () => {
    expect(() => getPlatformById('unknown' as never)).toThrow(
      'Unknown platform id: unknown'
    );
  });

  it('resolves active platform by host pattern', () => {
    const chatgpt = getActivePlatform('chatgpt.com');
    expect(chatgpt.id).toBe('chatgpt');

    const copilot = getActivePlatform('copilot.microsoft.com');
    expect(copilot.id).toBe('copilot');
  });

  it('throws when resolving an unregistered host', () => {
    expect(() => getActivePlatform('example.com')).toThrow(
      'LunaTOC: no platform registered for host "example.com"'
    );
  });

  it('fulfills active navigation contract on ChatGPT platform', () => {
    const { navigation } = getActivePlatform('chatgpt.com');
    expect(typeof navigation.getScrollContainer).toBe('function');
    expect(typeof navigation.getThreadScrollContainer).toBe('function');
    expect(typeof navigation.findRenderedPrompt).toBe('function');
    expect(typeof navigation.getJumpTargetElement).toBe('function');
    expect(typeof navigation.observeVisibleUserMessages).toBe('function');
    expect(typeof navigation.settleAttempts).toBe('number');
    expect(navigation.settleAttempts).toBeGreaterThan(0);
    expect(typeof navigation.promptTopOffsetPx).toBe('number');
  });

  it('fulfills active navigation contract on Copilot platform', () => {
    const { navigation } = getActivePlatform('copilot.microsoft.com');
    expect(typeof navigation.getScrollContainer).toBe('function');
    expect(typeof navigation.findRenderedPrompt).toBe('function');
    expect(typeof navigation.getJumpTargetElement).toBe('function');
    expect(typeof navigation.observeVisibleUserMessages).toBe('function');
    expect(typeof navigation.settleAttempts).toBe('number');
    expect(navigation.settleAttempts).toBeGreaterThan(0);
    expect(typeof navigation.promptTopOffsetPx).toBe('number');
  });
});
