/** Versioned, local-only backup/restore for extension-owned user data. */
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageMap } from '@/features/myPrompts/promptUsageStore';
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_COLORS,
  type SidebarPreferences,
} from '@/features/sidebar/sidebarPreferences';
import type { ThemeSettings } from '@/features/theme/themeSettings';
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';

const PROMPTS_KEY = 'lumaToc:myPromptsV1'; // Legacy spelling is intentional.
const USAGE_KEY = 'lunaToc:promptUsageV1';
const ALIAS_PREFIX = 'chatToc:aliases:v1:';
const ALIAS_DELETED_PREFIX = 'chatToc:aliases:deleted:v1:';
const THEME_KEY = 'chatToc:themeSettings';
const LEGACY_THEME_KEY = 'chatToc:theme';
const SIDEBAR_KEY = 'chatToc:sidebarPreferences';
export const BACKUP_FORMAT = 'luna-toc-local-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export interface BackupAliasRecord {
  ownerId: string | null;
  aliases: Record<string, string>;
}

export interface LocalBackupData {
  prompts: SavedPrompt[];
  promptUsage: PromptUsageMap;
  aliases: Record<string, BackupAliasRecord>;
  theme: ThemeSettings;
  sidebar: SidebarPreferences;
}

export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: LocalBackupData;
}
export type RestoreMode = 'merge' | 'replace';

type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} 包含不支持的字段。`);
  }
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} 无效或超出长度限制。`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数。`);
  }
  return value;
}

function validatePrompts(value: unknown): SavedPrompt[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) throw new Error('提示词列表无效或过大。');
  const ids = new Set<string>();
  return value.map((item, index) => {
    const raw = record(item, `提示词 #${index + 1}`);
    keysOnly(raw, ['id', 'title', 'content', 'createdAt', 'updatedAt'], '提示词');
    const id = text(raw.id, '提示词 ID', 256);
    if (ids.has(id)) throw new Error('备份包含重复的提示词 ID。');
    ids.add(id);
    return {
      id,
      title: text(raw.title, '提示词标题', 1_000),
      content: text(raw.content, '提示词内容', 1_000_000),
      createdAt: integer(raw.createdAt, '创建时间'),
      updatedAt: integer(raw.updatedAt, '修改时间'),
    };
  });
}

function validateUsage(value: unknown): PromptUsageMap {
  const raw = record(value, '提示词使用统计');
  if (Object.keys(raw).length > MAX_ENTRIES) throw new Error('使用统计记录过多。');
  return Object.fromEntries(Object.entries(raw).map(([id, entry]) => {
    text(id, '使用统计 ID', 256);
    const item = record(entry, '使用统计');
    keysOnly(item, ['usageCount', 'lastUsedAt'], '使用统计');
    return [id, {
      usageCount: integer(item.usageCount, '使用次数'),
      lastUsedAt: integer(item.lastUsedAt, '最近使用时间'),
    }];
  }));
}

function validateAliases(value: unknown): Record<string, BackupAliasRecord> {
  const raw = record(value, '目录别名');
  if (Object.keys(raw).length > MAX_ENTRIES) throw new Error('目录别名记录过多。');
  let total = 0;
  return Object.fromEntries(Object.entries(raw).map(([routeKey, entry]) => {
    if (!isPermanentConversationId(routeKey)) throw new Error('会话 ID 无效。');
    const item = record(entry, '会话别名');
    keysOnly(item, ['ownerId', 'aliases'], '会话别名');
    const ownerId = item.ownerId === null ? null : text(item.ownerId, '账号标识', 256);
    const aliases = record(item.aliases, '别名映射');
    total += Object.keys(aliases).length;
    if (total > MAX_ENTRIES) throw new Error('目录消息别名过多。');
    return [routeKey, {
      ownerId,
      aliases: Object.fromEntries(Object.entries(aliases).map(([id, label]) => [
        text(id, '消息 ID', 256),
        text(label, '目录名称', 240),
      ])),
    }];
  }));
}

function validateTheme(value: unknown): ThemeSettings {
  const raw = record(value, '主题设置');
  keysOnly(raw, ['followChatGPT', 'manualTheme'], '主题设置');
  if (typeof raw.followChatGPT !== 'boolean' ||
      (raw.manualTheme !== 'dark' && raw.manualTheme !== 'light')) {
    throw new Error('主题设置无效。');
  }
  return { followChatGPT: raw.followChatGPT, manualTheme: raw.manualTheme };
}

