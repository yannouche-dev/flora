// @ts-check
// How far to look, over the map of what was observed in the circle: a slider of distances (200 m to 50 km, what
// iNaturalist's search allows), its word for fun, how many observations — then « Qui pousse par ici ? » (on to the
// cards) or « Changer de lieu » (back to the start). The step « map » of Cueillette prudente and Mosaïque, and of
// Rencontres once its first steps are over (kit/ma-guided.js shows it otherwise).
// The card sits at the bottom of the map, in its middle; the circle stays still on the screen for the whole step —
// in the middle of the map's width, its centre a fifth of the map's height above the card (the card's real size
// measured), its lower part behind the card — and the map zooms under it as the distance changes, the place under
// its centre, while the observations of the new circle come (those shown meanwhile dimmed, the count saying it
// searches).
// The step « cards » keeps this same map beside the cards (the same element, the same Leaflet map: kit/around.js
// puts the cards in a column of their own): the card folds into a chip (« 1 km · Changer »), the circle in the middle
// of the room above it; the map lights the card on top (a soft ring), the plants passed (dimmed), the matches (a pink
// ring) and the plant chosen (Rencontres: the one whose photos show — its observations in the circle, large, on top;
// brighter while the photos' head is hovered). A match touched on the map is chosen. A phone: a band on top of the
// cards (a third of the height), folded to its chip at will.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../../core/icons.js';
import { moduleOn } from '../../core/modules.js';
import { observationsAround } from '../../core/nearby.js';
import { plantViewOf, StoreController } from '../../core/store.js';
import { PHONE_QUERY } from '../../core/media.js';
import { ui } from '../../styles/ui.js';
import { DISTANCES, distanceAt, distLabel, distMood, distWords, nameOf } from './cards.js';
import { sessionOf } from './session.js';
import '../../components/gf-map.js';

/** The stops labelled under the slider when it is narrow (all of them when there is room). */
const MAIN_STOPS = new Set([200, 1000, 5000, 50000]);

/** One element per value: a new one fades in as the value changes (lit's repeat, keyed by the value). @param {string} v @param {(v: string) => unknown} t */
const fresh = (v, t) => repeat([v], x => x, t);

/** A phone: the map a band over the cards (step « cards »). */
const PHONE = matchMedia(PHONE_QUERY);

