/**
 * ChatGPT page-hook adapter.
 *
 * Wires the page-hook concerns (matchMedia spoof, contract-update listener,
 * backfill URL builder, optional fetch-contract probe) to the
 * platform-agnostic machinery under `src/pageHook/`.
 *
 * The matchMedia spoof body lives at `./pageHook/matchMediaSpoof.ts`
 * (populated in step 6 of the platform-abstraction plan). This file holds
 * the contract-update poster, the backfill URL builder, and the
 * install-flag sentinel.
 */
import { CHATGPT_MESSAGE_TYPES } from './messages';

const HOOK_INSTALL_FLAG = '__conversationNavigatorFetchHookInstalled';

/**
 * Posts a contract-values update message to the page-hook from the content
 * script. The page-hook listens for this in `pageHook.iife.ts` and writes
 * the values into `effectiveContractValues` via the platform's contract
 * resolver.
 */
export function postContractUpdate(values: Record<string, string>): void {
  try {
    window.postMessage(
      {
        type: CHATGPT_MESSAGE_TYPES.configUpdate,
        contractValues: values,
      },
      window.location.origin
    );
  } catch {
    // PostMessage failures (detached window, etc.) are non-fatal.
  }
}

/**
 * Returns the paginated older-history URL for one backfill step. ChatGPT's
 * `/backend-api/conversations/{id}/messages` accepts `before`,
 * `include_has_versions`, and `num_turns` query params.
 */
export function buildBackfillUrl(
  conversationId: string,
  beforeCursor: string
): string {
  const url = new URL(
    `/backend-api/conversations/${conversationId}/messages`,
    window.location.origin
  );

  url.searchParams.set('before', beforeCursor);
  url.searchParams.set('include_has_versions', 'true');
  // Server caps `num_turns` around 100; one page usually carries the whole
  // history for typical conversations.
  url.searchParams.set('num_turns', String(BACKFILL_NUM_TURNS));

  return url.toString();
}

const BACKFILL_NUM_TURNS = 100;

/**
 * Sentinel string flagged on `window` to detect double installation.
 */
export const HOOK_INSTALL_FLAG_VALUE = HOOK_INSTALL_FLAG;