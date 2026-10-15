// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { DEFAULT_OPACITY, IGN_PREFIX, builtinKeyOf, overlayDef, overlayOpacity, wmtsUrl } from '../core/ign.js';
import { loadCatalog, onCatalog } from '../core/ign-catalog.js';
import { moduleOn } from '../core/modules.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { entriesOf, placeLabel, searchEntries, treeOf } from '../../lib/ign-classify.mjs';

/**
 * @typedef {import('../../lib/ign-catalog.mjs').CatalogLayer} CatalogLayer
 * @typedef {import('../../lib/ign-classify.mjs').Entry<CatalogLayer>} Entry
 * @typedef {ReturnType<typeof treeOf<Entry>>} Tree
 */

/** Rows shown at first in a sub-category, a search, the recommended ones; « Afficher plus » adds as many. */
const PAGE = 40;
const RESULTS = 50;
const RECOMMENDED = 8;

/** Where a preview tile is asked when the layer covers it (the forest of Fontainebleau: woods, heath, sand, rocks, protected areas). */
const PREVIEW_AT = /** @type {[number, number]} */ ([2.66, 48.4]);
/** A layer of an overseas territory (its title says which), seen there. @type {[RegExp, [number, number]][]} */
const OVERSEAS = [
  [/mayotte/i, [45.14, -12.8]], [/r[ée]union/i, [55.53, -21.13]], [/guadeloupe/i, [-61.55, 16.2]], [/martinique/i, [-61.02, 14.64]],
  [/guyane/i, [-52.95, 4.9]], [/cal[ée]donie|\bNCL?\b/i, [166.45, -22.27]], [/saint[- ]martin|irma|iles ?du ?nord/i, [-63.05, 18.07]],
  [/gen[eè]ve/i, [6.14, 46.2]], [/calvados/i, [-0.37, 49.18]], [/paris|roissy|versailles|marne/i, [2.35, 48.86]]
];

/** One tile of a layer, at a place it has data (its bounding box when known), at a zoom it draws. @param {CatalogLayer} l */
export function previewTile(l) {
  let [lon, lat] = PREVIEW_AT;
  const b = l.bbox;
  if (b && !(lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3])) [lon, lat] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  else if (!b) [lon, lat] = OVERSEAS.find(([re]) => re.test(`${l.title} ${l.variant || ''} ${l.id}`))?.[1] || PREVIEW_AT;
  const z = Math.max(l.minNative, Math.min(l.maxNative, 12));
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return wmtsUrl(l).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** « 1 couche », « 6 couches ». @param {number} n @param {string} word */
const count = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** A catalogue layer's overlay key: one of the app's own when it is one (« Forêts publiques »…), else « ign:<id> ». @param {CatalogLayer} l */
const keyOf = l => builtinKeyOf(l.id) || IGN_PREFIX + l.id;

/**
 * IGN's layers in the Carte panel (gf-map-panel.js), every map: the overlays shown (« Affichées », top first: opacity,
 * order, off), then the whole catalogue of the Géoplateforme (~700 layers, app/core/ign-catalog.js) to browse —
 * a search (accents ignored: title, description, keywords, category), « Recommandées pour la botanique », and the
 * taxonomy of lib/ign-classify.mjs as a tree of categories and sub-categories, each with its count, folded: a
 * sub-category's rows are only made when it is opened, 40 at a time. A series (one layer by year, département,
 * town…) is one row with a selector. Each row opens on its full description, zooms, source, legend and one preview
 * tile (asked only then, and never with the module « IGN – fonds de carte » off).
 * Events (bubbling out of the panel to its map, gf-map.js): overlay-toggle {key, on, layer?} (`layer`: a catalogue
 * layer to add), overlay-opacity {key, opacity, commit}, overlay-order {keys} (bottom first).
 */
export class GfIgnLayers extends LitElement {
  static properties = {
    /** The overlays shown, bottom first. */
    overlays: { attribute: false },
    /** The map's own opacity of its overlays (key → 0…1; the usual one when it says none); null: the device's. */
    opacities: { attribute: false },
    _catalog: { state: true },
    _open: { state: true },
    _q: { state: true },
    _nodes: { state: true },
    _details: { state: true },
    _variant: { state: true },
    _more: { state: true },
    _opacity: { state: true }
  };

