// @ts-check
// Every remote JSON call of the app goes through fetchJson: a time limit (a captive portal or a dead zone never
// leaves a block « chargement… » for ever), a minimal check of the answer's shape, and a typed error that tells
// apart what the user can do something about. The kinds, from the caller's side:
//  - 'aborted'    the caller cancelled (the sheet closed, another plant opened): nothing to show;
//  - 'module-off' the module is switched off in Réglages (ModuleOffError, core/modules.js): « module désactivé »;
//  - 'offline'    the device has no network;
//  - 'timeout'    no answer within the time limit;
//  - 'http'       the service answered with an error status (503, 429…);
//  - 'schema'     the answer is not JSON, or not shaped as expected (an API that changed);
//  - 'network'    the request failed otherwise (DNS, CORS, connection reset).
// Everything but 'aborted' and 'module-off' is « source indisponible — Réessayer », never « aucune donnée ».

/** How long a remote call may take, body included, before it gives up (ms). */
export const TIMEOUT = 15000;

/** @typedef {'aborted' | 'module-off' | 'offline' | 'timeout' | 'http' | 'schema' | 'network'} ErrorKind */

/** A remote source did not give a usable answer. */
export class SourceError extends Error {
  /**
   * @param {Exclude<ErrorKind, 'aborted' | 'module-off'>} kind
   * @param {string} source the host asked (api.gbif.org…)
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [extra]
   */
  constructor(kind, source, message, { status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SourceError';
    this.kind = kind;
    this.source = source;
    this.status = status ?? null;
  }
}

/** The answer is not what the app reads (not JSON, or not shaped as expected). */
export class SchemaError extends SourceError {
  /** @param {string} source @param {string} message @param {unknown} [cause] */
  constructor(source, message, cause) {
    super('schema', source, message, { cause });
    this.name = 'SchemaError';
  }
}

const hostOf = (/** @type {string} */ url) => { try { return new URL(url).host; } catch { return String(url); } };
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A signal aborted after `ms` (reason: a TimeoutError DOMException), where the browser has AbortSignal.timeout or not.
 * @param {number} ms @returns {AbortSignal}
 */
export function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')), ms);
  return controller.signal;
}

/**
 * A signal aborted when any of `signals` is (AbortSignal.any, or its equivalent on older browsers).
 * @param {(AbortSignal | null | undefined)[]} signals @returns {AbortSignal}
 */
export function anySignal(signals) {
  const list = /** @type {AbortSignal[]} */ (signals.filter(Boolean));
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) { controller.abort(s.reason); break; }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/**
 * A fetch with a time limit, its failures as SourceError (a cancel by the caller stays an AbortError).
 * @param {string} url
 * @param {{ signal?: AbortSignal, headers?: Record<string, string>, timeout?: number, init?: RequestInit }} [options]
 * @returns {Promise<Response>} an ok response
 */
export function fetchOk(url, { signal, headers, timeout = TIMEOUT, init } = {}) {
  return request(url, signal, timeoutSignal(timeout), timeout, { ...init, headers });
}

/**
 * @param {string} url @param {AbortSignal | undefined} signal the caller's @param {AbortSignal} timer
 * @param {number} timeout @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function request(url, signal, timer, timeout, init) {
  const source = hostOf(url);
  if (signal?.aborted) throw abortError(signal);
  let response;
  try {
    response = await fetch(url, { ...init, signal: anySignal([signal, timer]) });
  } catch (error) {
    throw failure(error, source, signal, timer, timeout);
  }
  if (!response.ok) {
    throw new SourceError('http', source, `${source} ${response.status}${response.statusText ? ' ' + response.statusText : ''}`, { status: response.status });
  }
  return response;
}

/**
 * JSON from `url`, read within the time limit. `expect`: a minimal check of its shape (true: as expected), so an API
 * that changed fails loudly (SchemaError) instead of reading as « no data ». `allowEmpty`: an empty body (204) is null.
 * @param {string} url
 * @param {{ signal?: AbortSignal, headers?: Record<string, string>, timeout?: number, expect?: (data: any) => boolean, allowEmpty?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, { signal, headers = {}, timeout = TIMEOUT, expect, allowEmpty = false } = {}) {
  const source = hostOf(url);
  const timer = timeoutSignal(timeout);
  // One time limit for the request and the body.
  const response = await request(url, signal, timer, timeout, { headers: { accept: 'application/json', ...headers } });
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw failure(error, source, signal, timer, timeout);
  }
  if (allowEmpty && !text.trim()) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new SchemaError(source, `${source} : réponse illisible (pas du JSON)`, error);
  }
  if (data === null || typeof data !== 'object') throw new SchemaError(source, `${source} : réponse inattendue`);
  if (expect && !safeCheck(expect, data)) throw new SchemaError(source, `${source} : réponse de forme inattendue`);
  return data;
}

/** @param {(data: any) => boolean} expect @param {any} data */
function safeCheck(expect, data) {
  try { return Boolean(expect(data)); } catch { return false; }
}

/** @param {AbortSignal} signal */
function abortError(signal) {
  const reason = signal.reason;
  return reason instanceof Error && reason.name === 'AbortError' ? reason : new DOMException('Requête annulée', 'AbortError');
}

/**
 * What a failed fetch (or body read) means: the caller's cancel, the time limit, no network, or another failure.
 * @param {unknown} error @param {string} source @param {AbortSignal | undefined} signal @param {AbortSignal} timer @param {number} timeout
 */
function failure(error, source, signal, timer, timeout) {
  if (error instanceof SourceError) return error;
  if (signal?.aborted) return abortError(signal);
  if (timer.aborted || /** @type {Error} */ (error)?.name === 'TimeoutError') {
    return new SourceError('timeout', source, `${source} ne répond pas (plus de ${Math.round(timeout / 1000)} s)`, { cause: error });
  }
  if (offline()) return new SourceError('offline', source, 'Hors ligne', { cause: error });
  return new SourceError('network', source, `${source} injoignable`, { cause: error });
}

/**
 * The kind of an error, from the caller's side (see the head of this file).
 * @param {unknown} error @returns {ErrorKind}
 */
export function errorKind(error) {
  const e = /** @type {any} */ (error);
  if (e?.name === 'AbortError') return 'aborted';
  if (e?.name === 'ModuleOffError') return 'module-off';
  if (e instanceof SourceError || (e && typeof e.kind === 'string' && e.name === 'SourceError')) {
    return e.kind === 'network' && offline() ? 'offline' : e.kind;
  }
  if (e?.name === 'TimeoutError') return 'timeout';
  if (e instanceof SyntaxError) return 'schema';
  return offline() ? 'offline' : 'network';
}

/** The source could not answer (the user can retry): not a cancel, not a module switched off. @param {unknown} error */
export const isUnavailable = error => error != null && !['aborted', 'module-off'].includes(errorKind(error));

/**
 * Why a source is unavailable, in a few French words (« hors ligne », « délai dépassé », « erreur 503 »…).
 * @param {unknown} error @returns {string}
 */
export function unavailableReason(error) {
  const e = /** @type {any} */ (error);
  switch (errorKind(error)) {
    case 'offline': return 'hors ligne';
    case 'timeout': return 'pas de réponse à temps';
    case 'http': return e?.status === 429 ? 'trop de demandes' : 'erreur ' + (e?.status ?? 'du serveur');
    case 'schema': return 'réponse inattendue';
    case 'module-off': return 'module désactivé';
    case 'aborted': return 'annulé';
    default: return 'injoignable';
  }
}
