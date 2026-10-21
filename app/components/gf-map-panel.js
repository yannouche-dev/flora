// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { ui } from '../styles/ui.js';
import { sheetStyles } from './ui-kit.js';
import { icon } from '../core/icons.js';
import { openModal } from '../core/history.js';
import { safeUrl } from '../core/safe-url.js';
import { sayIn } from '../core/toast.js';
import './gf-map-options.js';

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/**
 * The panel ▦ « Carte » of every map (gf-map: its round button, or the end of its search pill), in one bottom sheet:
 * the home of the maps' look — gf-map-options.js (scope="map": 2D or 3D and the 3D options, the background, IGN's
 * layers; the common settings, the same as Réglages › Cartes, or this map's own look, and the way back) —, and what only
 * this map has: its state, the GBIF distribution of the Carte's plant, the protected areas in view, its legend, its
 * sources. It is where a map's state is read (the quiet-map rule, gf-map.js): the « État » lines of « Affichage » (why
 * it is in 2D or flat, the IGN backgrounds off, a source unreachable, the protected areas in view), the protected areas
 * in view with their INPN pages under « Règles de cueillette », a page's own legend (a plant sheet's sources and
 * counts) — said by the map's own live region, or while the panel is open (a modal: that region inert) by the panel's
 * own (say). Events: distribution-toggle {on}, and gf-map-options' (look-edit, look-preview, look-common,
 * renderer-follow), for its map.
 */
export class GfMapPanel extends LitElement {
  static properties = {
    /** The look the map shows (gf-map lookShown) and what of it is its own (null: the common look). */
    look: { attribute: false },
    own: { attribute: false },
    /** Its 2D or 3D fixed by its owner, which « Suivre le réglage commun » lets go (gf-map own3d). */
    own3d: { attribute: false },
    /** Why its own look is its owner's to keep, said instead of the way back (gf-map lookWhy). */
    lookWhy: { attribute: false },
    /** Name of the plant whose GBIF distribution can be shown (null: none offered). */
    distribution: { attribute: false },
    distributionOn: { attribute: false },
    legend: { type: Boolean },
    /** What the colours of the page's own layers mean (gf-map setLegend: a plant sheet's map): { text, swatch? }[]. */
    legendLines: { attribute: false },
    /**
     * How the map is drawn (gf-map-gl.js): { on: in 3D (or loading), fixed: { renderer, why } when this map is always
     * drawn one way }; null: not known yet.
     */
    gl: { attribute: false },
    /**
     * The map's state (gf-map setStatus: why it is in 2D or flat, the IGN backgrounds off, a source unreachable, the
     * protected areas in view…): the « État » lines of « Affichage » — what the map never writes over itself.
     */
    state: { attribute: false },
    /** The protected areas in view (gf-map): under « Règles de cueillette », each with its INPN page. */
    areas: { attribute: false }
  };

  static styles = [ui, sheetStyles, css`
    dialog.drawer { --drawer-dim: 35%; }
    header { display: flex; align-items: center; padding: 10px 8px 6px 16px; border-bottom: 1px solid var(--gf-border); }
    header h2 { margin: 0; font-size: 1.1rem; flex: 1; }
    .body { overflow-y: auto; padding: 4px 16px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 4px; }
    h3 { margin: 14px 0 6px; }
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
    /* The map's state (« État »): one short line each, in « Affichage » — what the map no longer writes over itself. */
    .state { margin: 2px 0 4px; padding: 8px 10px; display: grid; gap: 4px; border-radius: var(--gf-radius-sm);
      background: var(--gf-surface-2); font-size: 0.82rem; }
    .state ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .state > b { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); }
    .state li { display: flex; gap: 6px; align-items: baseline; }
    .state li .bi { flex: none; color: var(--gf-text-muted); }
    .state li.warn .bi { color: #b45309; }
    .state li.error .bi { color: var(--gf-danger); }
    .state li a { color: var(--gf-accent); white-space: nowrap; }
    .areas { list-style: none; margin: 0 4px 6px; padding: 8px 10px; display: grid; gap: 4px; border-left: 4px solid #15803d;
      border-radius: var(--gf-radius-sm); background: var(--gf-surface-2); font-size: 0.85rem; }
    .areas a { color: var(--gf-accent); font-weight: 600; }
    .areas small { color: var(--gf-text-muted); }
    .legend i.obs { border: 0; background: radial-gradient(circle at 35% 30%, #ff6f9c, var(--gf-kin) 75%); box-shadow: 0 0 0 1.5px var(--gf-highlight); }
    .legend i.outline { background: transparent; border: 2px solid #a3e68a; box-shadow: 0 1px 0 rgb(0 0 0 / 30%); }
  `];

  constructor() {
    super();
    /** @type {import('../core/map-settings.js').MapLook | null} */
    this.look = null;
    /** @type {Partial<import('../core/map-settings.js').MapLook> | null} */
    this.own = null;
    this.own3d = false;
    this.lookWhy = '';
    this.legend = false;
    /** @type {string | null} */
    this.distribution = null;
    this.distributionOn = false;
    /** @type {any} */
    this.gl = null;
    /** @type {{ key: string, text: string, level: string, link: { href: string, label: string } | null }[]} */
    this.state = [];
    /** @type {import('../core/protected.js').ProtectedArea[]} */
    this.areas = [];
    /** @type {{ text: string, swatch?: string }[]} */
    this.legendLines = [];
  }

