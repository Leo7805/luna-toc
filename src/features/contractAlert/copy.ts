/**
 * English copy strings for the ChatGPT compatibility alert. All UI strings
 * shipped to end users live here so translators (and grep) have a single
 * source of truth.
 */

/** Modal title shown at the top of the compatibility alert. */
export const COMPATIBILITY_ALERT_TITLE = 'ChatGPT Compatibility Notice';

/**
 * Body sentence rendered once per mismatching contract entry. The `{label}`
 * placeholder is replaced with the contract value's human-readable label.
 */
export const COMPATIBILITY_ALERT_BODY =
  "ChatGPT's {label} appears to have updated. This may affect LunaTOC. Please wait for the plugin author to release a fix.";

/** Disclosure summary for the collapsible technical-details block. */
export const COMPATIBILITY_ALERT_DETAILS_SUMMARY = 'Technical details';

/** Label for the expected-value row in the technical details block. */
export const COMPATIBILITY_ALERT_DETAILS_EXPECTED = 'Expected';

/** Label for the observed-value row in the technical details block. */
export const COMPATIBILITY_ALERT_DETAILS_OBSERVED = 'Observed';

/** Caption shown when more than one contract entry has mismatched. */
export const COMPATIBILITY_ALERT_MULTI_NOTE =
  '{count} ChatGPT contracts appear to have changed. Each is listed below.';

/** Dismiss button label (also rendered by the shared Dialog component). */
export const COMPATIBILITY_ALERT_DISMISS = 'Dismiss';