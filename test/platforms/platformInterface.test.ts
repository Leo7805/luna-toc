/**
 * Tests platform registration, resolution, and active navigation adapter contracts.
 */
import { describe, expect, it } from 'vitest';
import { getActivePlatform, getPlatformById, PLATFORMS } from '@/platforms';

describe('platformInterface and registration', () => {
  it('registers supported platforms in PLATFORMS', () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(ids).toContain('chatgpt');
    expect(ids).not.toContain('copilot');
  });

  it('retrieves platform by id', () => {
    const chatgpt = getPlatformById('chatgpt');
    expect(chatgpt.id).toBe('chatgpt');
    expect(chatgpt.displayName).toBe('ChatGPT');

  });

  it('throws when getting an unknown platform id', () => {
    expect(() => getPlatformById('unknown' as never)).toThrow(
      'Unknown platform id: unknown'
    );
  });

  it('resolves active platform by host pattern', () => {
    const chatgpt = getActivePlatform('chatgpt.com');
    expect(chatgpt.id).toBe('chatgpt');

  });

  it('throws when resolving an unregistered host', () => {
    expect(() => getActivePlatform('example.com')).toThrow(
      'LunaTOC: no platform registered for host "example.com"'
    );
  });

  it('fulfills active navigation contract on ChatGPT platform', () => {
    const platform = getActivePlatform('chatgpt.com');
    const { navigation, diagnostics, config } = platform;
    expect(typeof navigation.getScrollContainer).toBe('function');
    expect(typeof navigation.getThreadScrollContainer).toBe('function');
    expect(typeof navigation.findRenderedPrompt).toBe('function');
    expect(typeof navigation.findRenderedPromptByText).toBe('function');
    expect(typeof navigation.readMountedWithSidebarIdx).toBe('function');
    expect(typeof navigation.getMessageIdFromElement).toBe('function');
    expect(typeof navigation.getPromptUnitKeyFromElement).toBe('function');
    expect(typeof navigation.getJumpTargetElement).toBe('function');
    expect(typeof navigation.observeVisibleUserMessages).toBe('function');
    expect(typeof navigation.settleAttempts).toBe('number');
    expect(navigation.settleAttempts).toBeGreaterThan(0);
    expect(typeof navigation.promptTopOffsetPx).toBe('number');

    expect(typeof diagnostics.isJumpVizDebugEnabled).toBe('function');
    expect(config.selectors.userMessage).toBe(
      '[data-chatgpt-search-unit-key$=":user"]'
    );
    expect(config.selectors.assistantMessage).toBe(
      '[data-chatgpt-search-unit-key$=":assistant"]'
    );
    expect(config.selectors.messageId).toBe('data-chatgpt-search-message-ids');
  });

  it('rejects unimplemented hosts', () => {
    expect(() => getActivePlatform('copilot.microsoft.com')).toThrow(
      'LunaTOC: no platform registered for host "copilot.microsoft.com"'
    );
  });
});