  static styles = [ui, css`
    /* A grid item of the panel: never wider than it (a long option, an identifier). */
    :host { display: block; min-width: 0; }
    .catalog { display: grid; gap: 6px; }
    h4 { margin: 6px 0 2px; font-size: 0.8rem; font-weight: 600; color: var(--gf-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }

    /* Shown overlays. */
    .active li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 6px; padding: 6px 4px; border-radius: var(--gf-radius-sm); background: var(--gf-surface-2); }
    .active .name { display: grid; min-width: 0; font-size: 0.9rem; }
    .active .name small { color: var(--gf-text-muted); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .active .tools { display: flex; align-items: center; }
    .active .tools .icon-btn { width: 36px; height: 36px; font-size: 1rem; }
    .active .opacity { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .active .opacity input { flex: 1; min-width: 0; accent-color: var(--gf-accent); }
    .active .opacity output { min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; }

    /* The catalogue. */
    .state { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 2px 4px 4px; }
    .state .note { margin: 0; }
    .state button { min-height: 32px; padding: 2px 12px; font-size: 0.85rem; }
    input[type=search] { width: 100%; }
    details { border-radius: var(--gf-radius-sm); }
    summary { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 4px; cursor: pointer; border-radius: var(--gf-radius-sm); list-style: none; font-weight: 600; font-size: 0.95rem; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: ''; flex: none; width: 0.5em; height: 0.5em; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(-45deg); transition: transform 0.15s; margin: 0 4px; opacity: 0.6; }
    details[open] > summary::before { transform: rotate(45deg); }
    summary:hover { background: var(--gf-surface-2); }
    summary .count { margin-left: auto; font-weight: 500; font-size: 0.8rem; color: var(--gf-text-muted); background: var(--gf-surface-2); border-radius: var(--gf-radius-pill); padding: 1px 8px; }
    details details { margin-left: 12px; }
    details details summary { font-weight: 500; font-size: 0.9rem; min-height: 40px; }
    details > ul, details > .more { margin-left: 12px; }
    .reco > summary { color: var(--gf-accent); }

    /* A row: toggle, title and description, details. */
    li.row { padding: 4px 2px; border-radius: var(--gf-radius-sm); }
    li.row:hover { background: var(--gf-surface-2); }
    .line { display: flex; align-items: flex-start; gap: 8px; }
    .line input[type=checkbox] { flex: none; width: 20px; height: 20px; margin: 12px 4px 0; accent-color: var(--gf-accent); }
    .text { display: grid; flex: 1; min-width: 0; gap: 1px; padding: 8px 0 4px; }
    .text label { font-size: 0.92rem; line-height: 1.25; cursor: pointer; }
    .text small { color: var(--gf-text-muted); font-size: 0.78rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .text .where { -webkit-line-clamp: 1; font-style: italic; }
    .reco-mark { display: inline-flex; vertical-align: -0.1em; margin-left: 4px; color: var(--gf-accent); font-size: 0.85em; }
    .line .icon-btn { width: 40px; height: 40px; font-size: 1rem; flex: none; }
    .line .icon-btn[aria-expanded='true'] .bi { transform: rotate(180deg); }
    .variant { display: flex; align-items: center; gap: 6px; margin: 0 4px 4px 36px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .variant select { min-height: 36px; padding: 4px 8px; font-size: 0.85rem; width: 0; min-width: 0; flex: 1 1 0; }
    .details { margin: 2px 4px 8px 36px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; font-size: 0.82rem; }
    .details p { margin: 0; line-height: 1.4; }
    .details dl { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; }
    .details dt { color: var(--gf-text-muted); }
    .details dd { margin: 0; overflow-wrap: anywhere; }
    .details .pics { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
    .details figure { margin: 0; display: grid; gap: 2px; font-size: 0.72rem; color: var(--gf-text-muted); }
    .details .preview { width: 128px; height: 128px; border-radius: var(--gf-radius-sm); border: 1px solid var(--gf-border); background: repeating-conic-gradient(var(--gf-surface-2) 0 25%, var(--gf-surface) 0 50%) 0 0 / 16px 16px; object-fit: cover; }
    .details .legend { max-width: 100%; max-height: 220px; background: #fff; border-radius: var(--gf-radius-sm); }
    .more { justify-self: start; }
    @media (min-width: 700px) { .details { grid-template-columns: minmax(0, 1fr) auto; } .details .pics { grid-column: 2; grid-row: 1 / span 3; } }
  `];

