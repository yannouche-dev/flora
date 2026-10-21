// @ts-check
// « Créer une app » (#/builder[/<grille>][?g=<disposition>&<état>]): the one place where an app is made. It starts from
// a grid (gf-builder-grids.js: one column, three columns, a dashboard — of « Emplacements ») or a ready-made layout
// (presets.js); then the free layout itself, live (gf-layout.js in its « builder » mode: the real map, search, sheet…,
// wired through the same state), each cell with its tools: its content (✎, the block picker), its cross (cut in two
// towards a side, moved, taken out), the grips between cells. Around it: the screen's title, a preview as on a computer
// (the room there is) or on a phone (390 px wide: the layout's own tabs — never a scaled drawing, live maps break under
// transforms), what is wrong, « Ouvrir l'app » (#/layout/<the same layout>?<the same state>: a new entry; its
// « Emplacements » stay places to build in), the link to share (this builder's address: to go on building) and, folded, the layout as text (« Avancé »).
// The address keeps everything (g=: the layout, as #/layout writes it; then its state), each change replacing it.
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openView } from '../core/history.js';
import { share } from '../core/share.js';
import { ui } from '../styles/ui.js';
import { dirAt, parse, shares } from './grammar.js';
import { COMPONENTS } from './registry.js';
import { builderSpec, GRIDS } from './gf-builder-grids.js';
import { PRESETS } from './presets.js';
import './gf-layout.js';

/** The phone's width in the preview (px): the layout's own tabs show there. */
const PHONE = 390;

/**
 * A layout drawn small (the start's cards): its lists as flex boxes, the direction turning at each level
 * (grammar.js#dirAt), its shares; its cells as tinted boxes. @param {import('./grammar.js').LayoutNode} n @param {number} depth
 * @returns {import('lit').TemplateResult}
 */
function thumb(n, depth) {
  if (n.t === 'cell') return html`<i></i>`;
  const sh = shares(n);
  return html`<span class="g ${dirAt(depth)}">${n.kids.map((k, j) => html`<span class="g" style=${`flex: ${sh[j]} 1 0`}>${thumb(k, depth + 1)}</span>`)}</span>`;
}

