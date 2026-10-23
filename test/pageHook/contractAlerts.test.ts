/** @vitest-environment jsdom */
/** Verifies developer diagnostics and avoids short-conversation false alarms. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkConversationPathAgainstContract,
  installContractAlerts,
  probeNumTurnsBehavior,
  reportContractMismatch,
  reportContractRecovered,
  resetContractMismatchCounters,
  setEffectiveContractValues,
  setContractProbesEnabled,
  shouldRunContractProbes,
} from '@/pageHook/contractAlerts';

afterEach(() => {
  setContractProbesEnabled(false);
  resetContractMismatchCounters();
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

  it('re-arms anomaly reporting after a verified recovery and after route reset', () => {
    const post = vi.spyOn(window, 'postMessage');
    reportContractMismatch('api.conversation.path', '/wrong');
    expect(post).not.toHaveBeenCalled();
    reportContractMismatch('api.conversation.path', '/wrong');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LUNA_CONTRACT_MISMATCH',
    }), location.origin);
    post.mockClear();
    reportContractRecovered('api.conversation.path');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LUNA_CONTRACT_RECOVERED',
      contractId: 'api.conversation.path',
    }), location.origin);
    post.mockClear();
    reportContractMismatch('api.conversation.path', '/wrong-again');
    expect(post).not.toHaveBeenCalled();
    resetContractMismatchCounters();
    reportContractMismatch('api.conversation.path', '/wrong-new-route');
    expect(post).not.toHaveBeenCalled();
    reportContractMismatch('api.conversation.path', '/wrong-new-route');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LUNA_CONTRACT_MISMATCH',
    }), location.origin);
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