  constructor() {
    super();
    /** @type {string[]} */
    this.overlays = [];
    /** The catalogue, as core/ign-catalog.js has it. @type {import('../core/ign-catalog.js').CatalogState | null} */
    this._catalog = null;
    /** « Parcourir… » touched: the catalogue is shown (and asked, the first time). */
    this._open = false;
    this._q = '';
    /** Folders open: 'reco', a category id, 'cat/sub'. @type {Set<string>} */
    this._nodes = new Set(['reco']);
    /** Rows with their details open. @type {Set<string>} */
    this._details = new Set();
    /** The variant chosen in each series' row (layer id). @type {Map<string, string>} */
    this._variant = new Map();
    /** How many rows each list shows beyond the first page. @type {Map<string, number>} */
    this._more = new Map();
    /** Opacities while a slider moves (key → 0…1). @type {Map<string, number>} */
    this._opacity = new Map();
    /** @type {Record<string, number> | null} */
    this.opacities = null;
    /** @type {(() => void) | null} */
    this._unsubscribe = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = onCatalog(state => { this._catalog = state; });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribe?.();
  }

  /** The panel opened again: the catalogue shown before is asked again (online again, a month gone, the module switched…). */
  reopen() { if (this._open) this.#load(); }

  /** Shows the catalogue; `retry` (« Réessayer »): the service asked now. @param {boolean} [retry] */
  #load(retry = false) {
    this._open = true;
    loadCatalog({ retry }).catch(error => console.warn('Catalogue IGN :', error));
  }

  /** The catalogue's rows and tree, made once per list (hundreds of layers). @type {WeakMap<CatalogLayer[], { entries: Entry[], tree: Tree, recommended: Entry[] }>} */
  #index = new WeakMap();

