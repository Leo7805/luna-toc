/** Regression tests for background badge/storage ordering and tab isolation. */
import { describe, expect, it, vi } from 'vitest';
import { createToolbarWarningController } from '@/features/contractAlert/toolbarBackground';
import { toolbarWarningKey } from '@/features/contractAlert/toolbarWarning';

function fixture() {
  const records: Record<string, unknown> = {};
  const session = {
    get: vi.fn(async (key: string) => ({ [key]: records[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(records, items); }),
    remove: vi.fn(async (key: string) => { delete records[key]; }),
  };
  const action = {
    setBadgeText: vi.fn(async (_: { text: string; tabId: number }) => {}),
    setBadgeBackgroundColor: vi.fn(async (_: { color: string; tabId: number }) => {}),
  };
  return { records, session, action, controller: createToolbarWarningController(session, action) };
}

describe('toolbar warning coordinator', () => {
  it('persists a warning and clears both badge and popup warning after verified recovery', async () => {
    const f = fixture();
    await f.controller.update(7, { kind: 'warning', revision: 1, documentId: 'doc-1', detail: 'DOM mismatch' });
    expect(f.records[toolbarWarningKey(7)]).toMatchObject({
      state: 'warning', detail: 'DOM mismatch', revision: 1,
    });
    expect(f.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!', tabId: 7 });
    await f.controller.update(7, { kind: 'healthy', revision: 2, documentId: 'doc-1' });
    expect(f.records[toolbarWarningKey(7)]).toMatchObject({
      state: 'healthy', revision: 2,
    });
    expect(f.action.setBadgeText).toHaveBeenLastCalledWith({ text: '', tabId: 7 });
  });

  it('ignores stale delayed updates after recovery, including across controller restarts', async () => {
    const f = fixture();
    await Promise.all([
      f.controller.update(3, { kind: 'warning', revision: 1, documentId: 'doc', detail: 'bad' }),
      f.controller.update(3, { kind: 'healthy', revision: 2, documentId: 'doc' }),
    ]);
    const restarted = createToolbarWarningController(f.session, f.action);
    await restarted.update(3, { kind: 'warning', revision: 1, documentId: 'doc', detail: 'stale' });
    expect(f.records[toolbarWarningKey(3)]).toMatchObject({ state: 'healthy', revision: 2 });
    expect(f.action.setBadgeText).toHaveBeenLastCalledWith({ text: '', tabId: 3 });
    await restarted.update(3, { kind: 'warning', revision: 3, documentId: 'doc', detail: 'new failure' });
    expect(f.records[toolbarWarningKey(3)]).toMatchObject({ detail: 'new failure', revision: 3 });
  });

  it('isolates simultaneous updates from different tabs', async () => {
    const f = fixture();
    await Promise.all([
      f.controller.update(1, { kind: 'warning', revision: 1, documentId: 'a', detail: 'bad a' }),
      f.controller.update(2, { kind: 'warning', revision: 1, documentId: 'b', detail: 'bad b' }),
    ]);
    await f.controller.update(1, { kind: 'healthy', revision: 2, documentId: 'a' });
    expect(f.records[toolbarWarningKey(1)]).toMatchObject({ state: 'healthy' });
    expect(f.records[toolbarWarningKey(2)]).toMatchObject({ state: 'warning', detail: 'bad b' });
  });

  it('clears full navigation state without touching other tabs', async () => {
    const f = fixture();
    await f.controller.update(1, { kind: 'warning', revision: 1, documentId: 'old', detail: 'old' });
    await f.controller.update(2, { kind: 'warning', revision: 1, documentId: 'other', detail: 'other' });
    await f.controller.clear(1);
    expect(f.records[toolbarWarningKey(1)]).toBeUndefined();
    expect(f.records[toolbarWarningKey(2)]).toMatchObject({ state: 'warning' });
    await f.controller.update(1, { kind: 'warning', revision: 1, documentId: 'new', detail: 'new' });
    expect(f.records[toolbarWarningKey(1)]).toMatchObject({ detail: 'new', documentId: 'new' });
  });

  it('allows recovery from a failed storage write on a subsequent update', async () => {
    const f = fixture();
    f.session.set.mockRejectedValueOnce(new Error('session temporarily unavailable'));
    await expect(f.controller.update(1, {
      kind: 'warning', revision: 1, documentId: 'doc', detail: 'bad',
    })).rejects.toThrow('session temporarily unavailable');
    await f.controller.update(1, {
      kind: 'warning', revision: 2, documentId: 'doc', detail: 'bad',
    });
    expect(f.records[toolbarWarningKey(1)]).toMatchObject({ state: 'warning', revision: 2 });
  });
});
