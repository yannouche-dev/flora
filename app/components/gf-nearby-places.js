// @ts-check
// The lieux near where a plant is about to be noted, offered before a new lieu is made — the same offer everywhere
// (collections.js placesNear: within NEAR_PLACE, the three nearest, never a parcours): « Noter ici » (gf-capture, mode
// `note`: « Y ajouter {plante} » in each) and a new lieu's editor (gf-spot-editor, mode `open`: « Y ajouter {plante} »
// when it is not there yet, else « Ouvrir ce lieu »). A choice fires `nearby-pick` { id } on the element; nothing to
// offer, nothing drawn. Its focus goes to its first choice (delegatesFocus).

import { LitElement, html, css, nothing } from 'lit';
import { findEntry, formatDistance, placeTitle, plantCount } from '../core/collections.js';
import { ui } from '../styles/ui.js';

export class GfNearbyPlaces extends LitElement {
  static properties = {
    /** The lieux to offer (collections.js placesNear): { place, distance }, nearest first. */
    rows: { attribute: false },
    /** The plant to note: { id, name }, or null (a new lieu without a plant yet). */
    plant: { attribute: false },
    /** `note`: noted in the lieu chosen (« Noter ici »); `open`: the lieu opened, the plant added to it (a new lieu's editor). */
    mode: {},
    /** The choice is being noted: the buttons wait. */
    disabled: { type: Boolean }
  };

  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static styles = [ui, css`
    :host { display: block; }
    .nearby {
      border-color: var(--gf-accent);
      background: var(--gf-accent-soft);
      font-size: 0.9rem;
      display: grid;
      gap: 8px;
    }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    li span { flex: 1; min-width: 140px; }
    small { color: var(--gf-text-muted); }
  `];

  constructor() {
    super();
    /** @type {{ place: import('../core/collections.js').Place, distance: number }[]} */
    this.rows = [];
    /** @type {{ id: number | null, name: string } | null} */
    this.plant = null;
    /** @type {'note' | 'open'} */
    this.mode = 'open';
    this.disabled = false;
  }

  /** @param {import('../core/collections.js').Place} place */
  #label(place) {
    const p = this.plant;
    if (this.mode === 'note' && p) return `Y ajouter ${p.name}`;
    return p && !findEntry(place, p.id) ? `Y ajouter ${p.name}` : 'Ouvrir ce lieu';
  }

  render() {
    if (!this.rows.length) return nothing;
    return html`<div class="nearby card" role="region" aria-label="Lieux à proximité">
      <strong>Vous êtes près d’un lieu déjà enregistré</strong>
      <ul>${this.rows.map(({ place, distance }) => html`
        <li>
          <span>${placeTitle(place)} <small>· ${formatDistance(distance)} · ${plantCount(place.properties.plants.length)}</small></span>
          <button type="button" ?disabled=${this.disabled}
            @click=${() => this.dispatchEvent(new CustomEvent('nearby-pick', { detail: { id: place.id } }))}>${this.#label(place)}</button>
        </li>`)}
      </ul>
    </div>`;
  }
}

customElements.define('gf-nearby-places', GfNearbyPlaces);
