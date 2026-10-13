// @ts-check
// An element of the kit drawn again at each `change` of the game it shows (a session of kit/session.js or
// kit/trail-session.js): new SessionWatch(this, () => this.session) — the session followed as the property changes,
// let go when the element leaves the page.

/** @typedef {import('lit').ReactiveController} ReactiveController */

/** @implements {ReactiveController} */
export class SessionWatch {
  /** @param {import('lit').ReactiveControllerHost} host @param {() => EventTarget | null | undefined} get */
  constructor(host, get) {
    this.host = host;
    this.get = get;
    /** @type {EventTarget | null} */
    this.watched = null;
    host.addController(this);
  }

  #onChange = () => this.host.requestUpdate();

  hostUpdate() {
    const s = this.get() ?? null;
    if (s === this.watched) return;
    this.watched?.removeEventListener('change', this.#onChange);
    this.watched = s;
    s?.addEventListener('change', this.#onChange);
  }

  hostConnected() { this.hostUpdate(); }

  hostDisconnected() {
    this.watched?.removeEventListener('change', this.#onChange);
    this.watched = null;
  }
}