function validateSidebar(value: unknown): SidebarPreferences {
  const raw = record(value, '侧边栏设置');
  keysOnly(raw, ['layoutMode', 'backgroundColor', 'revealTint'], '侧边栏设置');
  if ((raw.layoutMode !== 'overlay' && raw.layoutMode !== 'side-by-side') ||
    !SIDEBAR_COLORS.some((color) => color.id === raw.backgroundColor) ||
    typeof raw.revealTint !== 'boolean') {
    throw new Error('侧边栏设置无效。');
  }
  return {
    layoutMode: raw.layoutMode,
    backgroundColor: raw.backgroundColor as SidebarPreferences['backgroundColor'],
    revealTint: raw.revealTint,
  };
}

function validateData(value: unknown): LocalBackupData {
  const raw = record(value, '备份数据');
  keysOnly(raw, ['prompts', 'promptUsage', 'aliases', 'theme', 'sidebar'], '备份数据');
  for (const required of ['prompts', 'promptUsage', 'aliases', 'theme', 'sidebar']) {
    if (!Object.hasOwn(raw, required)) throw new Error('备份缺少必需的数据类别。');
  }
  const prompts = validatePrompts(raw.prompts);
  const validIds = new Set(prompts.map((prompt) => prompt.id));
  const usage = validateUsage(raw.promptUsage);
  if (Object.keys(usage).some((id) => !validIds.has(id))) {
    throw new Error('备份的使用统计引用了不存在的提示词。');
  }
  return {
    prompts,
    promptUsage: usage,
    aliases: validateAliases(raw.aliases),
    theme: validateTheme(raw.theme),
    sidebar: validateSidebar(raw.sidebar),
  };
}

/** Reject unknown versions, unexpected fields, malformed records and oversized files. */
export function parseLocalBackup(source: string): LocalBackup {
  if (new Blob([source]).size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 12 MiB 限制。');
  let input: unknown;
  try { input = JSON.parse(source); } catch { throw new Error('文件不是有效的 JSON。'); }
  const raw = record(input, '备份文件');
  keysOnly(raw, ['format', 'version', 'exportedAt', 'data'], '备份文件');
  if (raw.format !== BACKUP_FORMAT || raw.version !== BACKUP_VERSION) {
    throw new Error('不支持的备份文件格式或版本。');
  }
  const exportedAt = text(raw.exportedAt, '导出时间', 64);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('导出时间无效。');
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data: validateData(raw.data) };
}

/** Reads only the known extension-owned keys. Never export ChatGPT content or credentials. */
export async function createLocalBackup(
  storage: Storage = chrome.storage.local
): Promise<LocalBackup> {
  const all = await storage.get(null) as Record<string, unknown>;
  const aliases: Record<string, unknown> = Object.fromEntries(Object.entries(all)
    .filter(([key]) => key.startsWith(ALIAS_PREFIX))
    .map(([key, value]) => [key.slice(ALIAS_PREFIX.length), value]));
  const theme = all[THEME_KEY] ?? (
    all[LEGACY_THEME_KEY] === 'light' || all[LEGACY_THEME_KEY] === 'dark'
      ? { followChatGPT: false, manualTheme: all[LEGACY_THEME_KEY] }
      : { followChatGPT: true, manualTheme: 'dark' }
  );
  const data = validateData({
    prompts: all[PROMPTS_KEY] ?? [],
    promptUsage: all[USAGE_KEY] ?? {},
    aliases,
    theme,
    sidebar: all[SIDEBAR_KEY] ?? { ...DEFAULT_SIDEBAR_PREFERENCES },
  });
  const backup: LocalBackup = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data,
  };
  if (new Blob([JSON.stringify(backup)]).size > MAX_BACKUP_BYTES) {
    throw new Error('本地数据超过 12 MiB，无法生成此格式的备份。');
  }
  return backup;
}

