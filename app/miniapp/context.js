// @ts-check
// A mini-app's context: the few values its components share (a place, a plant in focus…), declared in its manifest,
// and what is derived from them. One snapshot at a time, never changed in place: a component reads it, and writes
// only through set(), which keeps to the declared keys (others ignored), clamps numbers to their min and max, and
// does nothing for a value equal to the one there (Object.is). A derived value is computed when read, and again only
// when one of the values it read changed: the same object otherwise (a map given the same area does not move).
// Pure: tested under Node.

/**
 * @typedef {import('./define.js').ContextKey} ContextKey
 * @typedef {{ get: () => Record<string, any>, set: (patch: Record<string, unknown>) => boolean,
 *   subscribe: (fn: (c: Record<string, any>) => void) => () => void, persisted: () => Record<string, unknown> }} Context
 */

/**
 * @param {Record<string, ContextKey>} spec @param {Record<string, (c: any) => unknown>} [derive]
 * @param {Record<string, unknown> | null} [saved] values kept from an earlier visit (persist keys only)
 * @returns {Context}
 */
export function createContext(spec, derive = {}, saved = null) {
  /** @param {string} key @param {unknown} v */
  const clamp = (key, v) => {
    const { min, max } = spec[key];
    if (typeof v !== 'number') return v;
    return Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity);
  };
  /** @type {Record<string, unknown>} */
  let values = Object.fromEntries(Object.entries(spec).map(([k, s]) =>
    [k, saved && s.persist && k in saved ? clamp(k, saved[k]) : s.init]));
  /** Derived values: each with the values it read, as they were. @type {Map<string, { value: unknown, read: Map<string, unknown> }>} */
  const memo = new Map();
  /** @type {Set<(c: Record<string, any>) => void>} */
  const subscribers = new Set();
  /** @type {Record<string, any> | null} */
  let snapshot = null;

  /** @param {string} key @param {Set<string>} busy */
  const derived = (key, busy) => {
    const was = memo.get(key);
    if (was && [...was.read].every(([k, v]) => Object.is(read(k, busy), v))) return was.value;
    if (busy.has(key)) throw new Error(`derive.${key} reads itself`);
    busy.add(key);
    /** @type {Map<string, unknown>} */
    const seen = new Map();
    const view = new Proxy({}, {
      get: (_, k) => { if (typeof k !== 'string') return undefined; const v = read(k, busy); seen.set(k, v); return v; },
      has: (_, k) => typeof k === 'string' && (k in values || k in derive)
    });
    const value = derive[key](view);
    busy.delete(key);
    memo.set(key, { value, read: seen });
    return value;
  };
  /** @param {string} key @param {Set<string>} busy */
  const read = (key, busy) => key in derive ? derived(key, busy) : values[key];

  const get = () => {
    if (snapshot) return snapshot;
    const all = { ...values };
    for (const key of Object.keys(derive)) all[key] = derived(key, new Set());
    snapshot = Object.freeze(all);
    return snapshot;
  };

  return {
    get,
    set(patch) {
      /** @type {Record<string, unknown>} */
      const next = { ...values };
      let changed = false;
      for (const [k, v] of Object.entries(patch || {})) {
        if (!(k in spec)) continue;
        const value = clamp(k, v);
        if (Object.is(value, next[k])) continue;
        next[k] = value;
        changed = true;
      }
      if (!changed) return false;
      values = next;
      snapshot = null;
      const c = get();
      for (const fn of [...subscribers]) fn(c);
      return true;
    },
    subscribe(fn) { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    persisted: () => Object.fromEntries(Object.entries(spec).filter(([, s]) => s.persist).map(([k]) => [k, values[k]]))
  };
}
