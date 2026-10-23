/** Shared MAIN / ISOLATED world message contract for on-demand refresh. */
export const TOC_REFRESH_REQUEST = 'LUNA_TOC_REFRESH_REQUEST';
export const TOC_REFRESH_RESULT = 'LUNA_TOC_REFRESH_RESULT';

/** Cancels a particular waiting refresh without affecting other consumers. */
export const TOC_REFRESH_CANCEL = 'LUNA_TOC_REFRESH_CANCEL';

/** Bound request lifetime in both execution worlds. */
export const TOC_REFRESH_TIMEOUT_MS = 15_000;
