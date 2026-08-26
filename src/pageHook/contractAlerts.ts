/**
 * Watches for ChatGPT contract drift and posts developer-facing mismatch
 * messages to the content-script detector. Owns the per-contract mismatch
 * counters and the effective-contract-value map. The latter is updated by
 * the entry's contract-config `message` listener via
 * `setEffectiveContractValues`, and read by `reportContractMismatch` /
 * `checkConversationPathAgainstContract`.
 *
 * `installContractAlerts({ originalFetch })` is reserved for future warmup.
 * Today it only captures `originalFetch` so the `num_turns` probe can replay
 * ChatGPT requests without going through the entry's `window.fetch` override.
 */
import { getActiveContractValue, type ChatGptContractId } from '@/config/config';
import { PAGE_HOOK_MISMATCH_MESSAGE_TYPE } from '@/features/contractAlert/pageHookBridge';

/**
 * Minimum number of times a given contract mismatch must be observed in a
 * session before it is forwarded to the content-script detector. One-off
 * path variations are filtered out; consistent mismatches reach the
 * developer-facing alert.
 */
const CONTRACT_MISMATCH_REPORT_THRESHOLD = 2;

const contractMismatchCounters = new Map<ChatGptContractId, number>();

/**
 * Effective contract values pushed from the content script. When a value
 * is present it overrides the hard-coded fallback used by the page-hook
 * detection. Populated on startup and on every `chrome.storage` change.
 */
const effectiveContractValues: Partial<Record<ChatGptContractId, string>> = {};

let originalFetch: typeof fetch = window.fetch.bind(window);

/**
 * Reserved for future module warmup. The entry passes the page-bound
 * `originalFetch` once so the `num_turns` probe can replay ChatGPT
 * requests without going through our own `window.fetch` override.
 */
export function installContractAlerts(opts: { originalFetch: typeof fetch }): void {
  originalFetch = opts.originalFetch;
}

/**
 * Replaces the effective contract-value map. Called by the entry whenever
 * the content script posts a fresh `LUNA_CHATGPT_CONFIG_UPDATE`.
 */
export function setEffectiveContractValues(
  values: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      effectiveContractValues[key as ChatGptContractId] = value;
    }
  }
}

/**
 * Returns the effective contract value pushed by the content script, or
 * `undefined` if no override has been received yet.
 */
export function getEffectiveContractValue(
  id: ChatGptContractId
): string | undefined {
  return effectiveContractValues[id];
}

/**
 * Compares an observed request path against the developer's active
 * expectation for a given contract slot. Returns `true` when the path
 * matches the active template, `false` when it does not, and `null` when
 * no effective template is available yet (i.e. the content script has not
 * pushed an override).
 *
 * The entry uses this to decide whether to forward a mismatch to
 * `reportContractMismatch` so the bridge sees only one signal per
 * violating request.
 */
export function checkConversationPathAgainstContract(
  contractId: ChatGptContractId,
  requestPath: string
): boolean | null {
  const expectedTemplate = effectiveContractValues[contractId];
  if (!expectedTemplate) return null;
  return buildPathRegexFromTemplate(expectedTemplate).test(requestPath);
}

/**
 * Increments the per-contract mismatch counter and, once it crosses the
 * report threshold, posts a `LUNA_CONTRACT_MISMATCH` message to the
 * content-script detector. Subsequent observations of the same contract
 * are ignored so a noisy page does not spam the bridge.
 * @param {ChatGptContractId} contractId
 * @param {string} actual The value the page-hook actually observed.
 */
export function reportContractMismatch(
  contractId: ChatGptContractId,
  actual: string
): void {
  const previous = contractMismatchCounters.get(contractId) ?? 0;
  if (previous >= CONTRACT_MISMATCH_REPORT_THRESHOLD) return;
  const next = previous + 1;
  contractMismatchCounters.set(contractId, next);
  if (next < CONTRACT_MISMATCH_REPORT_THRESHOLD) return;

  try {
    window.postMessage(
      {
        type: PAGE_HOOK_MISMATCH_MESSAGE_TYPE,
        contractId,
        expected: getActiveContractValue(contractId, false),
        actual,
      },
      window.location.origin
    );
  } catch {}
}

/**
 * Builds a RegExp from a contract path template by escaping every regex
 * special character and substituting the `{id}` placeholder with a path
 * segment matcher.
 * @param {string} template
 * @returns {RegExp}
 */
function buildPathRegexFromTemplate(template: string): RegExp {
  const parts = template.split('{id}').map((part) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp('^' + parts.join('([^/]+)') + '/?$');
}

/**
 * Probes ChatGPT's `/messages` endpoint with two different `num_turns`
 * values and compares the returned message counts. If the counts are
 * nearly equal the server is ignoring or capping the parameter, which
 * silently breaks the page-hook's fetch-bumping strategy.
 */
export async function probeNumTurnsBehavior(
  conversationId: string,
  authHeaders: Record<string, string> | null
): Promise<void> {
  const base = `/backend-api/conversations/${conversationId}/messages`;
  try {
    const [r10, r100] = await Promise.all([
      originalFetch(`${base}?num_turns=10&include_has_versions=true`, {
        method: 'GET',
        credentials: 'include',
        headers: authHeaders ?? undefined,
      }),
      originalFetch(`${base}?num_turns=100&include_has_versions=true`, {
        method: 'GET',
        credentials: 'include',
        headers: authHeaders ?? undefined,
      }),
    ]);
    if (!r10.ok || !r100.ok) return;
    const [d10, d100] = await Promise.all([r10.json(), r100.json()]);
    const len10 = Array.isArray(d10?.messages) ? d10.messages.length : 0;
    const len100 = Array.isArray(d100?.messages)
      ? d100.messages.length
      : 0;
    if (len10 > 0 && len100 > 0 && len100 - len10 < 5) {
      reportContractMismatch(
        'api.params.num-turns',
        `num_turns=10 -> ${len10} messages, num_turns=100 -> ${len100} messages (delta ${len100 - len10})`
      );
    }
  } catch {
    // Probe failures are non-fatal.
  }
}

/**
 * After the initial conversation load settles, checks that the DOM
 * selectors relied on by navigation still match at least one node. A zero
 * hit count means ChatGPT renamed or removed the marker attribute, which
 * silently breaks prompt navigation.
 */
export function probeDomSelectors(): void {
  setTimeout(() => {
    try {
      const userCount = document.querySelectorAll(
        '[data-message-author-role="user"]'
      ).length;
      const idCount = document.querySelectorAll('[data-message-id]').length;
      if (userCount === 0) {
        reportContractMismatch(
          'dom.selector.user-message',
          'querySelectorAll returned 0 user message nodes'
        );
      }
      if (idCount === 0) {
        reportContractMismatch(
          'dom.selector.message-id',
          'querySelectorAll returned 0 message-id nodes'
        );
      }
    } catch {
      // Selector probe failures are non-fatal.
    }
  }, 3000);
}