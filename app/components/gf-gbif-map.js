// @ts-check
import { LitElement, html, css } from 'lit';
import * as L from 'leaflet';
import { FRANCE_BOUNDS, tileLayer } from '../core/ign.js';
import { gbifTileUrl } from '../core/sources.js';

const LEAFLET_CSS = new URL('../../vendor/leaflet.css', import.meta.url).href;

/**
 * A plant's distribution in France: GBIF occurrence density over the IGN plan (« IGN – fonds de carte »
 * switched off: the areas already seen only). Small, framed on metropolitan France; drag and zoom to look closer.
 */
export class GfGbifMap extends LitElement {
  static properties = {
    taxonKey: { type: Number, attribute: 'taxon-key' }
  };

  static styles = css`
    :host { display: block; }
    .map { height: 260px; border-radius: var(--gf-radius); overflow: hidden; border: 1px solid var(--gf-border); background: var(--gf-surface-2); }
    .gf-tiles-gbif { mix-blend-mode: multiply; }
  `;

  constructor() {
    super();
    this.taxonKey = 0;
  }

  /** @type {L.Map | null} */ #map = null;
  /** @type {L.TileLayer | null} */ #density = null;

  render() {
    return html`<link rel="stylesheet" href=${LEAFLET_CSS} /><div class="map" role="img" aria-label="Carte de répartition des occurrences GBIF en France"></div>`;
  }

  firstUpdated() { this.#create(); }

  connectedCallback() {
    super.connectedCallback();
    // Moved in the page (the sheet under a swiped card coming up): the map was removed with it.
    if (this.hasUpdated && !this.#map) this.#create();
  }

  #create() {
    const el = /** @type {HTMLElement} */ (this.renderRoot.querySelector('.map'));
    if (!el) return;
    const map = this.#map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, minZoom: 4, maxZoom: 12 });
    map.attributionControl.setPrefix(false);
    tileLayer('plan').addTo(map);
    map.fitBounds(FRANCE_BOUNDS);
    this.#show();
    // The sheet may lay the block out after the map was created (folded block, swipe card): size again.
    this.#resize?.disconnect();
    this.#resize = new ResizeObserver(() => map.invalidateSize());
    this.#resize.observe(el);
  }

  /** @type {ResizeObserver | null} */ #resize = null;

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (changed.has('taxonKey') && this.#map) this.#show();
  }

  #show() {
    this.#density?.remove();
    this.#density = null;
    if (!this.#map || !this.taxonKey) return;
    this.#density = L.tileLayer(gbifTileUrl(this.taxonKey, 'FR'), {
      attribution: 'Occurrences : <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF.org</a>',
      crossOrigin: 'anonymous', opacity: 0.9, className: 'gf-tiles-gbif', maxNativeZoom: 14
    }).addTo(this.#map);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize?.disconnect();
    this.#map?.remove();
    this.#map = null;
  }
}

customElements.define('gf-gbif-map', GfGbifMap);
