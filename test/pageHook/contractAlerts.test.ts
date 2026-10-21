/** @vitest-environment jsdom */
/** Verifies developer diagnostics and avoids short-conversation false alarms. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkConversationPathAgainstContract,
  installContractAlerts,
  probeNumTurnsBehavior,
  setEffectiveContractValues,
  setContractProbesEnabled,
  shouldRunContractProbes,
} from '@/pageHook/contractAlerts';

afterEach(() => {
  setContractProbesEnabled(false);
  vi.restoreAllMocks();
});

describe('compatibility diagnostics', () => {
  it('applies current contract values and toggles expensive probes', () => {
    setEffectiveContractValues({
      'api.conversation.path': '/backend-api/custom/{id}',
    });
    expect(checkConversationPathAgainstContract('api.conversation.path', '/backend-api/custom/abc')).toBe(true);
    expect(checkConversationPathAgainstContract('api.conversation.path', '/backend-api/conversations/abc')).toBe(false);
    setContractProbesEnabled(true);
    expect(shouldRunContractProbes()).toBe(true);
    setContractProbesEnabled(false);
    expect(shouldRunContractProbes()).toBe(false);
  });

  it('does not flag an entirely loaded short conversation', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: Array.from({ length: 6 }, (_, i) => ({ id: String(i) })),
        page_info: { has_previous_page: false } }),
    })) as unknown as typeof fetch;
    installContractAlerts({ originalFetch: fetchMock });
    await probeNumTurnsBehavior('test-short-chat', null);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
