// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { BASES, OVERLAYS } from '../core/ign.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/**
 * "Carte" panel: everything about how the map looks, in one bottom sheet — background, overlays
 * (terrain, protected areas), legend, sources. Events: base-change {key}, overlay-toggle {key, on}.
 */
export class GfMapPanel extends LitElement {
  static properties = {
    base: { type: String },
    overlays: { attribute: false },
    legend: { type: Boolean }
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
  `];

  constructor() {
    super();
    this.base = 'photo';
    /** @type {string[]} */
    this.overlays = [];
    this.legend = false;
  }

  open() { /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'))?.showModal(); }
  close() { /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'))?.close(); }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** @param {string} key */
  #layer(key) {
    const def = OVERLAYS[key];
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

          <h3 class="kicker">Terrain</h3>
          ${group('terrain').map(k => this.#layer(k))}

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
          </p>
        </div>
      </dialog>
    `;
  }
}

customElements.define('gf-map-panel', GfMapPanel);
