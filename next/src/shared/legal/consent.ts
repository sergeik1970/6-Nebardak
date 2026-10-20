/**
 * Edition of the personal-data consent. Must match
 * `nest/src/legal/consent.ts`: the API rejects sign-ups for any other value,
 * so a page with an outdated text can never record a consent to it.
 */
export const CURRENT_CONSENT_VERSION = "2026-10-20";

/** Human-readable date of the same edition, shown on the legal pages. */
export const CURRENT_CONSENT_DATE = "20 октября 2026 г.";
