// @ts-check
// Between the tabs and windows of GeoFlora (an installed app and a browser tab, the Carte here and a sheet there):
// a write in one is announced to the others, which read the stored state again instead of overwriting it with a
// stale copy of their own.
//  - publish(type, detail) / subscribe(type, fn): a BroadcastChannel('geoflora') — where there is none, a
//    localStorage key whose `storage` event carries the message;
//  - onStorage(key, fn): the settings kept in localStorage (modules, modes, layout…), changed in another tab.
// No imports: usable anywhere. Messages only say what changed, never carry the data (it is always read back).

const CHANNEL = 'geoflora';
/** The fallback's key (only where BroadcastChannel is missing). */
const RELAY = 'geoflora.sync';

/** @type {Map<string, Set<(detail: any) => void>>} */
const handlers = new Map();
/** @type {Map<string, Set<() => void>>} */
const storageHandlers = new Map();

/** @param {any} message */
function deliver(message) {
  if (!message || typeof message.type !== 'string') return;
  for (const fn of handlers.get(message.type) || []) {
    try { fn(message.detail ?? {}); } catch (error) { console.error(error); }
  }
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
if (channel) {
  channel.onmessage = event => deliver(event.data);
  // Node (unit tests): an open channel must not keep the process alive.
  /** @type {any} */ (channel).unref?.();
}

if (typeof window !== 'undefined') {
  addEventListener('storage', event => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === RELAY) {
      if (!channel && event.newValue) { try { deliver(JSON.parse(event.newValue)); } catch { /* not ours */ } }
      return;
    }
    // key null: the whole storage cleared elsewhere — every setting read again.
    const fns = event.key === null ? [...storageHandlers.values()].flatMap(s => [...s]) : [...storageHandlers.get(event.key) || []];
    for (const fn of fns) {
      try { fn(); } catch (error) { console.error(error); }
    }
  });
}

/**
 * Tells the other tabs that something changed (`type`: 'spots', 'notes'…). Never echoed to this tab.
 * @param {string} type @param {Record<string, any>} [detail]
 */
export function publish(type, detail = {}) {
  const message = { type, detail };
  try {
    if (channel) channel.postMessage(message);
    // The nonce makes every message a change of the key, so each one fires `storage`.
    else localStorage.setItem(RELAY, JSON.stringify({ ...message, nonce: Math.random() }));
  } catch { /* no other tab to tell */ }
}

/**
 * Runs `fn` when another tab publishes `type`. @param {string} type @param {(detail: any) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(type, fn) {
  let set = handlers.get(type);
  if (!set) handlers.set(type, set = new Set());
  set.add(fn);
  return () => { set.delete(fn); };
}

/**
 * Runs `fn` when another tab changes (or removes) a localStorage key. @param {string} key @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onStorage(key, fn) {
  let set = storageHandlers.get(key);
  if (!set) storageHandlers.set(key, set = new Set());
  set.add(fn);
  return () => { set.delete(fn); };
}