  /** @param {CatalogLayer[]} layers */
  #indexOf(layers) {
    let index = this.#index.get(layers);
    if (!index) {
      const entries = entriesOf(layers);
      index = { entries, tree: treeOf(entries), recommended: entries.filter(e => e.botany === 1) };
      this.#index.set(layers, index);
    }
    return index;
  }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  // ── Shown overlays ─────────────────────────────────────────────────────────

  /** The overlay's name (its catalogue layer's, else the app's). @param {string} key */
  #name(key) {
    const def = overlayDef(key);
    return def?.label || key.replace(IGN_PREFIX, '');
  }

  /** Moves a shown overlay up (toward the top) or down. @param {string} key @param {1 | -1} step */
  #move(key, step) {
    const keys = [...this.overlays];
    const i = keys.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    // The focus follows the overlay moved, once the map has the new order and its row is drawn elsewhere (updated()).
    this.#refocus = { key, step };
    this.#emit('overlay-order', { keys });
  }

  /** The overlay just moved, whose button gets the focus back. @type {{ key: string, step: number } | null} */
  #refocus = null;

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!changed.has('overlays') || !this.#refocus) return;
    const { key, step } = this.#refocus;
    this.#refocus = null;
    const button = /** @type {HTMLButtonElement | null} */ (this.renderRoot.querySelector(`[data-key="${CSS.escape(key)}"][data-step="${step}"]`));
    const other = /** @type {HTMLButtonElement | null} */ (this.renderRoot.querySelector(`[data-key="${CSS.escape(key)}"][data-step]:not([disabled])`));
    (button && !button.disabled ? button : other)?.focus();
  }

  /** @param {string} key @param {Event} e @param {boolean} commit */
  #opacityInput(key, e, commit) {
    const value = Number(/** @type {HTMLInputElement} */ (e.target).value) / 100;
    this._opacity = new Map(this._opacity).set(key, value);
    this.#emit('overlay-opacity', { key, opacity: value, commit });
    if (commit) { const next = new Map(this._opacity); next.delete(key); this._opacity = next; }
  }

  #active() {
    // Top first: the order they are drawn in, read from above.
    const keys = [...this.overlays].reverse();
    return html`<h4 id="active-title">Affichées${keys.length ? ` (${keys.length})` : ''}</h4>
      ${!keys.length ? html`<p class="note">Aucune couche par-dessus le fond : cochez-en une ci-dessous ou dans le catalogue.</p>`
        : html`<ul class="active" aria-labelledby="active-title">${keys.map((key, i) => {
          const name = this.#name(key);
          const pct = Math.round((this._opacity.get(key) ?? (this.opacities ? this.opacities[key] ?? DEFAULT_OPACITY : overlayOpacity(key))) * 100);
          return html`<li>
            <span class="name">${name}${keys.length > 1 ? html`<small>${i === 0 ? 'au-dessus' : i === keys.length - 1 ? 'au-dessous' : `${i + 1}ᵉ`}</small>` : nothing}</span>
            <span class="tools">
              ${keys.length > 1 ? html`
                <button class="icon-btn" type="button" data-key=${key} data-step="1" aria-label=${'Monter ' + name} ?disabled=${i === 0} @click=${() => this.#move(key, 1)}>${icon('caret-up-fill')}</button>
                <button class="icon-btn" type="button" data-key=${key} data-step="-1" aria-label=${'Descendre ' + name} ?disabled=${i === keys.length - 1} @click=${() => this.#move(key, -1)}>${icon('caret-down-fill')}</button>` : nothing}
              <button class="icon-btn" type="button" aria-label=${'Masquer ' + name} @click=${() => this.#emit('overlay-toggle', { key, on: false })}>${icon('x-lg')}</button>
            </span>
            <label class="opacity">Opacité
              <input type="range" min="0" max="100" step="5" .value=${String(pct)} aria-label=${'Opacité de ' + name} aria-valuetext=${pct + ' %'}
                @input=${(/** @type {Event} */ e) => this.#opacityInput(key, e, false)} @change=${(/** @type {Event} */ e) => this.#opacityInput(key, e, true)} />
              <output>${pct} %</output>
            </label>
          </li>`;
        })}</ul>`}`;
  }

  // ── The catalogue ──────────────────────────────────────────────────────────

  /** @param {import('../core/ign-catalog.js').CatalogState} c */
  #state(c) {
    const day = c.date ? new Date(c.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const kept = !c.layers ? '' : c.origin === 'bundled' ? (day ? `catalogue livré avec l’app (${day})` : 'catalogue livré avec l’app') : `catalogue gardé du ${day}`;
    const retry = html`<button type="button" @click=${() => this.#load(true)}>${icon('arrow-counterclockwise')} Réessayer</button>`;
    if (c.problem === 'module-off') {
      return html`<div class="state"><p class="note" role="status">Module « IGN – fonds de carte » désactivé : ${c.layers ? 'une couche ajoutée n’affichera que les zones déjà vues' : 'le catalogue n’est pas demandé'}.
        <a href=${href.settings()}>Réglages › Modules</a></p></div>`;
    }
    if (c.problem === 'offline') {
      return html`<div class="state"><p class="note" role="status">${c.layers ? `Hors ligne : ${kept}.` : 'Hors ligne : le catalogue de l’IGN n’est pas encore sur l’appareil.'}</p>${c.layers ? nothing : retry}</div>`;
    }
    if (c.problem === 'down') {
      return html`<div class="state"><p class="note" role="status">Le catalogue de l’IGN ne répond pas${c.reason ? ` (${c.reason})` : ''}${c.layers ? ` — ${kept}` : ''}.</p>${retry}</div>`;
    }
    if (c.refreshing || !c.layers) return html`<div class="state"><p class="note" role="status">${c.layers ? 'Mise à jour du catalogue de l’IGN…' : 'Chargement du catalogue de l’IGN…'}</p></div>`;
    return nothing;
  }

  /** @param {string} id @param {Event} e */
  #toggleNode(id, e) {
    const open = /** @type {HTMLDetailsElement} */ (e.currentTarget).open;
    if (open === this._nodes.has(id)) return;
    const next = new Set(this._nodes);
    if (open) next.add(id); else next.delete(id);
    this._nodes = next;
  }

  /** The layer a row stands for now: its series' variant shown, else the one chosen, else its first. @param {Entry} e */
  #current(e) {
    if (e.layers.length === 1) return e.layers[0];
    const on = e.layers.find(l => this.overlays.includes(keyOf(l)));
    if (on) return on;
    const chosen = this._variant.get(e.key);
    return e.layers.find(l => l.id === chosen) || e.layers[0];
  }

  /** @param {Entry} e @param {boolean} on */
  #toggle(e, on) {
    const l = this.#current(e);
    const key = keyOf(l);
    this.#emit('overlay-toggle', key.startsWith(IGN_PREFIX) ? { key, on, layer: l } : { key, on });
  }

  /** Another variant of a series: shown in place of the one shown, if any. @param {Entry} e @param {Event} ev */
  #choose(e, ev) {
    const id = /** @type {HTMLSelectElement} */ (ev.target).value;
    const before = this.#current(e);
    this._variant = new Map(this._variant).set(e.key, id);
    const next = e.layers.find(l => l.id === id);
    if (!next || next === before) return;
    if (this.overlays.includes(keyOf(before))) {
      this.#emit('overlay-toggle', { key: keyOf(before), on: false });
      const key = keyOf(next);
      this.#emit('overlay-toggle', key.startsWith(IGN_PREFIX) ? { key, on: true, layer: next } : { key, on: true });
    }
  }

  /** @param {string} key */
  #toggleDetails(key) {
    const next = new Set(this._details);
    if (next.has(key)) next.delete(key); else next.add(key);
    this._details = next;
  }

  /** What a series' selector is of. @param {Entry} e */
  #variantKind(e) {
    const v = e.layers.map(l => (l.variant || '').replace(/ \(copie \d+\)$/, ''));
    if (v.every(x => /^(Dernière édition|La plus récente|(?:[a-zéû]+ )?(?:18|19|20)\d{2}(?:-\d{2,4})?(?: révisée)?)$/.test(x))) return 'Année';
    if (v.some(x => / – /.test(x))) return 'Année et territoire';
    if (v.every(x => /\b(18|19|20)\d{2}\b/.test(x))) return 'Lieu et année';
    return 'Version';
  }

  /**
   * One row: a layer, or a series as one. `list`: the list it is in (a row can be in two: « Recommandées » and its
   * category), for unique ids. @param {Entry} e @param {string} list @param {boolean} [where] its category said
   */
  #row(e, list, where = false) {
    const l = this.#current(e);
    const on = this.overlays.includes(keyOf(l));
    const id = `r-${list}-${e.key}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const open = this._details.has(e.key);
    const kind = e.layers.length > 1 ? this.#variantKind(e) : '';
    const desc = (l.about || e.about || '').replace(/\s+/g, ' ');
    return html`<li class="row">
      <div class="line">
        <input type="checkbox" id=${id} .checked=${on} aria-describedby=${id + '-d'} @change=${(/** @type {any} */ ev) => this.#toggle(e, ev.target.checked)} />
        <span class="text">
          <label for=${id}>${e.title}${e.botany === 1 ? html`<span class="reco-mark" title="Recommandée pour la botanique">${icon('leaf-fill')}<span class="visually-hidden"> (recommandée pour la botanique)</span></span>` : nothing}</label>
          ${where ? html`<small class="where">${placeLabel(e.cat, e.sub)}</small>` : nothing}
          <small id=${id + '-d'}>${e.layers.length > 1 ? `${e.layers.length} versions` : ''}${e.layers.length > 1 && (!open || !desc) ? ' · ' : ''}${open && desc ? '' : desc || l.id}</small>
        </span>
        <button class="icon-btn" type="button" aria-expanded=${open ? 'true' : 'false'} aria-controls=${id + '-x'} aria-label=${'Détails : ' + e.title} @click=${() => this.#toggleDetails(e.key)}>${icon('chevron-down')}</button>
      </div>
      ${e.layers.length > 1 ? html`<label class="variant">${kind}
        <select aria-label=${kind + ' de ' + e.title} @change=${(/** @type {Event} */ ev) => this.#choose(e, ev)}>
          ${e.layers.map(v => html`<option value=${v.id} ?selected=${v === l}>${v.variant || v.title}</option>`)}
        </select></label>` : nothing}
      ${open ? this.#details(l, id + '-x') : nothing}
    </li>`;
  }

  /** A layer in full: description, zooms, source and licence, legend, a preview tile. @param {CatalogLayer} l @param {string} id */
  #details(l, id) {
    const net = moduleOn('ignMaps');
    return html`<div class="details" id=${id}>
      ${l.about ? html`<p>${l.about}</p>` : nothing}
      <dl>
        ${l.group ? html`<dt>Version</dt><dd>${l.variant || l.title}</dd>` : nothing}
        <dt>Titre IGN</dt><dd>${l.title}</dd>
        <dt>Zooms</dt><dd>${l.minNative} à ${l.maxNative} (au-delà, agrandie)</dd>
        <dt>Source</dt><dd>${l.source ? `${l.source}, via la Géoplateforme de l’IGN` : 'IGN – Géoplateforme'}</dd>
        <dt>Licence</dt><dd>données publiques, pour la plupart sous Licence Ouverte Etalab 2.0 : vérifiez la fiche du producteur</dd>
        <dt>Identifiant</dt><dd><code>${l.id}</code></dd>
        ${l.kw?.length ? html`<dt>Mots-clés</dt><dd>${l.kw.join(', ')}</dd>` : nothing}
        ${l.meta ? html`<dt>Fiche</dt><dd><a href=${l.meta} target="_blank" rel="noopener">métadonnées ${icon('box-arrow-up-right')}</a></dd>` : nothing}
      </dl>
      ${net ? html`<div class="pics">
        <figure><img class="preview" src=${previewTile(l)} alt=${'Aperçu : ' + (l.label || l.title)} width="128" height="128" loading="lazy" decoding="async" crossorigin="anonymous"
          @error=${(/** @type {any} */ ev) => { ev.target.closest('figure').hidden = true; }} /><figcaption>Aperçu (une tuile)</figcaption></figure>
        ${l.legend ? html`<figure><img class="legend" src=${l.legend} alt=${'Légende : ' + (l.label || l.title)} loading="lazy" decoding="async"
          @error=${(/** @type {any} */ ev) => { ev.target.closest('figure').hidden = true; }} /><figcaption>Légende</figcaption></figure>` : nothing}
      </div>` : html`<p class="note">Aperçu et légende avec le module « IGN – fonds de carte ».</p>`}
    </div>`;
  }

  /** Rows, a page at a time. @param {string} id @param {Entry[]} list @param {number} page @param {boolean} [where] */
  #rows(id, list, page, where = false) {
    const shown = page + (this._more.get(id) || 0);
    const rest = list.length - shown;
    return html`<ul>${list.slice(0, shown).map(e => this.#row(e, id, where))}</ul>
      ${rest > 0 ? html`<button class="small more" type="button" @click=${() => { this._more = new Map(this._more).set(id, (this._more.get(id) || 0) + PAGE); }}>Afficher ${Math.min(rest, PAGE)} de plus (${rest} en tout)</button>` : nothing}`;
  }

  /** @param {Tree} tree */
  #tree(tree) {
    return html`<div role="group" aria-label="Catégories de couches">${tree.map(c => html`
      <details ?open=${this._nodes.has(c.id)} @toggle=${(/** @type {Event} */ e) => this.#toggleNode(c.id, e)}>
        <summary>${c.label}<span class="count">${c.count}<span class="visually-hidden"> couches</span></span></summary>
        ${!this._nodes.has(c.id) ? nothing : c.subs.length === 1 ? this.#rows(c.id, c.subs[0].entries, PAGE) : c.subs.map(s => {
          const id = `${c.id}/${s.id}`;
          return html`<details ?open=${this._nodes.has(id)} @toggle=${(/** @type {Event} */ e) => this.#toggleNode(id, e)}>
            <summary>${s.label}<span class="count">${s.count}<span class="visually-hidden"> couches</span></span></summary>
            ${this._nodes.has(id) ? this.#rows(id, s.entries, PAGE) : nothing}
          </details>`;
        })}
      </details>`)}</div>`;
  }

  #catalog() {
    const c = this._catalog;
    if (!this._open || !c) {
      return html`<button type="button" class="browse" @click=${() => this.#load()}>${icon('layers')} Parcourir les couches de l’IGN…</button>`;
    }
    const layers = c.layers;
    if (!layers) return this.#state(c);
    const { entries, tree, recommended } = this.#indexOf(layers);
    const q = this._q.trim();
    const found = q ? searchEntries(entries, q) : [];
    return html`${this.#state(c)}
      <input type="search" placeholder=${`Chercher parmi ${count(layers.length, 'couche')} (forêt, sol, relief, 1950…)`} aria-label="Chercher une couche de l’IGN"
        .value=${this._q} @input=${(/** @type {any} */ e) => { this._q = e.target.value; this._more = new Map(); }} />
      <p class="note" role="status" aria-live="polite">${q ? (found.length ? count(found.length, 'résultat') : 'Aucune couche ne correspond.')
        : `${count(layers.length, 'couche')} en ${count(entries.length, 'entrée')}, rangées en ${count(tree.length, 'catégorie')}.`}</p>
      ${q ? html`<div class="results" aria-label="Résultats">${this.#rows('search', found, RESULTS, true)}</div>` : html`
        <details class="reco" ?open=${this._nodes.has('reco')} @toggle=${(/** @type {Event} */ e) => this.#toggleNode('reco', e)}>
          <summary>${icon('leaf-fill')} Recommandées pour la botanique<span class="count">${recommended.length}</span></summary>
          ${this._nodes.has('reco') ? this.#rows('reco', recommended, RECOMMENDED, true) : nothing}
        </details>
        ${this.#tree(tree)}`}`;
  }

  render() {
    return html`<div class="catalog">${this.#active()}<h4>Catalogue de la Géoplateforme</h4>${this.#catalog()}</div>`;
  }
}

customElements.define('gf-ign-layers', GfIgnLayers);
