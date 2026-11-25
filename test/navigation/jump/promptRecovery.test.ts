/** @vitest-environment jsdom */
/** Tests bounded disconnect recovery orchestration and B004 progress-aware policy. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logNavigationEvent: vi.fn(),
}));

vi.mock('@/navigation/jump/jumpDiagnostics', () => ({
  emitAlignmentMeasurement: vi.fn(),
  logNavigationEvent: mocks.logNavigationEvent,
}));

import {
  createPromptJumpSession,
  type PromptJumpSession,
} from '@/navigation/jump/prompt/promptJumpSession';
import {
  executeDisconnectRecovery,
  recordVirtualRecoveryOffsetProgress,
  shouldSkipVirtualLayoutOnRecovery,
  type DisconnectRecoveryContext,
  type MountTargetOutcome,
} from '@/navigation/jump/prompt/promptRecovery';

function makeSession(
  overrides: Partial<Parameters<typeof createPromptJumpSession>[0]> = {}
): PromptJumpSession {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return createPromptJumpSession({
    target,
    targetMessageId: 'msg-15',
    targetIndex: 14,
    jumpId: 'jump-15',
    mode: 'target-driven',
    initialStrategy: 'virtual-layout',
    remainingRecoveries: 2,
    initialVirtualTopOffsetPx: 10000,
    isCancelled: () => false,
    ...overrides,
  });
}

describe('promptRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('skips when already recovering, cancelled before start, missing recovery context, or budget exhausted', async () => {
    const recoverTarget = vi.fn();
    const recovery: DisconnectRecoveryContext = {
      recoverTarget,
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    };

    const sRecovering = makeSession();
    sRecovering.recovery.isRecovering = true;
    expect(await executeDisconnectRecovery(sRecovering, recovery)).toEqual({
      status: 'skipped',
    });

    const sCancelled = makeSession({ isCancelled: () => true });
    expect(await executeDisconnectRecovery(sCancelled, recovery)).toEqual({
      status: 'skipped',
    });

    const sNoContext = makeSession();
    expect(await executeDisconnectRecovery(sNoContext, undefined)).toEqual({
      status: 'skipped',
    });

    const sExhausted = makeSession({ remainingRecoveries: 0 });
    expect(await executeDisconnectRecovery(sExhausted, recovery)).toEqual({
      status: 'skipped',
    });

    expect(recoverTarget).not.toHaveBeenCalled();
    expect(mocks.logNavigationEvent).not.toHaveBeenCalled();
  });

  it('performs synchronous attempt accounting and start logging before awaiting recoverTarget', async () => {
    let resolveRecover!: (outcome: MountTargetOutcome) => void;
    const recoverTarget = vi.fn(
      () =>
        new Promise<MountTargetOutcome>((resolve) => {
          resolveRecover = resolve;
        })
    );

    const session = makeSession({ remainingRecoveries: 2 });
    const recovery: DisconnectRecoveryContext = {
      recoverTarget,
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    };

    const promise = executeDisconnectRecovery(session, recovery);

    // Synchronous side effects before the awaited promise resolves
    expect(session.recovery.isRecovering).toBe(true);
    expect(session.recovery.remainingRecoveries).toBe(1);
    expect(session.recovery.attemptsUsed).toBe(1);
    expect(mocks.logNavigationEvent).toHaveBeenCalledWith(
      'jump-15',
      'JUMP_DISCONNECT_RECOVERY_START',
      { targetPromptIndex: 14, recoveryAttempt: 1 }
    );
    expect(recoverTarget).toHaveBeenCalledWith({ skipVirtualLayout: false });

    const mounted = document.createElement('div');
    document.body.appendChild(mounted);
    resolveRecover({
      status: 'mounted',
      element: mounted,
      strategy: 'virtual-layout',
      virtualTopOffsetPx: 10500,
    });

    const result = await promise;
    expect(result).toEqual({ status: 'recovered', element: mounted });
    expect(session.recovery.isRecovering).toBe(false);
    expect(session.recovery.activeStrategy).toBe('virtual-layout');
    expect(session.recovery.lastVirtualOffsetShifted).toBe(true);
    expect(session.recovery.lastVirtualOffsetPx).toBe(10500);
  });

  it('enforces B004 skipVirtualLayout policy for attempt 1 vs 2, clamped, shifted, stagnant, and non-virtual strategies', () => {
    const s = makeSession({ initialStrategy: 'virtual-layout' });

    // Attempt 1 unclamped -> stay on virtual-layout
    s.alignment.lastAlignClamped = false;
    expect(shouldSkipVirtualLayoutOnRecovery(s, 1)).toBe(false);

    // Attempt 1 clamped -> switch to viewport-walker
    s.alignment.lastAlignClamped = true;
    expect(shouldSkipVirtualLayoutOnRecovery(s, 1)).toBe(true);

    // Attempt 2 unclamped + shifted -> stay on virtual-layout
    s.alignment.lastAlignClamped = false;
    s.recovery.lastVirtualOffsetShifted = true;
    expect(shouldSkipVirtualLayoutOnRecovery(s, 2)).toBe(false);

    // Attempt 2 unclamped + stagnant -> switch to viewport-walker
    s.recovery.lastVirtualOffsetShifted = false;
    expect(shouldSkipVirtualLayoutOnRecovery(s, 2)).toBe(true);

    // Non-virtual strategy -> false
    s.recovery.activeStrategy = 'viewport-walker';
    s.alignment.lastAlignClamped = true;
    expect(shouldSkipVirtualLayoutOnRecovery(s, 2)).toBe(false);
  });

  it('tracks virtual offset shift with exact > 4px threshold and resets on non-virtual strategy', () => {
    const session = makeSession({ initialVirtualTopOffsetPx: 1000 });
    const el = document.createElement('div');

    // Exactly 4px delta -> stagnant (false)
    recordVirtualRecoveryOffsetProgress(session, {
      status: 'mounted',
      element: el,
      strategy: 'virtual-layout',
      virtualTopOffsetPx: 1004,
    });
    expect(session.recovery.lastVirtualOffsetShifted).toBe(false);
    expect(session.recovery.lastVirtualOffsetPx).toBe(1004);

    // 4.1px delta -> shifted (true)
    recordVirtualRecoveryOffsetProgress(session, {
      status: 'mounted',
      element: el,
      strategy: 'virtual-layout',
      virtualTopOffsetPx: 1008.1,
    });
    expect(session.recovery.lastVirtualOffsetShifted).toBe(true);
    expect(session.recovery.lastVirtualOffsetPx).toBe(1008.1);

    // Viewport-walker recovery resets shift flag
    recordVirtualRecoveryOffsetProgress(session, {
      status: 'mounted',
      element: el,
      strategy: 'viewport-walker',
    });
    expect(session.recovery.lastVirtualOffsetShifted).toBe(false);
  });

  it('converts recoverTarget() throws into failed outcome and always resets isRecovering', async () => {
    const session = makeSession({ initialStrategy: 'virtual-layout' });
    session.alignment.lastAlignClamped = true; // forces skipVirtualLayout = true

    const recovery: DisconnectRecoveryContext = {
      recoverTarget: vi.fn().mockRejectedValue(new Error('boom')),
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    };

    const result = await executeDisconnectRecovery(session, recovery);
    expect(result).toEqual({ status: 'failed' });
    expect(session.recovery.isRecovering).toBe(false);
    expect(session.recovery.activeStrategy).toBe('viewport-walker');
  });

  it('handles cancelled outcome, mid-await cancellation, and rapid supersession before handoff', async () => {
    // 1. Outcome status === 'cancelled'
    const s1 = makeSession();
    const res1 = await executeDisconnectRecovery(s1, {
      recoverTarget: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    });
    expect(res1).toEqual({ status: 'cancelled' });
    expect(s1.recovery.isRecovering).toBe(false);

    // 2. Cancelled while awaiting recoverTarget
    let navVersion = 1;
    let resolveRecover!: (outcome: MountTargetOutcome) => void;
    const s2 = makeSession({ isCancelled: () => navVersion !== 1 });
    const p2 = executeDisconnectRecovery(s2, {
      recoverTarget: () =>
        new Promise<MountTargetOutcome>((resolve) => {
          resolveRecover = resolve;
        }),
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    });
    navVersion = 2; // superseded mid-await
    const el = document.createElement('div');
    document.body.appendChild(el);
    resolveRecover({ status: 'mounted', element: el, strategy: 'viewport-walker' });
    expect(await p2).toEqual({ status: 'cancelled' });
    // activeStrategy must NOT be overwritten when cancelled
    expect(s2.recovery.activeStrategy).toBe('virtual-layout');

    // 3. Disconnected mounted element returns failed while preserving activeStrategy update
    const s3 = makeSession();
    const detached = document.createElement('div'); // NOT appended to document
    const res3 = await executeDisconnectRecovery(s3, {
      recoverTarget: vi.fn().mockResolvedValue({
        status: 'mounted',
        element: detached,
        strategy: 'viewport-walker',
      }),
      remainingRecoveries: 2,
      initialStrategy: 'virtual-layout',
    });
    expect(res3).toEqual({ status: 'failed' });
    expect(s3.recovery.activeStrategy).toBe('viewport-walker');
  });
});