export class GfBuilder extends LitElement {
  static properties = {
    /** The route: { name: 'builder', grid, spec, search } (router.js). */
    route: { attribute: false },
    /** The preview as on a phone (390 px wide). */
    _phone: { state: true },
    /** What the layout says of itself (gf-layout `layout-change`): its text, what is wrong, its app's address. */
    _said: { state: true },
    /** « Avancé »: the text as typed, unfolded. */
    _field: { state: true },
    _advanced: { state: true },
    /** « Titre » as typed. */
    _title: { state: true },
    _copied: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow: auto; background: var(--gf-bg); color: var(--gf-text); }
    .wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding: 16px 16px 32px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; }
    .wrap.building { max-width: none; padding-top: 10px; }
    /* The block picker open, docked on the right (wide): the builder beside it. */
    @media (min-width: 700px) { .wrap.building:has(gf-layout[picking]) { padding-right: calc(min(380px, 40%) + 16px); } }
    header h1 { margin: 0; font-size: 1.35rem; display: flex; align-items: center; gap: 8px; }
    header p { margin: 4px 0 0; color: var(--gf-text-muted); }
    h2 { margin: 0 0 8px; font-size: 1rem; }
    .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .choice { box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 12px; text-decoration: none; color: var(--gf-text);
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius-lg); background: var(--gf-surface); transition: border-color .15s; }
    .choice:hover { border-color: var(--gf-accent); }
    .choice:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .choice .thumb { aspect-ratio: 16 / 10; border-radius: var(--gf-radius-sm); background: var(--gf-bg); padding: 6px; box-sizing: border-box; display: flex; }
    .choice b { display: flex; align-items: center; gap: 6px; }
    .choice small { color: var(--gf-text-muted); line-height: 1.35; }
    .g { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 4px; }
    .g.row { flex-direction: row; } .g.col { flex-direction: column; }
    .g i { flex: 1; min-width: 0; min-height: 0; border-radius: 3px; background: color-mix(in srgb, var(--gf-accent) 22%, transparent); }
    /* Building: a bar of its own, then the layout, live. */
    .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .top h1 { font-size: 1.15rem; }
    .top .spacer { flex: 1; }
    .top .segmented button { display: inline-flex; align-items: center; gap: 6px; }
    .top > button, .top > a.btn { min-height: 36px; padding: 4px 14px; font-size: 0.88rem; }
    .top a.btn { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; color: var(--gf-text); text-decoration: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); }
    .top .icon-btn { width: 36px; height: 36px; font-size: 1rem; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
    .meta label { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; font-weight: 600; flex: 1 1 320px; }
    .meta input { flex: 1; min-height: 36px; padding: 6px 10px; font-size: 0.9rem; }
    .hint { margin: 0; font-size: 0.85rem; color: var(--gf-text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    ul.problems { margin: 0; padding: 8px 12px 8px 30px; font-size: 0.85rem; color: var(--gf-danger); border-radius: 10px; background: color-mix(in srgb, var(--gf-danger) 8%, var(--gf-surface)); }
    .stage { display: flex; flex-direction: column; height: clamp(460px, calc(100dvh - 260px), 1100px); border: 1px solid var(--gf-border); border-radius: 12px; overflow: hidden;
      background: var(--gf-surface); box-shadow: var(--gf-shadow-float, 0 8px 30px rgb(0 0 0 / .12)); }
    .stage.phone { width: ${PHONE}px; max-width: 100%; height: clamp(460px, calc(100dvh - 260px), 780px); align-self: center; border-radius: 22px; border-width: 6px; }
    .stage > gf-layout { flex: 1; min-height: 0; }
    details.advanced { display: grid; gap: 8px; }
    details.advanced > summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; min-height: 32px; display: inline-flex; align-items: center; }
    details.advanced[open] { display: grid; gap: 8px; }
    details.advanced label { font-size: 0.85rem; font-weight: 600; }
    details.advanced textarea { min-height: 72px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
    details.advanced .ok { margin: 0; font-size: 0.82rem; color: var(--gf-text-muted); }
    details.advanced .row { display: flex; flex-wrap: wrap; gap: 8px; }
    details.advanced .row button { min-height: 34px; padding: 4px 12px; font-size: 0.85rem; }
    details.advanced details { font-size: 0.82rem; color: var(--gf-text-muted); }
    details.advanced details code { color: var(--gf-text); }
    /* A phone: the preview is the screen itself. */
    @media (max-width: 699px) { .top .segmented { display: none; } .stage { height: calc(100dvh - 200px); min-height: 420px; } }
  `];

  constructor() {
    super();
    /** @type {{ name: string, grid?: string | null, spec?: string | null, search?: string } | undefined} */
    this.route = undefined;
    this._phone = false;
    /** @type {{ text: string, problems: string[], title: string | null, app: string | null }} */
    this._said = { text: '', problems: [], title: null, app: null };
    this._field = '';
    this._advanced = false;
    this._title = '';
    this._copied = false;
  }

  /**
   * The route the layout is given: made anew at each move of the address (a link, Back, Forward — router.js), never
   * at a mere render. Even to the layout and state it was last given: the layout replaces the address as it is built
   * (no route then), so Back may well return to them — and the layout then follows them again.
   */
  /** The layout being built (gf-builder-grids.js#builderSpec: g=, else the grid named; null: the start). @type {string | null} */
  #spec = null;
  #layoutRoute = { name: 'layout', spec: '', search: '' };

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route')) {
      this.#spec = builderSpec(this.route ?? {});
      this.#layoutRoute = { name: 'layout', spec: this.#spec ?? '', search: this.route?.search ?? '' };
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.title = 'Créer une app — GeoFlora';
  }

  /** @returns {any} the layout being built */
  get #layout() { return this.renderRoot.querySelector('gf-layout'); }

  /** What the layout says of itself: kept; the text and the title fields follow, unless they are being typed in. @param {CustomEvent} e */
  #heard(e) {
    this._said = e.detail;
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null;
    if (active?.id !== 'layout-text') this._field = e.detail.text;
    if (active?.id !== 'layout-title') this._title = e.detail.title ?? '';
    // A layout that cannot be read whole: its text unfolded, to be corrected.
    if (e.detail.problems.length && /\(caractère \d+\)$/.test(e.detail.problems[0])) this._advanced = true;
  }

  /** @type {any} */ #typing = 0;
  /** « Avancé » typed in: the layout follows once the keys rest. @param {string} text */
  #type(text) {
    this._field = text;
    clearTimeout(this.#typing);
    this.#typing = setTimeout(() => this.#layout?.setText(text), 300);
  }

  async #share() {
    const url = this.#layout?.address;
    if (!url) return;
    const r = await share({ title: (this._said.title ? this._said.title + ' · ' : '') + 'Créer une app — GeoFlora', url });
    if (r === 'copied') { this._copied = true; setTimeout(() => { this._copied = false; }, 2000); }
  }

  /** The start: a grid, or a ready-made layout, each drawn small. */
  #start() {
    return html`<div class="wrap">
      <header>
        <h1>${icon('window-desktop')} Créer une app</h1>
        <p>Une grille ou un modèle, puis un bloc dans chaque emplacement (carte, recherche, fiche, photos…) et ses réglages : votre écran, en direct, partageable par un lien.</p>
      </header>
      <section aria-labelledby="grids">
        <h2 id="grids">Partir d’une grille</h2>
        <div class="choices">${GRIDS.map(g => html`<a class="choice" href=${href.builder(g.spec)} data-grid=${g.id}>
          <span class="thumb" aria-hidden="true">${thumb(parse(g.spec).tree, 0)}</span><b>${icon(g.icon)} ${g.title}</b><small>${g.about}</small></a>`)}</div>
      </section>
      <section aria-labelledby="models">
        <h2 id="models">Ou d’un modèle</h2>
        <div class="choices">${PRESETS.map(p => html`<a class="choice" href=${href.builder(p.spec)} data-preset=${p.id}>
          <span class="thumb" aria-hidden="true">${thumb(parse(p.spec).tree, 0)}</span><b>${p.title}</b><small>${p.about}</small></a>`)}</div>
      </section>
    </div>`;
  }

  /** The layout being built, live, and what is around it. */
  #building() {
    const s = this._said;
    const textProblems = s.problems.filter(p => /\(caractère \d+\)$/.test(p));
    return html`<div class="wrap building">
      <div class="top">
        <h1>${icon('window-desktop')} Créer une app</h1>
        <a class="btn" href=${href.builder()} title="Partir d’une autre grille ou d’un autre modèle">${icon('arrow-counterclockwise')} Recommencer</a>
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Aperçu">
          <button type="button" data-preview="computer" aria-pressed=${this._phone ? 'false' : 'true'} @click=${() => { this._phone = false; }}>${icon('window-desktop')} Ordinateur</button>
          <button type="button" data-preview="phone" aria-pressed=${this._phone ? 'true' : 'false'} @click=${() => { this._phone = true; }}>${icon('phone')} Téléphone</button>
        </div>
        <button class="icon-btn" type="button" data-act="share" title=${this._copied ? 'Lien copié' : 'Partager ce lien (pour continuer à construire)'}
          aria-label=${this._copied ? 'Lien copié' : 'Partager le lien du constructeur'} @click=${() => this.#share()}>${icon(this._copied ? 'check-lg' : 'share')}</button>
        <button class="primary" type="button" data-act="open-app" ?disabled=${!s.app} title=${s.app ? 'Ouvrir l’app : cette disposition, telle quelle' : 'Corrigez d’abord la disposition'}
          @click=${() => { if (s.app) openView(s.app); }}>Ouvrir l’app ${icon('arrow-right')}</button>
      </div>
      <div class="meta">
        <label for="layout-title">Titre <input id="layout-title" type="text" maxlength="80" autocomplete="off" placeholder="Sans titre (par exemple : Orchidées de la colline de Mirabel)"
          .value=${this._title} @input=${(/** @type {any} */ e) => { this._title = e.target.value; this.#layout?.setTitle(e.target.value); }} /></label>
        <p class="hint">${icon('sliders')} choisit le bloc d’une case et le règle ; ${icon('tools')} la divise, la déplace ou la retire ; les poignées règlent les tailles.</p>
      </div>
      ${s.problems.length ? html`<ul class="problems" role="alert">${s.problems.map(p => html`<li>${p}</li>`)}</ul>` : nothing}
      <div class="stage ${this._phone ? 'phone' : ''}">
        <gf-layout mode="builder" .route=${this.#layoutRoute} @layout-change=${(/** @type {CustomEvent} */ e) => this.#heard(e)}></gf-layout>
      </div>
      <details class="advanced" ?open=${this._advanced} @toggle=${(/** @type {Event} */ e) => { this._advanced = /** @type {HTMLDetailsElement} */ (e.currentTarget).open; }}>
        <summary>Avancé : le texte de la disposition</summary>
        <label for="layout-text">La disposition (texte, comme dans l’adresse)</label>
        <textarea id="layout-text" spellcheck="false" autocomplete="off" .value=${this._field} @input=${(/** @type {any} */ e) => this.#type(e.target.value)}></textarea>
        ${textProblems.length ? nothing : html`<p class="ok" role="status">Aperçu en direct. Lue ainsi : <code>${s.text}</code></p>`}
        <div class="row"><button type="button" @click=${() => this.#layout?.resetSizes()}>${icon('arrows-collapse')} Tailles par défaut</button></div>
        <details><summary>Comment l’écrire</summary>
          <p><code>[a,b,c]</code> : trois colonnes ; <code>[a,[b,c]]</code> : la 2<sup>e</sup> colonne coupée en deux lignes ; un niveau de plus coupe une ligne en colonnes.
            <code>@30</code> après une cellule ou une liste : sa part en %. Paramètres entre parenthèses : <code>map(r=2km,base=plan)</code>, <code>results(grid)</code>, <code>search(filters=1)</code>,
            <code>media(mosaic)</code>, <code>plant(scientific)</code>. Un bloc de la fiche seul : <code>plant.wikipedia</code>, <code>plant.calendar</code>, <code>plant.uses</code>…
            Composants : ${COMPONENTS.map((c, i) => html`${i ? ', ' : ''}<code>${c.id}</code> (${c.title})`)}.</p>
        </details>
      </details>
    </div>`;
  }

  render() { return this.#spec == null ? this.#start() : this.#building(); }
}
customElements.define('gf-builder', GfBuilder);