/** Previews validated content; no storage writes. */
export function summarizeLocalBackup(backup: LocalBackup): {
  prompts: number; conversations: number; aliases: number; usage: number;
} {
  return {
    prompts: backup.data.prompts.length,
    conversations: Object.keys(backup.data.aliases).length,
    aliases: Object.values(backup.data.aliases)
      .reduce((count, record) => count + Object.keys(record.aliases).length, 0),
    usage: Object.keys(backup.data.promptUsage).length,
  };
}

/**
 * Restore only allowlisted keys. Every write has a pre-write snapshot and
 * compensating rollback; concurrent writes from other tabs are not transactional
 * (addressed in the following stage).
 */
export async function restoreLocalBackup(
  backup: LocalBackup,
  mode: RestoreMode,
  storage: Storage = chrome.storage.local
): Promise<void> {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('恢复模式无效。');
  const validated = parseLocalBackup(JSON.stringify(backup));
  const original = await storage.get(null) as Record<string, unknown>;
  // Do not trust the shape of storage-origin data when merging.
  let nextData = validated.data;
  if (mode === 'merge') {
    const current = await createLocalBackup({ ...storage, get: async () => original } as Storage);
    const prompts = new Map(current.data.prompts.map((prompt) => [prompt.id, prompt]));
    for (const prompt of validated.data.prompts) prompts.set(prompt.id, prompt);
    // A null prototype avoids inherited-key collisions and setter effects for unusual IDs.
    const aliases: Record<string, BackupAliasRecord> = Object.assign(
      Object.create(null) as Record<string, BackupAliasRecord>, current.data.aliases
    );
    for (const [route, imported] of Object.entries(validated.data.aliases)) {
      const present = Object.hasOwn(aliases, route) ? aliases[route] : undefined;
      if (present && present.ownerId && imported.ownerId &&
          present.ownerId !== imported.ownerId) {
        throw new Error('同一会话的账号归属不同，已取消合并。');
      }
      aliases[route] = {
        ownerId: imported.ownerId ?? present?.ownerId ?? null,
        aliases: { ...present?.aliases, ...imported.aliases },
      };
    }
    const usage = { ...current.data.promptUsage, ...validated.data.promptUsage };
    nextData = {
      prompts: [...prompts.values()], aliases, promptUsage: usage,
      theme: validated.data.theme, sidebar: validated.data.sidebar,
    };
  }
  const values: Record<string, unknown> = {
    [PROMPTS_KEY]: nextData.prompts,
    [USAGE_KEY]: nextData.promptUsage,
    [THEME_KEY]: nextData.theme,
    [SIDEBAR_KEY]: nextData.sidebar,
  };
  for (const [route, entry] of Object.entries(nextData.aliases)) {
    values[ALIAS_PREFIX + route] = entry;
  }
  const obsolete = mode === 'replace'
    ? Object.keys(original).filter((key) => key.startsWith(ALIAS_PREFIX) && !Object.hasOwn(values, key))
    : [];
  // Explicit restore may revive a deleted conversation. Clear its durable fence
  // only as part of the user-confirmed restore, with rollback on failure.
  const revived = Object.keys(nextData.aliases)
    .map((route) => ALIAS_DELETED_PREFIX + route)
    .filter((key) => Object.hasOwn(original, key));
  const removals = [...obsolete, ...revived];
  const changed = [...new Set([...Object.keys(values), ...removals])];
  const oldValues = Object.fromEntries(changed
    .filter((key) => Object.hasOwn(original, key)).map((key) => [key, original[key]]));
  const originallyAbsent = changed.filter((key) => !Object.hasOwn(original, key));
  try {
    await storage.set(values);
    if (removals.length) await storage.remove(removals);
    const actual = await storage.get([...Object.keys(values), ...revived]);
    if (Object.keys(values).some((key) => JSON.stringify(actual[key]) !== JSON.stringify(values[key])) ||
        revived.some((key) => Object.hasOwn(actual, key))) {
      throw new Error('写入后核对失败。');
    }
  } catch (error) {
    try {
      if (Object.keys(oldValues).length) await storage.set(oldValues);
      if (originallyAbsent.length) await storage.remove(originallyAbsent);
    } catch {
      throw new Error('恢复写入失败，且自动回滚未成功。请保留备份文件，不要再次覆盖数据。');
    }
    throw new Error(`恢复失败，原有数据已回滚：${error instanceof Error ? error.message : '存储错误'}`);
  }
}
