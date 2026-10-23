/**
 * Shared toolbar-warning protocol across content, background, and popup.
 */
export const TOOLBAR_COMPATIBILITY_WARNING = 'LUNA_TOOLBAR_COMPATIBILITY_WARNING';
export const TOOLBAR_COMPATIBILITY_HEALTHY = 'LUNA_TOOLBAR_COMPATIBILITY_HEALTHY';
export const PAGE_HOOK_HEALTH_PING = 'LUNA_PAGE_HOOK_HEALTH_PING';
export const PAGE_HOOK_HEALTH_PONG = 'LUNA_PAGE_HOOK_HEALTH_PONG';

export interface ToolbarCompatibilityWarning {
  detail: string;
  observedAt: number;
}

/** Returns the per-tab key for temporary, session-scoped warnings. */
export function toolbarWarningKey(tabId: number): string {
  return `luna:compatibility:tab:${tabId}`;
}

/** Validates a saved warning before rendering untrusted storage content. */
export function parseToolbarWarning(value: unknown): ToolbarCompatibilityWarning | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.detail !== 'string' || !record.detail.trim() ||
      typeof record.observedAt !== 'number' || !Number.isFinite(record.observedAt)) {
    return null;
  }
  return { detail: record.detail, observedAt: record.observedAt };
}