  open() {
    // The catalogue shown before: asked again (online again, a month gone, the module switched…).
    /** @type {any} */ (this.renderRoot.querySelector('gf-map-options'))?.reopen();
    openModal(/** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')));
  }

  close() { /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'))?.close(); }

  /**
   * Said while the panel is open (gf-map announce): the panel is a modal dialog, so the map's own live region, outside
   * it, is inert meanwhile — its words go to the panel's own region (polite, visually hidden). False when closed.
   * @param {string} text @returns {boolean}
   */
  say(text) {
    const dialog = /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog'));
    const live = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.said'));
    if (!dialog?.open || !live) return false;
    sayIn(live, text);
    return true;
  }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /**
   * « État »: the map's state, one short line each (why it is in 2D or flat, the IGN backgrounds off, the protected
   * areas in view, a source unreachable…), with what to do when there is something. Said by the map's own live region
   * as it changes (gf-map) — while the panel is open, by its own region (say).
   */
  #state() {
    const lines = this.state || [];
    if (!lines.length) return nothing;
    const glyph = (/** @type {string} */ level) => icon(level === 'error' ? 'exclamation-triangle-fill' : level === 'warn' ? 'shield-check' : 'map');
    return html`<section class="state" slot="state" aria-label="État de la carte"><b aria-hidden="true">État</b><ul>
      ${lines.map(l => html`<li class=${l.level} data-key=${l.key}>${glyph(l.level)}<span>${l.text}${l.link
        ? html` <a href=${l.link.href} @click=${() => this.close()}>${l.link.label}</a>` : nothing}</span></li>`)}
    </ul></section>`;
  }

  /** The protected areas in view: each named, its INPN page linked, its kind. */
  #areas() {
    const areas = this.areas || [];
    if (!areas.length) return nothing;
    return html`<ul class="areas" slot="rules" aria-label="Espaces protégés en vue">
      ${areas.map(a => html`<li>${safeUrl(a.url) ? html`<a href=${safeUrl(a.url)} target="_blank" rel="noopener">${a.name}</a>` : html`<b>${a.name}</b>`}
        <small>(${a.kind})</small></li>`)}
      <li><small>En vue sur la carte : la cueillette y est souvent interdite ou réglementée, vérifiez les règles du site.</small></li>
    </ul>`;
  }

  render() {
    const lines = this.legendLines || [];
    return html`
      <dialog class="drawer centered" aria-label="Carte" @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this.close(); }}>
        <header>
          <h2>Carte</h2>
          <button class="icon-btn" type="button" aria-label="Fermer" @click=${() => this.close()}>${icon('x-lg')}</button>
        </header>
        <div class="said visually-hidden" aria-live="polite" aria-relevant="additions"></div>
        <div class="body">
          <gf-map-options scope="map" .look=${this.look} .own=${this.own} .gl=${this.gl} .own3d=${Boolean(this.own3d)} .lookWhy=${this.lookWhy}>
            ${this.#state()}
            ${this.distribution ? html`<div slot="extra">
              <h3 class="kicker">Répartition</h3>
              <label class="layer">
                <input type="checkbox" .checked=${this.distributionOn}
                  @change=${(/** @type {any} */ e) => this.#emit('distribution-toggle', { on: e.target.checked })} />
                <span>Répartition GBIF : ${this.distribution}<small>densité des occurrences connues</small></span>
              </label></div>` : nothing}
            ${this.#areas()}
          </gf-map-options>

          ${this.legend || lines.length ? html`
            <h3 class="kicker">Légende</h3>
            ${lines.length ? html`<div class="legend page" role="list" aria-label="Les couches de cette carte">
              ${lines.map(l => html`<span role="listitem">${l.swatch ? html`<i class=${l.swatch === 'obs' || l.swatch === 'outline' ? 'round ' + l.swatch : 'round'}
                style=${l.swatch === 'obs' || l.swatch === 'outline' ? '' : `--c:${l.swatch}`}></i>` : nothing}${l.text}</span>`)}
            </div>` : nothing}
            ${this.legend ? html`<div class="legend">
              <span><i class="square"></i>Endroit</span>
              <span><i class="round"></i>Plante (en zoomant)</span>
              <span><i class="round" style="--c:${PIN_COLORS.rare}"></i>Rare</span>
              <span><i class="round" style="--c:${PIN_COLORS.moyen}"></i>Moyen</span>
              <span><i class="round" style="--c:${PIN_COLORS.abondant}"></i>Abondant</span>
            </div>` : nothing}` : nothing}

          <h3 class="kicker">Sources</h3>
          <p class="sources">
            Fonds, cadastre, courbes de niveau, adresses et altitudes : <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN – Géoplateforme</a>.
            ${this.gl?.on ? html`Bâtiments et plan vectoriel : IGN (BD TOPO). Relief 3D : <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (Mapzen, EU-DEM © Copernicus).` : nothing}
            Forêts publiques : ONF. Espaces protégés : <a href="https://inpn.mnhn.fr/" target="_blank" rel="noopener">INPN – PatriNat</a>.
            ${this.distribution ? html`Répartition : <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF.org</a>.` : nothing}
          </p>
        </div>
      </dialog>
    `;
  }
}

customElements.define('gf-map-panel', GfMapPanel);
