// @ts-check
// One shared GPS watch for the whole app, started on demand and stopped when nobody listens.
// The browser asks for the position only after a gesture (« Autour de moi », « Me localiser », « Noter ici »…):
// screens that merely use the position when they have it (distances, « ma position » on a map) start their watch
// once the permission is granted (whenGranted), never on their own.

/**
 * @typedef {{ coordinates: [number, number], accuracy: number, timestamp: number }} Fix
 * @typedef {'denied' | 'timeout' | 'unavailable' | 'unsupported'} GeoCode  why there is no position (each screen says it its own way)
 * @typedef {{ fix: Fix | null, error: string | null, code?: GeoCode | null, watching: boolean }} GeoState
 */

/** @type {GeoState} */
let state = { fix: null, error: null, code: null, watching: false };
/** @type {Set<(state: GeoState) => void>} */
const listeners = new Set();
/** @type {number | null} */
let watchId = null;

const emit = () => { for (const listener of listeners) listener(state); };

/** Whether the geolocation permission is granted (null: not known yet), and who waits for it. @type {boolean | null} */
let granted = null;
/** @type {Set<() => void>} */
const waiting = new Set();

/** The permission is granted (a fix came, or the browser says so): those waiting for it start. */
function grant() {
  if (granted) return;
  granted = true;
  for (const callback of [...waiting]) { waiting.delete(callback); callback(); }
}

/** Asks the browser once whether the permission is already granted, and follows its changes. */
let asked = false;
function askPermission() {
  if (asked) return;
  asked = true;
  try {
    navigator.permissions?.query({ name: /** @type {PermissionName} */ ('geolocation') }).then(status => {
      if (status.state === 'granted') grant();
      status.addEventListener('change', () => { if (status.state === 'granted') grant(); else granted = false; });
    }, () => { /* unknown: wait for a gesture */ });
  } catch { /* no Permissions API: wait for a gesture */ }
}

/**
 * Calls back once the geolocation permission is granted: at once if it already is, else when it becomes so (after
 * a gesture somewhere in the app). Never asks the browser for the position itself.
 * @param {() => void} callback
 * @returns {() => void} cancel
 */
export function whenGranted(callback) {
  if (granted) { callback(); return () => {}; }
  waiting.add(callback);
  askPermission();
  return () => { waiting.delete(callback); };
}

/** @param {GeolocationPositionError} error @returns {GeoCode} */
const codeOf = error => error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable';

/** @param {GeolocationPositionError} error */
function explain(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Localisation refusée. Autorisez-la dans les réglages du navigateur pour enregistrer votre position.';
  }
  if (error.code === error.TIMEOUT) return 'Position GPS introuvable pour le moment. Restez à découvert quelques secondes.';
  return 'Position indisponible. Vous pouvez placer le point à la main sur la carte.';
}

function start() {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) {
    state = { ...state, error: 'Ce navigateur ne permet pas la géolocalisation.', code: 'unsupported' };
    emit();
    return;
  }
  state = { ...state, watching: true, error: null, code: null };
  emit();
  watchId = navigator.geolocation.watchPosition(
    position => {
      grant();
      state = {
        fix: {
          coordinates: [position.coords.longitude, position.coords.latitude],
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        },
        error: null,
        code: null,
        watching: true
      };
      emit();
    },
    error => {
      state = { ...state, error: explain(error), code: codeOf(error) };
      emit();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
  );
}

function stop() {
  if (watchId === null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  state = { ...state, watching: false };
}

/**
 * Subscribes to GPS updates; the watch runs while at least one subscriber exists.
 * @param {(state: GeoState) => void} listener
 * @returns {() => void} unsubscribe
 */
export function watchLocation(listener) {
  // A newcomer after a failure (« Réessayer », another screen) asks again: the watch is started anew, not left on
  // the old error.
  if (state.error && watchId !== null) stop();
  // Started before the listener joins: start() tells those already there, the new one hears the state once.
  start();
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

/** Last known fix (may be stale or null). */
export const lastFix = () => state.fix;

/**
 * Lit ReactiveController exposing the live GPS state while the host is connected. It watches only once the
 * permission is granted (whenGranted), or after start() (a gesture: « Noter ici »…); until then its state has no fix.
 */
export class GeoController {
  /** @param {import('lit').ReactiveControllerHost} host */
  constructor(host) {
    this.host = host;
    /** @type {GeoState} */
    this.state = { fix: null, error: null, code: null, watching: false };
    /** @type {(() => void) | null} */
    this.unsubscribe = null;
    /** @type {(() => void) | null} */
    this.unwait = null;
    this.connected = false;
    host.addController(this);
  }

  hostConnected() {
    this.connected = true;
    this.unwait = whenGranted(() => { this.unwait = null; this.start(); });
  }

  /** Watches now (after a gesture, or once the permission is granted), while the host stays connected. */
  start() {
    if (this.unsubscribe || !this.connected) return;
    this.unsubscribe = watchLocation(next => { this.state = next; this.host.requestUpdate(); });
  }

  /** Watching (or asked to). */
  get started() { return Boolean(this.unsubscribe); }

  hostDisconnected() {
    this.connected = false;
    this.unwait?.();
    this.unwait = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
