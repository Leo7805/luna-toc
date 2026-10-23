/** @vitest-environment jsdom */
/** Non-destructive backup/restore regression coverage without a real Chrome account. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES,
  createLocalBackup, parseLocalBackup, restoreLocalBackup, summarizeLocalBackup,
  type LocalBackup,
} from '@/features/backup/localBackup';

const PROMPTS = 'lumaToc:myPromptsV1';
const USAGE = 'lunaToc:promptUsageV1';
const THEME = 'chatToc:themeSettings';
const SIDEBAR = 'chatToc:sidebarPreferences';
const ALIAS = 'chatToc:aliases:v1:conversation-123';
const EXTRA_ALIAS = 'chatToc:aliases:v1:conversation-456';
const prompt = (id: string, title = id) => ({
  id, title, content: 'important prompt', createdAt: 1, updatedAt: 2,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function sample(): LocalBackup {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    exportedAt: '2026-10-23T02:00:00.000Z',
    data: {
      prompts: [prompt('saved')],
      promptUsage: { saved: { usageCount: 2, lastUsedAt: 3 } },
      aliases: {
        'conversation-123': {
          ownerId: 'account-1', aliases: { 'message-1': '自定义目录' },
        },
      },
      theme: { followChatGPT: false, manualTheme: 'light' },
      sidebar: { layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true },
    },
  };
}

function storageHarness(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = clone(initial);
  let setFailure: 'none' | 'before' | 'after' = 'none';
  let removeFailure = false;
  let getFailure = false;
  const get = vi.fn(async (keys?: string | string[] | null) => {
    if (getFailure) throw new Error('storage read failed');
    if (keys === null || keys === undefined) return clone(state);
    const selected = typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(selected.filter((key) => Object.hasOwn(state, key))
      .map((key) => [key, state[key]])));
  });
  const set = vi.fn(async (values: Record<string, unknown>) => {
    if (setFailure === 'before') { setFailure = 'none'; throw new Error('quota exceeded'); }
    Object.assign(state, clone(values));
    if (setFailure === 'after') { setFailure = 'none'; throw new Error('late write failure'); }
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    if (removeFailure) { removeFailure = false; throw new Error('remove failed'); }
    for (const key of typeof keys === 'string' ? [keys] : keys) delete state[key];
  });
  const storage = { get, set, remove } as unknown as Pick<chrome.storage.StorageArea, 'get'|'set'|'remove'>;
  return {
    storage, state, get, set, remove,
    failSet: (when: 'before' | 'after') => { setFailure = when; },
    failRemove: () => { removeFailure = true; },
    failGet: () => { getFailure = true; },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('versioned local backup', () => {
  it('exports precisely the allowlisted local user data and supports round trip', async () => {
    const source = sample();
    const box = storageHarness({
      [PROMPTS]: source.data.prompts,
      [USAGE]: source.data.promptUsage,
      [ALIAS]: source.data.aliases['conversation-123'],
      [THEME]: source.data.theme,
      [SIDEBAR]: source.data.sidebar,
      'chatGpt:conversationBody': 'private conversation text',
      'secret:authorization': 'private token',
    });
    const backup = await createLocalBackup(box.storage);
    const serialized = JSON.stringify(backup);
    expect(backup.data).toEqual(source.data);
    expect(serialized).not.toContain('private conversation');
    expect(serialized).not.toContain('private token');
    expect(parseLocalBackup(serialized)).toEqual(backup);
    expect(summarizeLocalBackup(backup)).toEqual({
      prompts: 1, usage: 1, conversations: 1, aliases: 1,
    });
    expect(box.set).not.toHaveBeenCalled();
    expect(box.remove).not.toHaveBeenCalled();
  });

  it('uses the legacy theme only when no new theme record exists', async () => {
    const box = storageHarness({ 'chatToc:theme': 'light' });
    expect((await createLocalBackup(box.storage)).data.theme)
      .toEqual({ followChatGPT: false, manualTheme: 'light' });
    expect(box.set).not.toHaveBeenCalled();
  });

  it('rejects unknown versions, invalid JSON, unknown fields and oversized input', () => {
    const saved = sample();
    expect(() => parseLocalBackup('not json')).toThrow('JSON');
    expect(() => parseLocalBackup(JSON.stringify({ ...saved, version: 2 }))).toThrow('格式或版本');
    expect(() => parseLocalBackup(JSON.stringify({ ...saved, token: 'secret' }))).toThrow('不支持');
    expect(() => parseLocalBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow('12 MiB');
  });

  it('rejects duplicate IDs, broken aliases and missing required categories before writes', () => {
    const duplicate = sample();
    duplicate.data.prompts.push(prompt('saved'));
    expect(() => parseLocalBackup(JSON.stringify(duplicate))).toThrow('重复');
    const alias = sample();
    alias.data.aliases['conversation-123'].aliases['message-1'] = 'x'.repeat(241);
    expect(() => parseLocalBackup(JSON.stringify(alias))).toThrow('长度');
    const missing = sample();
    delete (missing.data as unknown as Record<string, unknown>).theme;
    expect(() => parseLocalBackup(JSON.stringify(missing))).toThrow('缺少');
  });

  it('previews content without mutating storage', async () => {
    const box = storageHarness({ [PROMPTS]: [prompt('current')] });
    const parsed = parseLocalBackup(JSON.stringify(sample()));
    expect(summarizeLocalBackup(parsed).prompts).toBe(1);
    expect(box.state[PROMPTS]).toEqual([prompt('current')]);
    expect(box.set).not.toHaveBeenCalled();
  });

  it('merges by prompt/message ID while keeping unrelated local records', async () => {
    const imported = sample();
    imported.data.prompts[0].title = 'newer';
    const box = storageHarness({
      [PROMPTS]: [prompt('saved', 'older'), prompt('keep')],
      [USAGE]: { saved: { usageCount: 1, lastUsedAt: 1 } },
      [ALIAS]: { ownerId: 'account-1', aliases: { 'message-1': 'old', 'message-2': 'keep' } },
      [EXTRA_ALIAS]: { ownerId: null, aliases: { 'message-3': 'untouched' } },
      [THEME]: { followChatGPT: true, manualTheme: 'dark' },
      [SIDEBAR]: { layoutMode: 'overlay', backgroundColor: 'default', revealTint: false },
      'other-key': 'untouched',
    });
    await restoreLocalBackup(imported, 'merge', box.storage);
    expect(box.state[PROMPTS]).toEqual([prompt('saved', 'newer'), prompt('keep')]);
    expect(box.state[USAGE]).toEqual(imported.data.promptUsage);
    expect(box.state[ALIAS]).toEqual({
      ownerId: 'account-1', aliases: { 'message-1': '自定义目录', 'message-2': 'keep' },
    });
    expect(box.state[EXTRA_ALIAS]).toBeDefined();
    expect(box.state[THEME]).toEqual(imported.data.theme);
    expect(box.state['other-key']).toBe('untouched');
    expect(box.remove).not.toHaveBeenCalled();
  });

  it('replaces only owned records and removes outdated alias entries', async () => {
    const box = storageHarness({
      [PROMPTS]: [prompt('old')], [EXTRA_ALIAS]: { ownerId: null, aliases: { x: 'old' } },
      'other-key': 'keep me',
    });
    await restoreLocalBackup(sample(), 'replace', box.storage);
    expect(box.state[PROMPTS]).toEqual([prompt('saved')]);
    expect(box.state[EXTRA_ALIAS]).toBeUndefined();
    expect(box.state[ALIAS]).toBeDefined();
    expect(box.state['other-key']).toBe('keep me');
  });

  it('rejects ambiguous cross-account alias merge before any writes', async () => {
    const box = storageHarness({
      [ALIAS]: { ownerId: 'someone-else', aliases: { 'message-1': 'old' } },
    });
    const original = clone(box.state);
    await expect(restoreLocalBackup(sample(), 'merge', box.storage)).rejects.toThrow('账号归属');
    expect(box.state).toEqual(original);
    expect(box.set).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)(
    'rolls back when set fails %s mutating local storage', async (when) => {
      const box = storageHarness({ [PROMPTS]: [prompt('original')], 'other-key': 7 });
      const original = clone(box.state);
      box.failSet(when);
      await expect(restoreLocalBackup(sample(), 'replace', box.storage)).rejects.toThrow('已回滚');
      expect(box.state).toEqual(original);
    }
  );

  it('rolls back when removing obsolete keys fails', async () => {
    const box = storageHarness({
      [PROMPTS]: [prompt('original')],
      [EXTRA_ALIAS]: { ownerId: null, aliases: { x: 'preserve me' } },
    });
    const original = clone(box.state);
    box.failRemove();
    await expect(restoreLocalBackup(sample(), 'replace', box.storage)).rejects.toThrow('已回滚');
    expect(box.state).toEqual(original);
  });

  it('handles unusual but structurally valid alias keys without prototype collisions', async () => {
    const incoming = sample();
    incoming.data.aliases = Object.fromEntries([[
      '__proto__', { ownerId: null, aliases: { 'message-1': 'safe value' } },
    ]]);
    const box = storageHarness({ [PROMPTS]: [prompt('saved')] });
    await restoreLocalBackup(incoming, 'merge', box.storage);
    expect(box.state['chatToc:aliases:v1:__proto__']).toEqual({
      ownerId: null, aliases: { 'message-1': 'safe value' },
    });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('does not write if reading current storage fails', async () => {
    const box = storageHarness();
    box.failGet();
    await expect(restoreLocalBackup(sample(), 'replace', box.storage)).rejects.toThrow('read failed');
    expect(box.set).not.toHaveBeenCalled();
  });
});
