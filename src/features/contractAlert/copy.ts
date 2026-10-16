/**
 * English copy strings for the ChatGPT compatibility alert. All UI strings
 * shipped to end users live here so translators (and grep) have a single
 * source of truth.
 */

/** Modal title shown at the top of the compatibility alert. */
export const COMPATIBILITY_ALERT_TITLE = 'ChatGPT 兼容性提醒';

/**
 * Body sentence rendered once per mismatching contract entry. The `{label}`
 * placeholder is replaced with the contract value's human-readable label.
 */
export const COMPATIBILITY_ALERT_BODY =
  "检测到 ChatGPT 的{label}已发生变化，可能影响 LunaTOC。请等待扩展作者发布修复版本。";

/** Disclosure summary for the collapsible technical-details block. */
export const COMPATIBILITY_ALERT_DETAILS_SUMMARY = '技术详情';

/** Label for the expected-value row in the technical details block. */
export const COMPATIBILITY_ALERT_DETAILS_EXPECTED = '预期值';

/** Label for the observed-value row in the technical details block. */
export const COMPATIBILITY_ALERT_DETAILS_OBSERVED = '实际值';

/** Caption shown when more than one contract entry has mismatched. */
export const COMPATIBILITY_ALERT_MULTI_NOTE =
  '检测到 {count} 项 ChatGPT 兼容性变化，详情如下。';

/** Dismiss button label (also rendered by the shared Dialog component). */
export const COMPATIBILITY_ALERT_DISMISS = '关闭';