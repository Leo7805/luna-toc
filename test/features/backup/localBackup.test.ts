/** @vitest-environment jsdom */
/** Non-destructive backup/restore regression coverage without a real Chrome account. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES,
  createLocalBackup, parseLocalBackup, restoreLocalBackup, summarizeLocalBackup,
  type LocalBackup,
} from '@/features/backup/localBackup';
import { createPromptWriteCoordinator, PROMPT_COMMIT_TYPE } from '@/features/myPrompts/promptWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';
import { ACCOUNT_EMAILS_KEY } from '@/features/storage/accountSettings';

const PROMPTS = 'lumaToc:myPromptsV1';
const USAGE = 'lunaToc:promptUsageV1';
const SETTINGS = 'chatToc:accountSettings:v1';
const ALIAS = 'chatToc:aliases:v1:conversation-123';
const EXTRA_ALIAS = 'chatToc:aliases:v1:conversation-456';
const prompt = (id: string, title = id, ownerId = 'account-1') => ({
  id, ownerId, title, content: 'important prompt', createdAt: 1, updatedAt: 2,
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
      settings: {
        'account-1': {
          theme: { followChatGPT: false, manualTheme: 'light' },
          sidebar: { layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true },
        },
      },
    },
  };
}

function storageHarness(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = clone(initial);
  let setFailure: 'none' | 'before' | 'after' = 'none';
  let removeFailure = false;
  let getFailure = false;
  let usageOverride: number | null = null;
  const byteCount = (keys?: string | string[] | null): number => {
    const selected = keys == null ? Object.keys(state) : typeof keys === 'string' ? [keys] : keys;
    const encoder = new TextEncoder();
    return selected.filter((key) => Object.hasOwn(state, key)).reduce((total, key) =>
      total + encoder.encode(JSON.stringify(key)).byteLength +
        encoder.encode(JSON.stringify(state[key])).byteLength, 0);
  };
  const getBytesInUse = vi.fn(async (keys?: string | string[] | null) =>
    keys == null && usageOverride !== null ? usageOverride : byteCount(keys));
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
  const storage = { get, set, remove, getBytesInUse, QUOTA_BYTES: 10 * 1024 * 1024 } as unknown as Pick<chrome.storage.StorageArea, 'get'|'set'|'remove'|'getBytesInUse'>;
  return {
    storage, state, get, set, remove, getBytesInUse,
    setUsageOverride: (value: number | null) => { usageOverride = value; },
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
      [SETTINGS]: source.data.settings,
      [ACCOUNT_EMAILS_KEY]: { 'account-1': 'person@example.com' },
      'chatGpt:conversationBody': 'private conversation text',
      'secret:authorization': 'private token',
    });
    const backup = await createLocalBackup(box.storage);
    const serialized = JSON.stringify(backup);
    expect(backup.data).toEqual(source.data);
    expect(serialized).not.toContain('private conversation');
    expect(serialized).not.toContain('private token');
    expect(serialized).not.toContain('person@example.com');
    expect(parseLocalBackup(serialized)).toEqual(backup);
    expect(summarizeLocalBackup(backup)).toEqual({
      prompts: 1, usage: 1, conversations: 1, aliases: 1, settingsAccounts: 1,
    });
    expect(box.set).not.toHaveBeenCalled();
    expect(box.remove).not.toHaveBeenCalled();
  });


  it('exports orphan-free usage without silently changing local storage', async () => {
    const orphan = { usageCount: 9, lastUsedAt: 9 };
    const box = storageHarness({
      [PROMPTS]: [prompt('saved')],
      [USAGE]: {
        saved: { usageCount: 2, lastUsedAt: 3 },
        deleted: orphan,
      },
    });
    const backup = await createLocalBackup(box.storage);
    expect(backup.data.promptUsage).toEqual({ saved: { usageCount: 2, lastUsedAt: 3 } });
    expect(box.state[USAGE]).toEqual({
      saved: { usageCount: 2, lastUsedAt: 3 }, deleted: orphan,
    });
    expect(box.set).not.toHaveBeenCalled();
    expect(box.remove).not.toHaveBeenCalled();
    expect(parseLocalBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it('merges a valid import with local orphan statistics and reconciles usage', async () => {
    const box = storageHarness({
      [PROMPTS]: [prompt('temporary')],
      [USAGE]: {
        temporary: { usageCount: 1, lastUsedAt: 2 },
        deleted: { usageCount: 9, lastUsedAt: 9 },
      },
      'other-key': 'preserve',
    });
    await restoreLocalBackup(sample(), 'merge', box.storage);
    expect(box.state[PROMPTS]).toEqual([prompt('temporary'), prompt('saved')]);
    expect(box.state[USAGE]).toEqual({
      temporary: { usageCount: 1, lastUsedAt: 2 },
      saved: { usageCount: 2, lastUsedAt: 3 },
    });
    expect(box.state['other-key']).toBe('preserve');
  });

  it('still rejects imported orphan usage and preserves all local records', async () => {
    const incoming = sample();
    incoming.data.promptUsage.deleted = { usageCount: 1, lastUsedAt: 2 };
    const box = storageHarness({
      [PROMPTS]: [prompt('current')],
      [USAGE]: { deleted: { usageCount: 3, lastUsedAt: 4 } },
    });
    const original = clone(box.state);
    expect(() => parseLocalBackup(JSON.stringify(incoming))).toThrow('引用了不存在的提示词');
    await expect(restoreLocalBackup(incoming, 'merge', box.storage))
      .rejects.toThrow('引用了不存在的提示词');
    expect(box.state).toEqual(original);
    expect(box.set).not.toHaveBeenCalled();
  });

  it('rolls back the orphan usage cleanup if a merge write fails', async () => {
    const box = storageHarness({
      [PROMPTS]: [prompt('temporary')],
      [USAGE]: { deleted: { usageCount: 9, lastUsedAt: 9 } },
    });
    const original = clone(box.state);
    box.failSet('after');
    await expect(restoreLocalBackup(sample(), 'merge', box.storage)).rejects.toThrow('已回滚');
    expect(box.state).toEqual(original);
  });

  it('imports v2 global preferences only when the backup identifies account owners', () => {
    const current = sample();
    const legacy = {
      ...current,
      version: 2,
      data: {
        prompts: current.data.prompts,
        promptUsage: current.data.promptUsage,
        aliases: current.data.aliases,
        theme: { followChatGPT: false, manualTheme: 'light' },
        sidebar: { layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true },
      },
    };
    const parsed = parseLocalBackup(JSON.stringify(legacy));
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.data.settings['account-1']).toEqual({
      theme: { followChatGPT: false, manualTheme: 'light' },
      sidebar: { layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true },
    });
    const unbound = { ...legacy, data: { ...legacy.data, prompts: [], promptUsage: {}, aliases: {} } };
    expect(() => parseLocalBackup(JSON.stringify(unbound))).toThrow('没有账号归属');
  });

  it('rejects unknown versions, invalid JSON, unknown fields and oversized input', () => {
    const saved = sample();
    expect(() => parseLocalBackup('not json')).toThrow('JSON');
    expect(() => parseLocalBackup(JSON.stringify({ ...saved, version: 1 }))).toThrow('格式或版本');
    expect(() => parseLocalBackup(JSON.stringify({ ...saved, token: 'secret' }))).toThrow('不支持');
    expect(() => parseLocalBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow('12 MiB');
  });

  it('rejects a prompt ID collision across different accounts during merge', async () => {
    const box = storageHarness({ [PROMPTS]: [prompt('saved', 'belongs to account two', 'account-2')] });
    await expect(restoreLocalBackup(sample(), 'merge', box.storage))
      .rejects.toThrow('账号归属不同');
    expect(box.state[PROMPTS]).toEqual([prompt('saved', 'belongs to account two', 'account-2')]);
  });

  it('rejects unbound prompt and alias records in imported backups', () => {
    const unboundPrompt = sample();
    delete (unboundPrompt.data.prompts[0] as unknown as Record<string, unknown>).ownerId;
    expect(() => parseLocalBackup(JSON.stringify(unboundPrompt))).toThrow('账号标识');
    const unboundAlias = sample();
    unboundAlias.data.aliases['conversation-123'].ownerId = '';
    expect(() => parseLocalBackup(JSON.stringify(unboundAlias))).toThrow('账号标识');
  });

  it('rejects duplicate IDs, broken aliases and missing required categories before writes', () => {
    const duplicate = sample();
    duplicate.data.prompts.push(prompt('saved'));
    expect(() => parseLocalBackup(JSON.stringify(duplicate))).toThrow('重复');
    const alias = sample();
    alias.data.aliases['conversation-123'].aliases['message-1'] = 'x'.repeat(241);
    expect(() => parseLocalBackup(JSON.stringify(alias))).toThrow('长度');
    const missing = sample();
    delete (missing.data as unknown as Record<string, unknown>).settings;
    expect(() => parseLocalBackup(JSON.stringify(missing))).toThrow('缺少');
  });

  it('refuses reserved message IDs that normal TOC storage cannot read or edit', async () => {
    const box = storageHarness({ [PROMPTS]: [prompt('existing')] });
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      const unsafe = sample();
      unsafe.data.aliases['conversation-123'].aliases = Object.fromEntries([[id, 'unsafe']]);
      expect(() => parseLocalBackup(JSON.stringify(unsafe))).toThrow('目录消息 ID 无效');
      await expect(restoreLocalBackup(unsafe, 'replace', box.storage)).rejects.toThrow('目录消息 ID 无效');
    }
    expect(box.set).not.toHaveBeenCalled();
    expect(box.state[PROMPTS]).toEqual([prompt('existing')]);
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
      [EXTRA_ALIAS]: { ownerId: null, aliases: { 'message-3': 'unowned old alias' } },
      [SETTINGS]: {
        'account-1': {
          theme: { followChatGPT: true, manualTheme: 'dark' },
          sidebar: { layoutMode: 'overlay', backgroundColor: 'default', revealTint: false },
        },
      },
      'other-key': 'untouched',
    });
    await restoreLocalBackup(imported, 'merge', box.storage);
    expect(box.state[PROMPTS]).toEqual([prompt('saved', 'newer'), prompt('keep')]);
    expect(box.state[USAGE]).toEqual(imported.data.promptUsage);
    expect(box.state[ALIAS]).toEqual({
      ownerId: 'account-1', aliases: { 'message-1': '自定义目录', 'message-2': 'keep' },
    });
    expect(box.state[EXTRA_ALIAS]).toBeUndefined();
    expect(box.remove).toHaveBeenCalledWith([EXTRA_ALIAS]);
    expect(box.state[SETTINGS]).toEqual(imported.data.settings);
    expect(box.state['other-key']).toBe('untouched');
  });

  it('verifies Chrome storage writes structurally regardless of object-key ordering', async () => {
    const backup = sample();
    backup.data.prompts.push(prompt('extra'));
    backup.data.promptUsage.extra = { usageCount: 4, lastUsedAt: 5 };
    const box = storageHarness({ [PROMPTS]: [prompt('current')] });
    const originalGet = box.storage.get.bind(box.storage);
    box.storage.get = (async (keys?: string | string[] | null) => {
      const result = await originalGet(keys);
      if (Array.isArray(keys) && Object.hasOwn(result, USAGE)) {
        const usage = result[USAGE] as Record<string, unknown>;
        result[USAGE] = Object.fromEntries(Object.entries(usage).reverse());
      }
      return result;
    }) as typeof box.storage.get;
    await restoreLocalBackup(backup, 'replace', box.storage);
    expect(box.state[USAGE]).toEqual(backup.data.promptUsage);
    expect(box.state[PROMPTS]).toEqual(backup.data.prompts);
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
      '__proto__', { ownerId: 'account-1', aliases: { 'message-1': 'safe value' } },
    ]]);
    const box = storageHarness({ [PROMPTS]: [prompt('saved')] });
    await restoreLocalBackup(incoming, 'merge', box.storage);
    expect(box.state['chatToc:aliases:v1:__proto__']).toEqual({
      ownerId: 'account-1', aliases: { 'message-1': 'safe value' },
    });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('rejects an over-quota restore before any local storage writes', async () => {
    const box = storageHarness({ [PROMPTS]: [prompt('existing')] });
    box.setUsageOverride(10 * 1024 * 1024);
    await expect(restoreLocalBackup(sample(), 'replace', box.storage))
      .rejects.toThrow('未执行写入');
    expect(box.set).not.toHaveBeenCalled();
    expect(box.remove).not.toHaveBeenCalled();
  });

  it('does not write if reading current storage fails', async () => {
    const box = storageHarness();
    box.failGet();
    await expect(restoreLocalBackup(sample(), 'replace', box.storage)).rejects.toThrow('read failed');
    expect(box.set).not.toHaveBeenCalled();
  });
  it('revives only explicitly restored conversation aliases and removes deletion fence', async () => {
    const tombstone = 'chatToc:aliases:deleted:v1:conversation-123';
    const unrelated = 'chatToc:aliases:deleted:v1:conversation-999';
    const box = storageHarness({ [tombstone]: true, [unrelated]: true });
    await restoreLocalBackup(sample(), 'replace', box.storage);
    expect(box.state[ALIAS]).toEqual(sample().data.aliases['conversation-123']);
    expect(box.state[tombstone]).toBeUndefined();
    expect(box.state[unrelated]).toBe(true);
  });

  it('restores a deletion fence when explicit revival fails midway', async () => {
    const tombstone = 'chatToc:aliases:deleted:v1:conversation-123';
    const box = storageHarness({ [tombstone]: true });
    const original = clone(box.state);
    box.failRemove();
    await expect(restoreLocalBackup(sample(), 'replace', box.storage))
      .rejects.toThrow('已回滚');
    expect(box.state).toEqual(original);
  });

  it('preserves write order when a prompt commit follows a restore', async () => {
    const original = prompt('old');
    const backup = sample();
    backup.data.prompts = [prompt('restored')];
    backup.data.promptUsage = { restored: { usageCount: 1, lastUsedAt: 3 } };
    const box = storageHarness({ [PROMPTS]: [original] });
    const queue = createSerialWriteQueue();
    const promptWriter = createPromptWriteCoordinator(box.storage, queue);

    await queue.run(() => restoreLocalBackup(backup, 'replace', box.storage));
    expect(box.state[PROMPTS]).toEqual([prompt('restored')]);

    // The single-tab editor must read the restored collection before making
    // a subsequent change. Cross-tab stale-write rejection is unsupported.
    const subsequent = await promptWriter.commit({
      type: PROMPT_COMMIT_TYPE, action: 'replace-account', ownerId: 'account-1',
      next: [prompt('restored'), prompt('added')],
    });
    expect(subsequent).toEqual({ ok: true });
    expect(box.state[PROMPTS]).toEqual([prompt('restored'), prompt('added')]);
  });

});
