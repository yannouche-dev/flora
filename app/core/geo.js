// @ts-check
// One shared GPS watch for the whole app, started on demand and stopped when nobody listens.

/**
 * @typedef {{ coordinates: [number, number], accuracy: number, timestamp: number }} Fix
 * @typedef {{ fix: Fix | null, error: string | null, watching: boolean }} GeoState
 */

/** @type {GeoState} */
let state = { fix: null, error: null, watching: false };
/** @type {Set<(state: GeoState) => void>} */
const listeners = new Set();
/** @type {number | null} */
let watchId = null;

const emit = () => { for (const listener of listeners) listener(state); };

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
    state = { ...state, error: 'Ce navigateur ne permet pas la géolocalisation.' };
    emit();
    return;
  }
  state = { ...state, watching: true, error: null };
  emit();
  watchId = navigator.geolocation.watchPosition(
    position => {
      state = {
        fix: {
          coordinates: [position.coords.longitude, position.coords.latitude],
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        },
        error: null,
        watching: true
      };
      emit();
    },
    error => {
      state = { ...state, error: explain(error) };
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
  listeners.add(listener);
  start();
  listener(state);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

/** Last known fix (may be stale or null). */
export const lastFix = () => state.fix;

/** Lit ReactiveController exposing the live GPS state while the host is connected. */
export class GeoController {
  /** @param {import('lit').ReactiveControllerHost} host */
  constructor(host) {
    this.host = host;
    /** @type {GeoState} */
    this.state = state;
    /** @type {(() => void) | null} */
    this.unsubscribe = null;
    host.addController(this);
  }

  hostConnected() {
    this.unsubscribe = watchLocation(next => { this.state = next; this.host.requestUpdate(); });
  }

  hostDisconnected() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
