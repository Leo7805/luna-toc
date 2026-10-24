/** Versioned, local-only backup/restore for extension-owned user data. */
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import type { PromptUsageMap } from '@/features/myPrompts/promptUsageStore';
import {
  SIDEBAR_COLORS,
  type SidebarPreferences,
} from '@/features/sidebar/sidebarPreferences';
import type { ThemeSettings } from '@/features/theme/themeSettings';
import { ACCOUNT_SETTINGS_KEY, isValidAccountOwnerId, type AccountSettingsMap } from '@/features/storage/accountSettings';
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';
import { isValidTocMessageId } from '@/features/conversationPrompts/tocAliasWriteCoordinator';

const PROMPTS_KEY = 'lumaToc:myPromptsV1'; // Legacy spelling is intentional.
const USAGE_KEY = 'lunaToc:promptUsageV1';
const ALIAS_PREFIX = 'chatToc:aliases:v1:';
const ALIAS_DELETED_PREFIX = 'chatToc:aliases:deleted:v1:';
export const BACKUP_FORMAT = 'luna-toc-local-backup';
export const BACKUP_VERSION = 3;
export const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export interface BackupAliasRecord {
  ownerId: string;
  aliases: Record<string, string>;
}

export interface LocalBackupData {
  prompts: SavedPrompt[];
  promptUsage: PromptUsageMap;
  aliases: Record<string, BackupAliasRecord>;
  settings: AccountSettingsMap;
}

export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: LocalBackupData;
}
export type RestoreMode = 'merge' | 'replace';

type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove' | 'getBytesInUse'>;
const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;
export const BACKUP_STORAGE_MESSAGE_TYPE = 'LUNA_TOC_BACKUP_STORAGE_V1';

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

function isUnownedPromptRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.ownerId !== 'string' || !item.ownerId.trim() || item.ownerId.length > 256;
}

function isUnownedAliasRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return !isValidAccountOwnerId(item.ownerId);
}

