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

/**
 * Breakpoints of the layouts (px): under `phone`, one column and no separator; from `wide`, every column of a
 * mini-app side by side. Compared with the width of the box itself (a container), not the window.
 */
export const BP = { phone: 700, tablet: 900, wide: 1100 };

/** Phones: bottom tab bar, full-screen panels. */
export const PHONE_QUERY = '(max-width: 699px)';
