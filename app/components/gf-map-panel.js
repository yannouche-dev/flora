// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { BASES, OVERLAYS, IGN_PREFIX, addedLayers, ignCatalog, overlayDef } from '../core/ign.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { openModal } from '../core/history.js';

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/**
 * "Carte" panel: everything about how the map looks, in one bottom sheet — background, overlays
 * (terrain, protected areas, and any layer of IGN's whole catalogue), legend, sources. Events: base-change {key},
 * overlay-toggle {key, on, layer?} (`layer`: a catalogue layer to add).
 */
export class GfMapPanel extends LitElement {
  static properties = {
    base: { type: String },
    overlays: { attribute: false },
    /** Name of the plant whose GBIF distribution can be shown (null: none offered). */
    distribution: { attribute: false },
    distributionOn: { attribute: false },
    legend: { type: Boolean },
    _catalog: { state: true },
    _q: { state: true }
  };

  static styles = [ui, css`
    dialog {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 520px;
      max-height: 86dvh;
      margin: 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--gf-radius-lg) var(--gf-radius-lg) 0 0;
      background: var(--gf-surface);
      color: var(--gf-text);
      flex-direction: column;
    }
    dialog[open] { display: flex; }
    dialog::backdrop { background: rgb(0 0 0 / 35%); }
    @media (min-width: 700px) { dialog { inset: 0; margin: auto; border-radius: var(--gf-radius-lg); height: fit-content; } }
    header { display: flex; align-items: center; padding: 10px 8px 6px 16px; border-bottom: 1px solid var(--gf-border); }
    header h2 { margin: 0; font-size: 1.1rem; flex: 1; }
    .body { overflow-y: auto; padding: 4px 16px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 4px; }
    h3 { margin: 14px 0 6px; }
    .bases { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .bases button {
      display: grid;
      justify-items: center;
      gap: 4px;
      min-height: 72px;
      border-radius: var(--gf-radius);
      font-size: 0.9rem;
    }
    .bases .ico { font-size: 1.6rem; line-height: 1; }
    .bases button[aria-pressed='true'] { background: var(--gf-accent-soft); border-color: var(--gf-accent); border-width: 2px; font-weight: 600; }
    label.layer { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-radius: var(--gf-radius-sm); cursor: pointer; }
    label.layer:hover { background: var(--gf-surface-2); }
    label.layer span { display: grid; }
    label.layer small { color: var(--gf-text-muted); font-size: 0.8rem; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.85rem; padding: 0 4px; }
    .legend i { display: inline-block; vertical-align: -1px; margin-right: 6px; width: 11px; height: 11px; background: var(--c, var(--gf-text-muted)); border: 1px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 20%); }
    .legend i.round { border-radius: 50%; }
    .legend i.square { border-radius: 3px; }
    .sources { font-size: 0.8rem; color: var(--gf-text-muted); margin: 0 4px; }
    .sources a { color: inherit; }
    .catalog { display: grid; gap: 6px; }
    .catalog input[type=search] { width: 100%; box-sizing: border-box; }
    .catalog ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 40dvh; overflow-y: auto; }
    .catalog li { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: var(--gf-radius-sm); }
    .catalog li:hover { background: var(--gf-surface-2); }
    .catalog li span { display: grid; flex: 1; min-width: 0; }
    .catalog li small { color: var(--gf-text-muted); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .catalog li button { flex: none; }
  `];

  constructor() {
    super();
    this.base = 'photo';
    /** @type {string[]} */
    this.overlays = [];
    this.legend = false;
    /** @type {string | null} */
    this.distribution = null;
    this.distributionOn = false;
    /** IGN's whole catalogue: null (not asked), 'loading', an error message, or its layers. @type {null | 'loading' | string | import('../core/ign.js').CatalogLayer[]} */
    this._catalog = null;
    this._q = '';
  }