export class MaDistance extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The app's context (the place, the distance). */
    c: { attribute: false },
    /** The list's own view, back to it as the cards come (Mosaïque: the grid). */
    view: {},
    /** The circle on the screen: its centre and radius, in px from the map's top left corner. */
    _ring: { state: true },
    /** The plant chosen's observations in the circle (Rencontres, step « cards »), for the map's highlight. */
    _hl: { state: true },
    /** A phone, step « cards »: the band folded to its chip. */
    _folded: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; overflow-x: hidden; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .welcome { max-width: 560px; margin: 0 auto; padding: 28px 20px 32px; display: grid; gap: 18px; text-align: center; box-sizing: border-box; }
    .welcome .leaf { font-size: 3rem; color: var(--gf-accent); }
    .welcome h1 { margin: 0; font-size: 1.7rem; line-height: 1.2; }
    .welcome p { margin: 0; color: var(--gf-text-muted); }
    .welcome .go { justify-self: center; font-size: 1.05rem; padding: 12px 26px; min-height: 48px; display: inline-flex; gap: 8px; align-items: center; }
    .skip { font-size: 0.85rem; }
    .dist { display: grid; gap: 4px; justify-items: center; }
    .dist .value { display: grid; height: 3.1rem; }
    .dist .value > *, .dist .moods > * { grid-area: 1 / 1; }
    .dist output { font-size: 2.4rem; line-height: 3.1rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; animation: ma-in 0.28s ease-out; }
    .dist .moods { display: grid; justify-items: center; }
    .dist .mood { color: var(--gf-text-muted); font-style: italic; animation: ma-in 0.32s ease-out; }
    .dist .obs { display: grid; justify-items: center; font-size: 0.8rem; color: var(--gf-text-muted); min-height: 1.3em; }
    .dist .obs > span { grid-area: 1 / 1; display: inline-flex; gap: 6px; align-items: center; animation: ma-fade 0.3s ease-out; }
    .dist .spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--gf-accent) 25%, transparent);
      border-top-color: var(--gf-accent); animation: ma-spin 0.8s linear infinite; }
    @keyframes ma-in { from { opacity: 0; transform: translateY(4px); } }
    @keyframes ma-fade { from { opacity: 0; } }
    @keyframes ma-spin { to { transform: rotate(360deg); } }

    /* The slider: its rail filled up to the thumb, a dot at each stop (the stops passed in the accent colour), the main
       ones labelled under it — all of them when there is room; the stop chosen in bold. The native input on top (its
       keys, its value read out), only its thumb drawn. --t: the thumb's width; --n: the stops but one; --p: where it is. */
    .range { --t: 24px; position: relative; width: min(100%, 420px); height: 52px; margin-top: 6px; }
    .range .rail { position: absolute; left: calc(var(--t) / 2 - 4px); right: calc(var(--t) / 2 - 4px); top: 10px; height: 6px; border-radius: 3px;
      background: linear-gradient(90deg, var(--gf-accent) calc(4px + (100% - 8px) * var(--p)), color-mix(in srgb, var(--gf-text-muted) 28%, transparent) 0); transition: background 0.2s; }
    .range .stop { position: absolute; top: 13px; left: calc(var(--t) / 2 + (100% - var(--t)) * var(--i) / var(--n)); width: 10px; height: 10px; margin: -5px 0 0 -5px;
      border-radius: 50%; box-sizing: border-box; background: var(--gf-surface); border: 2px solid color-mix(in srgb, var(--gf-text-muted) 45%, transparent);
      transition: background 0.2s, border-color 0.2s, scale 0.2s; pointer-events: none; }
    .range .stop.on { background: var(--gf-accent); border-color: var(--gf-surface); }
    .range .mark { position: absolute; top: 30px; left: calc(var(--t) / 2 + (100% - var(--t)) * var(--i) / var(--n)); translate: -50% 0; font-size: 0.72rem;
      color: var(--gf-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; transition: color 0.2s; pointer-events: none; }
    .range .mark.first { translate: calc(var(--t) / -2) 0; }
    .range .mark.last { translate: calc(-100% + var(--t) / 2) 0; }
    .range .mark.minor { display: none; }
    .range .mark.cur { color: var(--gf-accent); font-weight: 700; }
    @container (min-width: 600px) { .range .mark.minor { display: block; } }
    .range input { position: absolute; inset: 0 0 auto; width: 100%; height: 26px; margin: 0; padding: 0; border: 0; border-radius: 0; background: none; appearance: none; -webkit-appearance: none; cursor: pointer; }
    .range input:focus-visible { outline: none; box-shadow: none; border-color: transparent; }
    .range input::-webkit-slider-runnable-track { height: 26px; background: none; border: 0; }
    .range input::-moz-range-track { height: 26px; background: none; border: 0; }
    .range input::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: var(--t); height: var(--t); margin-top: 1px; border-radius: 50%;
      background: var(--gf-accent); border: 3px solid var(--gf-surface); box-sizing: border-box; box-shadow: 0 1px 4px rgb(0 0 0 / 35%); transition: scale 0.15s; }
    .range input::-moz-range-thumb { width: var(--t); height: var(--t); border-radius: 50%; background: var(--gf-accent); border: 3px solid var(--gf-surface);
      box-sizing: border-box; box-shadow: 0 1px 4px rgb(0 0 0 / 35%); }
    .range input:active::-webkit-slider-thumb { scale: 1.15; }
    .range input:focus-visible::-webkit-slider-thumb { box-shadow: var(--gf-focus); }
    .range input:focus-visible::-moz-range-thumb { box-shadow: var(--gf-focus); }

    .distance-wrap { position: relative; min-height: 100%; display: grid; }
    .distance-wrap gf-map { position: absolute; inset: 0; display: block; }
    /* Under the tiles, the colour of the aerial photo: a zoom out (a larger circle) shows no pale flash. */
    .distance-wrap gf-map .leaflet-container { background: #2f4a2c; }
    /* The card: at the bottom, in the middle of the map whatever its width. */
    .distance-wrap .welcome { position: relative; z-index: 1; align-self: end; justify-self: center; margin: auto auto 24px; width: min(560px, calc(100% - 24px)); padding: 18px 18px 16px;
      border-radius: 18px; background: color-mix(in srgb, var(--gf-surface) 92%, transparent); box-shadow: var(--gf-shadow-float); backdrop-filter: blur(6px); gap: 10px; }
    .distance-wrap .welcome .leaf { display: none; }
    .distance-wrap .welcome h1 { font-size: 1.35rem; }
    @container (max-width: 520px) {
      .distance-wrap .welcome { margin-bottom: 12px; padding: 14px 14px 12px; gap: 8px; }
      /* Two lines kept for the count: the card keeps its height (the circle above it does not move). */
      .dist .obs { min-height: 2.6em; align-content: start; }
    }
    /* Step « cards »: the map beside the cards, its distance a chip at the bottom. */
    :host([compact]) { overflow: hidden; }
    :host([compact]) .distance-wrap { height: 100%; min-height: 0; }
    .chipbar { position: relative; z-index: 1; align-self: end; justify-self: center; display: flex; gap: 6px; align-items: center; margin: 0 12px 40px; }
    .chipbar button { display: inline-flex; gap: 6px; align-items: center; min-height: 40px; padding: 6px 14px; border-radius: var(--gf-radius-pill); border: 0;
      background: color-mix(in srgb, var(--gf-surface) 94%, transparent); color: var(--gf-text); box-shadow: var(--gf-shadow-float); font: inherit; font-size: 0.9rem; cursor: pointer; }
    .chipbar button b { color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .chipbar .fold { padding: 6px 10px; }
    /* A phone: a band over the cards, a third of the height; folded, its chip alone. */
    :host([band]) { flex: none !important; height: 34dvh; border-bottom: 1px solid var(--gf-border); }
    :host([band][folded]) { height: auto; }
    :host([band][folded]) gf-map { display: none; }
    :host([band][folded]) .distance-wrap { position: static; }
    :host([band][folded]) .chipbar { margin: 6px auto; }
    /* The map's points, lit (gf-map area.marks): the card on top softly; the plants passed dimmed; the matches ringed
       in pink; the plant chosen's own (its highlight) brighter while its photos' head is hovered. */
    gf-map .gf-obs-leaf.gf-top .pop { box-shadow: 0 0 0 2px #fff, 0 0 0 5px #f5c542, 0 2px 8px rgb(0 0 0 / 40%); scale: 1.15; }
    gf-map .gf-obs-leaf.gf-passed:not(.gf-top) .pop { opacity: 0.35; filter: grayscale(0.7); }
    gf-map .gf-obs-leaf.gf-matched .pop { box-shadow: 0 0 0 2px #fff, 0 0 0 5px #e0245e, 0 2px 8px rgb(0 0 0 / 40%); }
    gf-map.glow .gf-obs-leaf.hl.chosen .pop { scale: 1.3; box-shadow: 0 0 0 3px #ffd166, 0 0 18px 6px rgb(255 209 102 / 85%), 0 5px 14px rgb(0 0 0 / 45%); }
    @media (prefers-reduced-motion: reduce) {
      .dist output, .dist .mood, .dist .obs > span, .dist .spin { animation: none; }
      .range .rail, .range .stop, .range .mark { transition: none; }
    }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {string | null} */
    this.view = null;
    /** @type {{ x: number, y: number, r: number } | null} */
    this._ring = null;
    /** @type {any} */
    this._hl = null;
    this._folded = false;
  }

  #store = new StoreController(this);

  #onChange = () => this.requestUpdate();
  /** @type {import('./session.js').AroundSession | null} */ #session = null;
  /** The card's size followed: the circle stays out from under it. */
  #measure = new ResizeObserver(() => this.#roomFor());

  connectedCallback() {
    super.connectedCallback();
    // The discovery screens: no zone alerts on their maps (gf-map).
    this.setAttribute('no-areas', '');
    PHONE.addEventListener('change', this.#onChange);
    this.#observe();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#measure.disconnect();
    PHONE.removeEventListener('change', this.#onChange);
    this.#session?.removeEventListener('change', this.#onChange);
    this.#session = null;
  }

  updated() { this.#observe(); }

  /** The card and the map's box observed (once each: they stay while the screen shows). */
  #observed = /** @type {Element[]} */ ([]);
  #observe() {
    const wrap = this.renderRoot.querySelector('.distance-wrap'), card = this.renderRoot.querySelector('.welcome, .chipbar');
    if (!wrap || !card || (this.#observed[0] === wrap && this.#observed[1] === card)) return;
    this.#measure.disconnect();
    this.#measure.observe(wrap);
    this.#measure.observe(card);
    this.#observed = [wrap, card];
    this.#roomFor();
  }

  /**
   * Where the circle stands: in the middle of the map's width, its centre a fifth of the map's height above the card's
   * top (a quarter of the height from the top at least); its radius 54 % of the map's height, at most 42 % of its width.
   * Step « cards » (the chip): in the middle of the room above the chip, as large as it fits there.
   */
  #roomFor() {
    const [wrap, card] = /** @type {HTMLElement[]} */ (this.#observed);
    if (!wrap || !card || !wrap.isConnected) return;
    const box = wrap.getBoundingClientRect(), top = card.getBoundingClientRect().top - box.top;
    if (!box.width || !box.height) return;
    const ring = this.#compact
      ? { x: Math.round(box.width / 2), y: Math.round(top / 2), r: Math.round(Math.max(24, Math.min(0.44 * top, 0.42 * box.width))) }
      : { x: Math.round(box.width / 2), y: Math.round(Math.max(0.25 * box.height, top - 0.2 * box.height)), r: Math.round(Math.min(0.54 * box.height, 0.42 * box.width)) };
    const was = this._ring;
    if (!was || Math.abs(was.x - ring.x) > 1 || Math.abs(was.y - ring.y) > 1 || Math.abs(was.r - ring.r) > 1) this._ring = ring;
  }

  /** Step « cards »: the map beside the cards, its distance a chip. */
  get #compact() { return Boolean(this.app && this.app.step.id !== 'map'); }

  willUpdate() {
    if (!this.app) return;
    const s = sessionOf(this.app);
    if (s !== this.#session) {
      this.#session?.removeEventListener('change', this.#onChange);
      this.#session = s;
      s.addEventListener('change', this.#onChange);
    }
    // The distance changed: the map's observations follow (a moment after the slider stops).
    s.watchPoints();
    const compact = this.#compact;
    if (compact !== this.hasAttribute('compact')) { this.toggleAttribute('compact', compact); queueMicrotask(() => this.#roomFor()); }
    this.toggleAttribute('band', compact && PHONE.matches);
    this.toggleAttribute('folded', compact && PHONE.matches && this._folded);
    this.#loadChosen();
  }

  /** The plant chosen (Rencontres: its photos shown), as a card of the game, or none. */
  get #chosen() {
    const id = this.#compact ? this.c?.media?.id : null;
    return id == null ? null : (this.#session?.cards || []).find(x => x.plant.id === id) ?? null;
  }

  /** The plant chosen's observations in the circle (iNaturalist, cached): its highlight on the map. */
  async #loadChosen() {
    const card = this.#chosen, c = this.c;
    const key = card?.taxonId && c?.point ? `${card.taxonId}:${c.radius}:${c.point}` : '';
    if (key === this.#hlFor) return;
    this.#hlFor = key;
    if (!key || !card || !c) { this._hl = null; return; }
    const photo = card.photo && moduleOn('photos', plantViewOf(this.#store.state)) ? card.photo.replace('/medium.', '/small.') : null;
    const pts = await observationsAround(/** @type {number} */ (card.taxonId), c.point, c.radius).catch(() => []);
    if (this.#hlFor !== key) return;
    const title = nameOf(card.plant);
    this._hl = { key, photo, credit: photo ? card.credit : null, common: card.plant.vernacularNames?.[0] || null, sci: card.plant.scientificName, taxonId: card.taxonId,
      points: pts.slice(0, 60).map(p => ({ coordinates: p.coordinates, title, url: p.url, date: p.date })) };
  }
  #hlFor = '';

  /** What the map lights (step « cards »): the card on top, the matches, the plants passed (by iNaturalist taxon). */
  #marks() {
    const s = this.#session, c = this.c;
    if (!this.#compact || !s?.cards || !c) return null;
    const taxa = (/** @type {number[]} */ ids) => s.cards?.filter(x => ids.includes(x.plant.id)).map(x => x.taxonId).filter(t => t != null) ?? [];
    const top = s.deck[0]?.taxonId ?? null;
    const key = `${top}|${c.matches.join()}|${c.passed.length}`;
    if (this.#marksMemo?.key === key) return this.#marksMemo;
    return (this.#marksMemo = { key, top, matched: taxa(c.matches), passed: taxa(c.passed) });
  }
  /** @type {any} */ #marksMemo = null;

  /** A point touched on the map (step « cards »): a match there is chosen (its photos shown). @param {CustomEvent} e */
  #onPick = e => {
    const t = e.detail?.point?.taxonId, s = this.#session, c = this.c;
    if (t == null || !s?.cards || !c) return;
    const card = s.cards.find(x => x.taxonId === t && c.matches.includes(x.plant.id));
    if (card) s.choose(card.plant.id);
  };

  /** The circle and its observations, the same object while they do not change (the map does not redraw them). */
  #area() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session), c = /** @type {Record<string, any>} */ (this.c);
    const a = this.#areaMemo, ring = this._ring, loading = s.obsLoading, marks = this.#marks();
    if (a && a.center === c.point && a.radius === c.radius && a.obs === s.obs && a.ring === ring && a.loading === loading && a.marks === marks) return a;
    // The circle still on the screen, the map zooming under it (smooth). The 100 latest, each its plant's photo
    // popping in (a small card of the plant on hover); kept in place as the distance changes.
    return (this.#areaMemo = { center: c.point, radius: c.radius, fit: true, leaves: true, smooth: true, ring, marks, points: s.obs, obs: s.obs, asking: true, loading });
  }
  /** @type {any} */ #areaMemo = null;

  /** How many observations: all of them, and how many are on the map; searching, said so. */
  #obsLine() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session);
    if (s.obsLoading) return 'Recherche des observations…';
    const n = s.obs.length, total = Math.max(s.obsTotal || 0, n);
    if (!n) return '';
    const fr = (/** @type {number} */ x) => x.toLocaleString('fr-FR');
    return `${fr(total)} observation${total > 1 ? 's' : ''} de plantes${total > n ? ` — les ${fr(n)} plus récentes sur la carte` : ' sur la carte'}`;
  }

  /** « Qui pousse par ici ? »: the cards, searched anew, in the list's own view. */
  #go() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session);
    s.invalidate();
    s.setView(this.view);
    this.app?.go('cards');
  }

  /** The slider of the distances: its stops, the main ones labelled. @param {number} radius */
  #range(radius) {
    const app = /** @type {import('../runtime.js').MiniApp} */ (this.app), at = distanceAt(radius), n = DISTANCES.length - 1;
    return html`<div class="range" style="--n:${n};--p:${at / n}">
      <div class="rail" aria-hidden="true"></div>
      ${DISTANCES.map((d, i) => html`<span class="stop ${i <= at ? 'on' : ''}" style="--i:${i}" aria-hidden="true"></span>`)}
      ${DISTANCES.map((d, i) => html`<span class="mark ${MAIN_STOPS.has(d) ? '' : 'minor'} ${i === 0 ? 'first' : i === n ? 'last' : ''} ${i === at ? 'cur' : ''}"
        style="--i:${i}" aria-hidden="true">${distLabel(d)}</span>`)}
      <input type="range" min="0" max=${n} step="1" .value=${String(at)} aria-label="Distance de la recherche"
        aria-valuetext=${distWords(radius)} @input=${(/** @type {any} */ e) => app.set({ radius: DISTANCES[Number(e.target.value)] })} />
    </div>`;
  }

  /** Step « cards »: the distance as a chip (back to the step « map »), and on a phone the band's fold. */
  #chip() {
    const app = /** @type {import('../runtime.js').MiniApp} */ (this.app), c = /** @type {Record<string, any>} */ (this.c);
    return html`<div class="chipbar">
      <button type="button" class="dist-chip" aria-label=${`Distance : ${distWords(c.radius)} autour ${c.place ? 'de ' + c.place : 'de vous'}. Changer`}
        @click=${() => app.go('map')}>${icon('geo-alt')} <b>${distLabel(c.radius)}</b> · Changer</button>
      ${this.hasAttribute('band') ? html`<button type="button" class="fold" aria-expanded=${String(!this._folded)} aria-label=${this._folded ? 'Montrer la carte' : 'Replier la carte'}
        title=${this._folded ? 'Montrer la carte' : 'Replier la carte'} @click=${() => { this._folded = !this._folded; }}>${icon(this._folded ? 'chevron-down' : 'chevron-up')}</button>` : nothing}
    </div>`;
  }

  /** Step « map »: the card — how far, the slider, the count, « Qui pousse par ici ? », « Changer de lieu ». */
  #card() {
    const app = /** @type {import('../runtime.js').MiniApp} */ (this.app), c = /** @type {Record<string, any>} */ (this.c);
    const line = this.#obsLine(), waiting = Boolean(this.#session?.obsLoading);
    return html`<section class="welcome distance">
      <div class="leaf" aria-hidden="true">${icon('geo-alt-fill')}</div>
      <h1>Jusqu’où part l’expédition ?</h1>
      <p>Autour ${c.place ? 'de ' + c.place : 'de vous'}. Plus le cercle est grand, plus la récolte de rencontres est riche — et plus il faudra marcher pour aller les saluer.</p>
      <div class="dist">
        <div class="value">${fresh(distLabel(c.radius), v => html`<output>${v}</output>`)}</div>
        <div class="moods">${fresh(distMood(c.radius), v => html`<span class="mood">${v}</span>`)}</div>
        ${this.#range(c.radius)}
        <span class="obs" aria-live="polite" aria-busy=${waiting ? 'true' : 'false'}>${line ? fresh(line, v => html`<span>${waiting ? html`<i class="spin" aria-hidden="true"></i>` : ''}${v}</span>`) : ''}</span>
      </div>
      <button class="primary go" type="button" @click=${() => this.#go()}>${icon('binoculars')} Qui pousse par ici ?</button>
      <button class="link skip" type="button" @click=${() => app.go('start')}>Changer de lieu</button>
    </section>`;
  }

  render() {
    const app = this.app, c = this.c;
    if (!app || !c || !this.#session || !c.point) return html``;
    const compact = this.#compact;
    // The card (or the chip) first: the keyboard reaches the slider before the map's points; drawn over the map. One
    // template for both steps: the map stays the same element (the same Leaflet map) from one to the other.
    return html`<div class="distance-wrap">${compact ? this.#chip() : this.#card()}
      <gf-map class=${compact && this.#session.chosenGlow ? 'glow' : ''} no-search no-create no-locate .area=${this.#area()} .highlight=${compact ? this._hl : null}
        point-click=${compact ? 'pick' : 'none'} @point-pick=${this.#onPick}></gf-map></div>`;
  }
}

customElements.define('ma-distance', MaDistance);
