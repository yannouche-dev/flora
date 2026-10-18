// @ts-check
// Storage full: a write to IndexedDB or localStorage refused for lack of room (QuotaExceededError). It is never
// swallowed in silence: the first one fires `full` on `quotaEvents` (the store shows a banner saying what to do),
// and callers that keep user data say « Non enregistré » where it was typed (localStorage: prefs.js#writeText). No
// imports: usable in the worker too.

/** Fires `full` once per session, the first time a write is refused for lack of room. */
export const quotaEvents = new EventTarget();

/** @param {unknown} error */
export function isQuotaError(error) {
  const e = /** @type {any} */ (error);
  // Safari's old code 22, Firefox's NS_ERROR_DOM_QUOTA_REACHED (code 1014).
  return Boolean(e) && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

let told = false;

/**
 * A write failed: if for lack of room, say so (once). Returns whether it was the quota.
 * @param {unknown} error
 */
export function noteStorageError(error) {
  if (!isQuotaError(error)) return false;
  if (!told) {
    told = true;
    quotaEvents.dispatchEvent(new Event('full'));
  }
  return true;
}