function validatePrompts(value: unknown): SavedPrompt[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) throw new Error('提示词列表无效或过大。');
  const ids = new Set<string>();
  return value.map((item, index) => {
    const raw = record(item, `提示词 #${index + 1}`);
    keysOnly(raw, ['id', 'ownerId', 'title', 'content', 'createdAt', 'updatedAt'], '提示词');
    const id = text(raw.id, '提示词 ID', 256);
    const ownerId = text(raw.ownerId, '账号标识', 256);
    if (ids.has(id)) throw new Error('备份包含重复的提示词 ID。');
    ids.add(id);
    return {
      id,
      ownerId,
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
    const ownerId = text(item.ownerId, '账号标识', 256);
    const aliases = record(item.aliases, '别名映射');
    total += Object.keys(aliases).length;
    if (total > MAX_ENTRIES) throw new Error('目录消息别名过多。');
    if (Object.keys(aliases).some((id) => !isValidTocMessageId(id))) {
      throw new Error('目录消息 ID 无效。');
    }
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

function validateSettingsMap(value: unknown): AccountSettingsMap {
  const raw = record(value, '账号偏好设置');
  if (Object.keys(raw).length > MAX_ENTRIES) throw new Error('账号偏好设置记录过多。');
  const settings: AccountSettingsMap = Object.create(null) as AccountSettingsMap;
  for (const [ownerId, entry] of Object.entries(raw)) {
    if (!isValidAccountOwnerId(ownerId)) throw new Error('账号偏好设置的账号标识无效。');
    const item = record(entry, '账号偏好设置');
    keysOnly(item, ['theme', 'sidebar'], '账号偏好设置');
    settings[ownerId] = { theme: validateTheme(item.theme), sidebar: validateSidebar(item.sidebar) };
  }
  return settings;
}

function validateData(value: unknown): LocalBackupData {
  const raw = record(value, '备份数据');
  keysOnly(raw, ['prompts', 'promptUsage', 'aliases', 'settings'], '备份数据');
  for (const required of ['prompts', 'promptUsage', 'aliases', 'settings']) {
    if (!Object.hasOwn(raw, required)) throw new Error('备份缺少必需的数据类别。');
  }
  const prompts = validatePrompts(raw.prompts);
  const validIds = new Set(prompts.map((prompt) => prompt.id));
  const usage = validateUsage(raw.promptUsage);
  if (Object.keys(usage).some((id) => !validIds.has(id))) {
    throw new Error('备份的使用统计引用了不存在的提示词。');
  }
  return {
    prompts, promptUsage: usage, aliases: validateAliases(raw.aliases),
    settings: validateSettingsMap(raw.settings),
  };
}

function validateLegacyDataV2(value: unknown): {
  prompts: SavedPrompt[];
  promptUsage: PromptUsageMap;
  aliases: Record<string, BackupAliasRecord>;
  theme: ThemeSettings;
  sidebar: SidebarPreferences;
} {
  const raw = record(value, '旧版备份数据');
  keysOnly(raw, ['prompts', 'promptUsage', 'aliases', 'theme', 'sidebar'], '旧版备份数据');
  for (const required of ['prompts', 'promptUsage', 'aliases', 'theme', 'sidebar']) {
    if (!Object.hasOwn(raw, required)) throw new Error('旧版备份缺少必需的数据类别。');
  }
  const prompts = validatePrompts(raw.prompts);
  const aliases = validateAliases(raw.aliases);
  const usage = validateUsage(raw.promptUsage);
  const validIds = new Set(prompts.map((prompt) => prompt.id));
  if (Object.keys(usage).some((id) => !validIds.has(id))) {
    throw new Error('备份的使用统计引用了不存在的提示词。');
  }
  return {
    prompts, promptUsage: usage, aliases,
    theme: validateTheme(raw.theme), sidebar: validateSidebar(raw.sidebar),
  };
}

/** Reject unknown versions, unexpected fields, malformed records and oversized files. */
export function parseLocalBackup(source: string): LocalBackup {
  if (new Blob([source]).size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 12 MiB 限制。');
  let input: unknown;
  try { input = JSON.parse(source); } catch { throw new Error('文件不是有效的 JSON。'); }
  const raw = record(input, '备份文件');
  keysOnly(raw, ['format', 'version', 'exportedAt', 'data'], '备份文件');
  if (raw.format !== BACKUP_FORMAT || (raw.version !== 2 && raw.version !== BACKUP_VERSION)) {
    throw new Error('不支持的备份文件格式或版本。');
  }
  const exportedAt = text(raw.exportedAt, '导出时间', 64);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('导出时间无效。');
  if (raw.version === 2) {
    const legacy = validateLegacyDataV2(raw.data);
    const owners = new Set<string>(legacy.prompts.map((prompt) => prompt.ownerId));
    Object.values(legacy.aliases).forEach((alias) => owners.add(alias.ownerId));
    if (owners.size === 0) {
      throw new Error('旧版备份的全局设置没有账号归属，无法安全导入；请先打开目标 ChatGPT 账号并重新导出新版备份。');
    }
    const settings: AccountSettingsMap = Object.create(null) as AccountSettingsMap;
    owners.forEach((ownerId) => { settings[ownerId] = { theme: legacy.theme, sidebar: legacy.sidebar }; });
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt,
      data: validateData({
        prompts: legacy.prompts, promptUsage: legacy.promptUsage,
        aliases: legacy.aliases, settings,
      }),
    };
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data: validateData(raw.data) };
}

/** Reads only the known extension-owned keys. Never export ChatGPT content or credentials. */
export async function createLocalBackup(
  storage: Storage = chrome.storage.local
): Promise<LocalBackup> {
  const all = await storage.get(null) as Record<string, unknown>;
  const aliases: Record<string, unknown> = Object.fromEntries(Object.entries(all)
    .filter(([key, value]) => key.startsWith(ALIAS_PREFIX) && !isUnownedAliasRecord(value))
    .map(([key, value]) => [key.slice(ALIAS_PREFIX.length), value]));

  // A deleted prompt can leave usage metadata behind if its asynchronous cleanup
  // failed. Omit that orphan from the read-only export snapshot; never weaken
  // validation of imported files or mutate the user's storage while exporting.
  const rawPrompts = all[PROMPTS_KEY] ?? [];
  if (!Array.isArray(rawPrompts)) throw new Error('提示词列表无效或过大。');
  const prompts = validatePrompts(rawPrompts.filter((item) => !isUnownedPromptRecord(item)));
  const existingUsage = validateUsage(all[USAGE_KEY] ?? {});
  const validPromptIds = new Set(prompts.map((prompt) => prompt.id));
  const promptUsage = Object.fromEntries(Object.entries(existingUsage)
    .filter(([id]) => validPromptIds.has(id)));
  const data = validateData({
    prompts, promptUsage, aliases,
    settings: all[ACCOUNT_SETTINGS_KEY] ?? {},
  });
  const backup: LocalBackup = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data,
  };
  if (new Blob([JSON.stringify(backup)]).size > MAX_BACKUP_BYTES) {
    throw new Error('本地数据超过 12 MiB，无法生成此格式的备份。');
  }
  return backup;
}

/** Compare JSON-like storage values without relying on Chrome's object-key order. */
function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null ||
      typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => storageValuesEqual(value, right[index]));
  }
  const expected = left as Record<string, unknown>;
  const actual = right as Record<string, unknown>;
  const keys = Object.keys(expected);
  return keys.length === Object.keys(actual).length &&
    keys.every((key) => Object.hasOwn(actual, key) && storageValuesEqual(expected[key], actual[key]));
}

