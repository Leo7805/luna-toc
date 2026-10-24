/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAliasCleanupSettings } from '@/components/options/LocalAliasCleanupSettings';

const mocked = vi.hoisted(() => ({
  list: vi.fn(),
  clean: vi.fn(),
}));
vi.mock('@/features/conversationPrompts/aliasCleanup', () => ({
  listLocalTocAliases: mocked.list,
  requestManualTocAliasCleanup: mocked.clean,
}));

const selection = {
  routeKey: 'conversation-123',
  record: { ownerId: 'account-1', aliases: { msg: 'Important title' } },
  aliasCount: 1,
};
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mocked.list.mockReset().mockResolvedValue({ candidates: [selection], unreadable: 0 });
  mocked.clean.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(): Promise<void> {
  await act(async () => { root.render(<LocalAliasCleanupSettings />); });
}
function findButton(partial: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((entry) =>
    entry.textContent?.includes(partial));
  if (!button) throw new Error('Button not found: ' + partial);
  return button;
}

describe('Options manual TOC alias cleanup controls', () => {
  it('requires backup acknowledgment and a second confirmation before deleting', async () => {
    await show();
    const cleanButton = findButton('确认清理');
    expect(cleanButton.disabled).toBe(true);
    const backup = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { backup.click(); });
    expect(cleanButton.disabled).toBe(false);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { cleanButton.click(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocked.clean).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => { cleanButton.click(); });
    expect(mocked.clean).toHaveBeenCalledWith(selection);
    expect(host.textContent).toContain('已清理所选会话');
  });

  it('keeps records visible and reports a background preview conflict', async () => {
    mocked.clean.mockRejectedValueOnce(new Error('目录记录已变化，请刷新列表后重新确认。'));
    await show();
    const backup = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => { backup.click(); });
    await act(async () => { findButton('确认清理').click(); });
    expect(host.textContent).toContain('目录记录已变化');
    expect(host.textContent).toContain('conversation-123');
  });
});