  async #loadCatalog() {
    this._catalog = 'loading';
    try { this._catalog = await ignCatalog(); } catch { this._catalog = 'Catalogue de l’IGN indisponible (hors ligne ?) — réessayez plus tard.'; }
  }

  /** IGN's whole catalogue: the layers added, and a search among all the others. */
  #catalog() {
    const c = this._catalog;
    const fold = (/** @type {string} */ t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = fold(this._q).split(/\s+/).filter(Boolean);
    const shown = Array.isArray(c) ? c.filter(l => !addedLayers().includes(IGN_PREFIX + l.id))
      .filter(l => words.every(w => fold(l.title + ' ' + l.id + ' ' + l.about).includes(w))) : [];
    return html`<div class="catalog">
      ${addedLayers().map(k => this.#layer(k))}
      ${c === null ? html`<button type="button" @click=${() => this.#loadCatalog()}>${icon('layers')} Ajouter une couche de l’IGN…</button>`
        : c === 'loading' ? html`<p class="note" role="status">Chargement du catalogue de l’IGN…</p>`
        : typeof c === 'string' ? html`<p class="note" role="status">${c}</p>`
        : html`<input type="search" placeholder=${'Chercher parmi ' + c.length + ' couches (relief, forêts, géologie…)'} aria-label="Chercher une couche de l’IGN"
            .value=${this._q} @input=${(/** @type {any} */ e) => { this._q = e.target.value; }} />
          <ul aria-label="Couches de l’IGN">${shown.slice(0, 60).map(l => html`<li>
            <span>${l.title}<small title=${l.about || l.id}>${l.about || l.id}</small></span>
            <button type="button" @click=${() => this.#emit('overlay-toggle', { key: IGN_PREFIX + l.id, on: true, layer: l })}>${icon('plus-lg')} Ajouter</button>
          </li>`)}</ul>
          ${shown.length > 60 ? html`<p class="note">${shown.length - 60} autres : précisez la recherche.</p>` : !shown.length ? html`<p class="note">Aucune couche ne correspond.</p>` : nothing}`}
    </div>`;
  }

  open() { openModal(/** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'))); }
  close() { /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'))?.close(); }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** @param {string} key */
  #layer(key) {
    const def = overlayDef(key);
    if (!def) return nothing;
    return html`<label class="layer">
      <input type="checkbox" .checked=${this.overlays.includes(key)}
        @change=${e => this.#emit('overlay-toggle', { key, on: e.target.checked })} />
      <span>${def.label}${def.hint ? html`<small>${def.hint}</small>` : nothing}</span>
    </label>`;
  }

  render() {
    const group = (/** @type {string} */ g) => Object.keys(OVERLAYS).filter(k => OVERLAYS[k].group === g);
    return html`
      <dialog aria-label="Carte" @click=${e => { if (e.target === e.currentTarget) this.close(); }}>
        <header>
          <h2>Carte</h2>
          <button class="icon-btn" type="button" aria-label="Fermer" @click=${() => this.close()}>${icon('x-lg')}</button>
        </header>
        <div class="body">
          <h3 class="kicker">Fond</h3>
          <div class="bases" role="group" aria-label="Fond de carte">
            ${Object.entries(BASES).map(([key, def]) => html`
              <button type="button" aria-pressed=${this.base === key ? 'true' : 'false'} @click=${() => this.#emit('base-change', { key })}>
                <span class="ico" aria-hidden="true">${icon(key === 'photo' ? 'globe-europe-africa' : 'map')}</span>${def.label}
              </button>`)}
          </div>

          ${this.distribution ? html`
            <h3 class="kicker">Répartition</h3>
            <label class="layer">
              <input type="checkbox" .checked=${this.distributionOn}
                @change=${e => this.#emit('distribution-toggle', { on: e.target.checked })} />
              <span>Répartition GBIF : ${this.distribution}<small>densité des occurrences connues</small></span>
            </label>` : nothing}

          <h3 class="kicker">Terrain</h3>
          ${group('terrain').map(k => this.#layer(k))}

          <h3 class="kicker">Toutes les couches de l’IGN</h3>
          <p class="note">Tout le catalogue de la Géoplateforme : relief, géologie, forêts, hydrographie, cartes anciennes…</p>
          ${this.#catalog()}

          <h3 class="kicker">Règles de cueillette</h3>
          <p class="note">Dans ces zones, la cueillette a souvent des règles propres : vérifiez-les avant de cueillir.</p>
          ${group('rules').map(k => this.#layer(k))}

          ${this.legend ? html`
            <h3 class="kicker">Légende</h3>
            <div class="legend">
              <span><i class="square"></i>Endroit</span>
              <span><i class="round"></i>Plante (en zoomant)</span>
              <span><i class="round" style="--c:${PIN_COLORS.rare}"></i>Rare</span>
              <span><i class="round" style="--c:${PIN_COLORS.moyen}"></i>Moyen</span>
              <span><i class="round" style="--c:${PIN_COLORS.abondant}"></i>Abondant</span>
            </div>` : nothing}

          <h3 class="kicker">Sources</h3>
          <p class="sources">
            Fonds, cadastre, courbes de niveau, adresses et altitudes : <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN – Géoplateforme</a>.
            Forêts publiques : ONF. Espaces protégés : <a href="https://inpn.mnhn.fr/" target="_blank" rel="noopener">INPN – PatriNat</a>.
            ${this.distribution ? html`Répartition : <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF.org</a>.` : nothing}
          </p>
        </div>
      </dialog>
    `;
  }
}

customElements.define('gf-map-panel', GfMapPanel);