/** Previews validated content; no storage writes. */
export function summarizeLocalBackup(backup: LocalBackup): {
  prompts: number; conversations: number; aliases: number; usage: number; settingsAccounts: number;
} {
  return {
    prompts: backup.data.prompts.length,
    conversations: Object.keys(backup.data.aliases).length,
    aliases: Object.values(backup.data.aliases)
      .reduce((count, record) => count + Object.keys(record.aliases).length, 0),
    usage: Object.keys(backup.data.promptUsage).length,
    settingsAccounts: Object.keys(backup.data.settings).length,
  };
}

/**
 * Restore only allowlisted keys. The caller executes this inside the background's
 * shared serial queue so current owned writes cannot interleave. Every restore
 * performs a capacity preflight before mutation and keeps compensating rollback.
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
    for (const prompt of validated.data.prompts) {
      const existing = prompts.get(prompt.id);
      if (existing && existing.ownerId !== prompt.ownerId) {
        throw new Error('提示词 ID 的账号归属不同，已取消合并。');
      }
      prompts.set(prompt.id, prompt);
    }
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
        ownerId: imported.ownerId,
        aliases: { ...present?.aliases, ...imported.aliases },
      };
    }
    const usage = { ...current.data.promptUsage, ...validated.data.promptUsage };
    const settings: AccountSettingsMap = Object.assign(
      Object.create(null) as AccountSettingsMap,
      current.data.settings,
      validated.data.settings,
    );
    nextData = {
      prompts: [...prompts.values()], aliases, promptUsage: usage, settings,
    };
  }
  const values: Record<string, unknown> = {
    [PROMPTS_KEY]: nextData.prompts,
    [USAGE_KEY]: nextData.promptUsage,
    [ACCOUNT_SETTINGS_KEY]: nextData.settings,
  };
  for (const [route, entry] of Object.entries(nextData.aliases)) {
    values[ALIAS_PREFIX + route] = entry;
  }
  const obsolete = Object.keys(original).filter((key) => key.startsWith(ALIAS_PREFIX) &&
    (mode === 'replace'
      ? !Object.hasOwn(values, key)
      : isUnownedAliasRecord(original[key])));
  // Explicit restore may revive a deleted conversation. Clear its durable fence
  // only as part of the user-confirmed restore, with rollback on failure.
  const revived = Object.keys(nextData.aliases)
    .map((route) => ALIAS_DELETED_PREFIX + route)
    .filter((key) => Object.hasOwn(original, key));
  const removals = [...obsolete, ...revived];
  const changed = [...new Set([...Object.keys(values), ...removals])];
  await assertStorageCapacity(storage, changed, values);
  const oldValues = Object.fromEntries(changed
    .filter((key) => Object.hasOwn(original, key)).map((key) => [key, original[key]]));
  const originallyAbsent = changed.filter((key) => !Object.hasOwn(original, key));
  try {
    await storage.set(values);
    if (removals.length) await storage.remove(removals);
    const actual = await storage.get([...Object.keys(values), ...revived]);
    const mismatchedCount = Object.keys(values)
      .filter((key) => !storageValuesEqual(values[key], actual[key])).length;
    const revivalFailed = revived.some((key) => Object.hasOwn(actual, key));
    if (mismatchedCount || revivalFailed) {
      throw new Error(`写入后核对失败（${mismatchedCount} 项数据不一致${revivalFailed ? '，删除标记未清理' : ''}）。`);
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

async function assertStorageCapacity(
  storage: Storage, changedKeys: string[], nextValues: Record<string, unknown>
): Promise<void> {
  const quota = (storage as Storage & { QUOTA_BYTES?: number }).QUOTA_BYTES ?? DEFAULT_STORAGE_QUOTA_BYTES;
  const [currentBytes, replacedBytes] = await Promise.all([
    storage.getBytesInUse(null), storage.getBytesInUse(changedKeys),
  ]);
  const encoder = new TextEncoder();
  const incomingBytes = Object.entries(nextValues).reduce((total, [key, value]) =>
    total + encoder.encode(JSON.stringify({ [key]: value })).byteLength, 0);
  const projected = Math.max(0, currentBytes - replacedBytes) + incomingBytes;
  if (!Number.isFinite(projected) || projected > quota) {
    throw new Error(
      `恢复后的本地数据预计占用约 ${Math.ceil(projected / 1024)} KiB，超过 Chrome 本地存储 ${Math.floor(quota / 1024)} KiB 限制；未执行写入。请清理本地数据或使用更小的备份。`
    );
  }
}

export interface BackupStorageMessage {
  type: typeof BACKUP_STORAGE_MESSAGE_TYPE;
  action: 'export' | 'restore';
  backup?: unknown;
  mode?: RestoreMode;
}
export type BackupStorageResponse =
  | { ok: true; backup?: LocalBackup }
  | { ok: false; error: string };

function sendBackupMessage(message: BackupStorageMessage): Promise<BackupStorageResponse> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    return Promise.reject(new Error('扩展后台不可用，未执行本地数据操作。'));
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackupStorageResponse | undefined) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message ?? '扩展后台不可用'));
      else if (response && typeof response.ok === 'boolean') resolve(response);
      else reject(new Error('扩展后台未确认备份操作结果。'));
    });
  });
}
export async function requestLocalBackup(): Promise<LocalBackup> {
  const response = await sendBackupMessage({ type: BACKUP_STORAGE_MESSAGE_TYPE, action: 'export' });
  if (!response.ok || !response.backup) {
    throw new Error(!response.ok ? response.error : '扩展后台未返回备份内容。');
  }
  return parseLocalBackup(JSON.stringify(response.backup));
}
export async function requestLocalBackupRestore(backup: LocalBackup, mode: RestoreMode): Promise<void> {
  const response = await sendBackupMessage({ type: BACKUP_STORAGE_MESSAGE_TYPE, action: 'restore', backup, mode });
  if (!response.ok) throw new Error(response.error);
}
