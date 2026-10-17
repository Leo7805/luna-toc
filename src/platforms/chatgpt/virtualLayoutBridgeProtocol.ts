/**
 * Shared protocol constants and types for the ChatGPT virtual-layout bridge.
 */

/**
 * Custom event names used for cross-world DOM messaging.
 */
export const CHATGPT_BRIDGE_PROTOCOL = {
  EVENTS: {
    QUERY_REQUEST: '__LUNATOC_CHATGPT_VIRTUAL_LAYOUT_REQ__',
    QUERY_RESPONSE: '__LUNATOC_CHATGPT_VIRTUAL_LAYOUT_RES__',
  },
} as const;

/**
 * Production request DTO sent from ISOLATED world to MAIN world.
 */
export interface VirtualLayoutBridgeRequest {
  readonly requestId: string;
  readonly messageId: string;
}

/**
 * Production response DTO returned from MAIN world to ISOLATED world.
 */
export type VirtualLayoutBridgeResponse =
  | {
      readonly requestId: string;
      readonly status: 'ok';
      readonly targetIndex: number;
      readonly topOffsetPx: number;
      readonly turnCount: number;
    }
  | {
      readonly requestId: string;
      readonly status: 'target-not-in-layout';
      readonly turnCount: number;
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason?: string;
    };

/**
 * Generates a unique request correlation ID using crypto.randomUUID with fallback.
 *
 * @returns Unique correlation ID string.
 */
export function createBridgeRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return (
    'req-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}
