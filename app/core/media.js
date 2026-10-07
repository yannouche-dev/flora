// @ts-check

/** Lit controller tracking a media query (desktop panes vs. phone layout). */
export class MediaController {
  /** @param {import('lit').ReactiveControllerHost} host @param {string} query */
  constructor(host, query) {
    this.media = matchMedia(query);
    this.matches = this.media.matches;
    this.onChange = () => { this.matches = this.media.matches; host.requestUpdate(); };
    host.addController(this);
  }

  hostConnected() { this.media.addEventListener('change', this.onChange); }
  hostDisconnected() { this.media.removeEventListener('change', this.onChange); }
}

/** Phones: bottom tab bar, full-screen panels. */
export const PHONE_QUERY = '(max-width: 699px)';
