/** Read-only inventory and confirmed local cleanup of saved TOC aliases. */
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';
import {
  TOC_ALIAS_COMMIT_TYPE, TOC_ALIAS_PREFIX, TOC_ALIAS_DELETED_PREFIX,
  parseTocAliasRecord, type TocAliasRecord, type TocAliasCommitResponse,
} from './tocAliasWriteCoordinator';

export interface AliasCleanupCandidate {
  routeKey: string;
  record: TocAliasRecord;
  aliasCount: number;
}
export interface AliasCleanupInventory {
  candidates: AliasCleanupCandidate[];
  unreadable: number;
}

/**
 * A local inventory cannot prove a ChatGPT conversation was deleted.
 * The user must inspect and explicitly select the entry to remove.
 */
export async function listLocalTocAliases(
  storage: Pick<chrome.storage.StorageArea, 'get'> = chrome.storage.local
): Promise<AliasCleanupInventory> {
  const values = await storage.get(null) as Record<string, unknown>;
  const candidates: AliasCleanupCandidate[] = [];
  let unreadable = 0;
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(TOC_ALIAS_PREFIX)) continue;
    const routeKey = key.slice(TOC_ALIAS_PREFIX.length);
    if (!isPermanentConversationId(routeKey)) { unreadable++; continue; }
    if (Object.hasOwn(values, TOC_ALIAS_DELETED_PREFIX + routeKey)) continue;
    try {
      const record = parseTocAliasRecord(value);
      if (!record) { unreadable++; continue; }
      const aliasCount = Object.keys(record.aliases).length;
      if (aliasCount) candidates.push({ routeKey, record, aliasCount });
    } catch { unreadable++; }
  }
  candidates.sort((a, b) => a.routeKey.localeCompare(b.routeKey));
  return { candidates, unreadable };
}

/** Delete only the unchanged previewed record via the serial background writer. */
export async function requestManualTocAliasCleanup(
  candidate: AliasCleanupCandidate
): Promise<void> {
  if (!chrome.runtime?.id) throw new Error('扩展环境失效，请重新打开设置页。');
  const response = await new Promise<TocAliasCommitResponse>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-conversation',
      routeKey: candidate.routeKey, expected: candidate.record,
    }, (reply: TocAliasCommitResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? '清理服务不可用。'));
      } else if (!reply) {
        reject(new Error('清理服务未确认操作。'));
      } else {
        resolve(reply);
      }
    });
  });
  if (!response.ok) {
    if ('conflict' in response) throw new Error('目录记录已变化，请刷新列表后重新确认。');
    throw new Error(response.error);
  }
  if (!('deleted' in response) || !response.deleted) throw new Error('清理服务未确认删除。');
}
