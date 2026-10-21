// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { BASES, OVERLAYS, overlayDef } from '../core/ign.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import { sheetStyles } from './ui-kit.js';
import { icon } from '../core/icons.js';
import { openModal } from '../core/history.js';
import { mapSettings, mapSettingsEvents, setMapSettings } from '../core/map-settings.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { hasWebGL2 } from '../core/maplibre.js';
import { safeUrl } from '../core/safe-url.js';
import { sayIn } from '../core/toast.js';
import { map3dOptions, map3dOptionsCss, mapRendererChoice } from './map3d-options.js';
import './gf-ign-layers.js';

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/**
 * "Carte" panel: everything about how the map looks, in one bottom sheet — its display (2D or 3D, and the 3D
 * options: the maps' one choice, core/map-settings.js, the same as Réglages › Cartes — every map follows), background,
 * overlays (terrain, protected areas, and any layer of IGN's whole catalogue: gf-ign-layers.js, with the overlays
 * shown, their opacity and order), legend, sources. Every map has it (gf-map: its round button, or the end of its
 * search pill). It is also where a map's state is read (the quiet-map rule, gf-map.js): the « État » lines of
 * « Affichage » (why it is in 2D or flat, the IGN backgrounds off, a source unreachable, the protected areas in view),
 * the protected areas in view with their INPN pages under « Règles de cueillette », a page's own legend (a plant
 * sheet's sources and counts) — said by the map's own live region, or while the panel is open (a modal: that region
 * inert) by the panel's own (say). Events: base-change {key}, overlay-toggle {key, on, layer?} (`layer`: a catalogue layer to add), and
 * from gf-ign-layers overlay-opacity {key, opacity, commit}, overlay-order {keys}; the display is stored here
 * (setMapSettings).
 */
export class GfMapPanel extends LitElement {
  static properties = {
    base: { type: String },
    overlays: { attribute: false },
    /** The map's own opacity of its overlays (key → 0…1), when it has its own (a free layout's map); null: the device's. */
    opacities: { attribute: false },
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

  static styles = [ui, sheetStyles, map3dOptionsCss, css`
    .display { display: grid; gap: 6px; }

    dialog.drawer { --drawer-dim: 35%; }
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
    this.base = 'photo';
    /** @type {string[]} */
    this.overlays = [];
    /** @type {Record<string, number> | null} */
    this.opacities = null;
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

  connectedCallback() {
    super.connectedCallback();
    // The display's choice, changed here, in Réglages or another tab; a module that the 3D options depend on.
    mapSettingsEvents.addEventListener('change', this.#redraw);
    moduleEvents.addEventListener('change', this.#redraw);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    mapSettingsEvents.removeEventListener('change', this.#redraw);
    moduleEvents.removeEventListener('change', this.#redraw);
  }

  #redraw = () => this.requestUpdate();

  open() {
    // The catalogue shown before: asked again (online again, a month gone, the module switched…).
    /** @type {any} */ (this.renderRoot.querySelector('gf-ign-layers'))?.reopen();
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

  /**
   * « Affichage »: 2D or 3D — the maps' one choice (Réglages › Cartes are the same settings), so every map follows —
   * and, in 3D, its options (folded: the layers come next). A map always drawn one way says so, the choice disabled.
   */
  #display() {
    const s = mapSettings();
    const g = this.gl;
    const fixed = g?.fixed || null;
    const change = (/** @type {Partial<import('../core/map-settings.js').MapSettings>} */ patch) => setMapSettings(patch);
    return html`<h3 class="kicker">Affichage</h3>
      <div class="display">
        ${this.#state()}
        ${mapRendererChoice(s, change, { id: 'panel', legend: 'Carte en 2D ou en 3D', webgl: hasWebGL2(), fixed })}
        ${fixed || s.renderer !== '3d' ? nothing : html`<details class="more3d">
          <summary>Options de la 3D</summary>
          ${map3dOptions(s, change, { relief: moduleOn('relief3d'), ign: moduleOn('ignMaps'), id: 'panel3d' })}
        </details>`}
        <p class="note">Le même choix pour toutes les cartes ; par défaut dans <a href=${href.settings()}>Réglages › Cartes</a>.</p>
      </div>`;
  }

  /**
   * « État »: the map's state, one short line each (why it is in 2D or flat, the IGN backgrounds off, the protected
   * areas in view, a source unreachable…), with what to do when there is something. Said by the map's own live region
   * as it changes (gf-map) — while the panel is open, by its own region (say).
   */
  #state() {
    const lines = this.state || [];
    if (!lines.length) return nothing;
    const glyph = (/** @type {string} */ level) => icon(level === 'error' ? 'exclamation-triangle-fill' : level === 'warn' ? 'shield-check' : 'map');
    return html`<section class="state" aria-label="État de la carte"><b aria-hidden="true">État</b><ul>
      ${lines.map(l => html`<li class=${l.level} data-key=${l.key}>${glyph(l.level)}<span>${l.text}${l.link
        ? html` <a href=${l.link.href} @click=${() => this.close()}>${l.link.label}</a>` : nothing}</span></li>`)}
    </ul></section>`;
  }

  /** The protected areas in view: each named, its INPN page linked, its kind. */
  #areas() {
    const areas = this.areas || [];
    if (!areas.length) return nothing;
    return html`<ul class="areas" aria-label="Espaces protégés en vue">
      ${areas.map(a => html`<li>${safeUrl(a.url) ? html`<a href=${safeUrl(a.url)} target="_blank" rel="noopener">${a.name}</a>` : html`<b>${a.name}</b>`}
        <small>(${a.kind})</small></li>`)}
      <li><small>En vue sur la carte : la cueillette y est souvent interdite ou réglementée, vérifiez les règles du site.</small></li>
    </ul>`;
  }

  render() {
    const group = (/** @type {string} */ g) => Object.keys(OVERLAYS).filter(k => OVERLAYS[k].group === g);
    const lines = this.legendLines || [];
    return html`
      <dialog class="drawer centered" aria-label="Carte" @click=${e => { if (e.target === e.currentTarget) this.close(); }}>
        <header>
          <h2>Carte</h2>
          <button class="icon-btn" type="button" aria-label="Fermer" @click=${() => this.close()}>${icon('x-lg')}</button>
        </header>
        <div class="said visually-hidden" aria-live="polite" aria-relevant="additions"></div>
        <div class="body">
          ${this.#display()}
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
          <p class="note">Tout le catalogue de la Géoplateforme, rangé par thème : photos anciennes, forêts, espaces protégés, sols, relief, cartes anciennes…</p>
          <gf-ign-layers .overlays=${this.overlays} .opacities=${this.opacities}></gf-ign-layers>

          <h3 class="kicker">Règles de cueillette</h3>
          ${this.#areas()}
          <p class="note">Dans ces zones, la cueillette a souvent des règles propres : vérifiez-les avant de cueillir.</p>
          ${group('rules').map(k => this.#layer(k))}

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
