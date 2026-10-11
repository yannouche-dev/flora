// @ts-check
// « Parcours botanique » (a scenario of Découvrir): very simple, made for a walk. Start where you are (or in a
// commune): the parcours is a place of « Mes plantes ». Then name the plants you meet — typed or said — the flora
// suggests them, one touch adds each where you stand; the map of the parcours shows them as you go. A small card
// tells the parcours (its name, its plants, your position); « Terminer » closes it (it stays in Mes plantes).

import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../core/icons.js';
import { watchLocation } from '../core/geo.js';
import { searchPlaces } from '../core/geoservices.js';
import { findPlants } from '../core/search.js';
import { getPlace, newPlace, plantMarkers, savePlace, spotEvents, withPlant, withoutPlant, findEntry, refreshMembership } from '../core/collections.js';
import * as db from '../core/db.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import './gf-map.js';
import './gf-voice-button.js';

/** The parcours being walked (its place id), and those walked before. */
const KEY = 'geoflora.trail', LIST = 'geoflora.trails';
const read = (/** @type {string} */ k, /** @type {any} */ d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (/** @type {string} */ k, /** @type {any} */ v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

const dayName = () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeOf = (/** @type {string} */ iso) => { try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** Plants proposed at first, and added by each « Voir plus ». */
const STEP = 12;

export class GfTrail extends LitElement {
  static properties = {
    _trail: { state: true },
    _fix: { state: true },
    _geoError: { state: true },
    _q: { state: true },
    _hits: { state: true },
    _searching: { state: true },
    _view: { state: true },
    _toast: { state: true },
    _past: { state: true },
    _places: { state: true },
    _locating: { state: true },
    _shown: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; }
    /* Walking: the parcours' card on top (in both views), then the list or the map. */
    .wrap.on { grid-template-areas: "head" "tabs" "main"; grid-template-rows: auto auto minmax(0, 1fr); }
    .wrap.on .head { grid-area: head; padding: 14px 14px 0; max-width: 640px; width: 100%; margin: 0 auto; box-sizing: border-box; }
    .wrap.on .tabs { grid-area: tabs; }
    .wrap.on .col { grid-area: main; padding-top: 12px; }
    .wrap.on .mapcol { grid-area: main; }
    @container (min-width: 900px) {
      .wrap.on { height: 100%; grid-template-columns: minmax(360px, 520px) minmax(0, 1fr); grid-template-areas: "head map" "main map"; grid-template-rows: auto minmax(0, 1fr); }
      .wrap.on .mapcol { grid-area: map; }
      .wrap.on .col { overflow-y: auto; height: 100%; }
    }
    .col { padding: 14px 14px 90px; display: grid; align-content: start; gap: 12px; max-width: 640px; width: 100%; margin: 0 auto; box-sizing: border-box; }
    /* Starting: one action. */
    .start { text-align: center; gap: 14px; padding-top: 40px; }
    .start .big { font-size: 3rem; color: var(--gf-accent); margin: 0; }
    .start h1 { margin: 0; font-size: 1.6rem; line-height: 1.2; }
    .start p { margin: 0; color: var(--gf-text-muted); }
    .start .go { justify-self: center; min-height: 52px; padding: 12px 28px; font-size: 1.08rem; display: inline-flex; gap: 8px; align-items: center; }
    .start .or { font-size: 0.85rem; color: var(--gf-text-muted); }
    .commune { position: relative; text-align: left; }
    .commune input, .search input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text); }
    .commune input { padding: 10px 16px; }
    .places { list-style: none; margin: 4px 0 0; padding: 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .places button { width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: var(--gf-radius-sm); font: inherit; cursor: pointer; }
    .places button:hover { background: var(--gf-accent-soft); }
    .past { text-align: left; display: grid; gap: 6px; margin-top: 10px; }
    .past h2 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); }
    .past button { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font: inherit; cursor: pointer; }
    .past button small { color: var(--gf-text-muted); }
    /* Walking: the parcours' card, the search, the plants. */
    .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 12px 14px; border-radius: 16px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .card .pin { grid-row: span 2; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 1.1rem; }
    .card .title { display: flex; align-items: center; gap: 6px; min-width: 0; border-radius: 8px; padding: 2px 6px; margin-left: -6px; cursor: text; }
    .card .title:hover, .card .title:focus-within { background: var(--gf-surface-2); }
    .card .title:focus-within { box-shadow: inset 0 -2px 0 var(--gf-accent); }
    .card .name { flex: 1; min-width: 0; font: inherit; font-weight: 700; font-size: 1.05rem; border: 0; background: none; padding: 2px 0; color: var(--gf-text); outline: none; text-overflow: ellipsis; }
    .card .title .bi { color: var(--gf-text-muted); font-size: 0.85rem; flex: none; }
    .card .meta { grid-column: 2; font-size: 0.8rem; color: var(--gf-text-muted); display: flex; gap: 8px; flex-wrap: wrap; }
    .card .meta .gps.off { color: var(--gf-warn); }
    .card .end { grid-row: span 2; }
    .search { position: relative; }
    .search input { padding: 14px 92px 14px 46px; font-size: 1.1rem; box-shadow: var(--gf-shadow); }
    .search input:focus { border-color: var(--gf-accent); outline: none; box-shadow: var(--gf-focus); }
    .search .lens { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--gf-text-muted); font-size: 1.1rem; pointer-events: none; }
    .search .tools { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; align-items: center; }
    .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .hit { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 6px 6px 6px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .th { width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--gf-surface-2); display: grid; place-items: center; color: var(--gf-text-muted); }
    .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hit .t { display: grid; min-width: 0; line-height: 1.25; }
    .hit .t b { font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hit .t i { font-size: 0.82rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add { min-height: 44px; padding: 0 16px; border-radius: var(--gf-radius-pill); font-weight: 700; display: inline-flex; gap: 6px; align-items: center; font-size: 0.95rem; }
    .added { min-height: 44px; padding: 0 14px; display: inline-flex; gap: 6px; align-items: center; color: var(--gf-accent); font-weight: 600; font-size: 0.9rem; }
    .muted { color: var(--gf-text-muted); margin: 0; }
    .more { justify-self: center; }
    .tabs { display: none; }
    .list h2 { margin: 6px 2px 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: flex; justify-content: space-between; }
    .mine { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .mine li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 12px; background: var(--gf-surface); }
    .mine .th { width: 40px; height: 40px; }
    .mine a { color: inherit; text-decoration: none; min-width: 0; display: grid; }
    .mine a b { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine a i { font-size: 0.78rem; color: var(--gf-text-muted); }
    .mine small { color: var(--gf-text-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
    .mapcol { position: relative; min-height: 320px; border-left: 1px solid var(--gf-border); }
    .mapcol gf-map { position: absolute; inset: 0; display: block; }
    .toast { position: fixed; z-index: 1000; left: 12px; right: 12px; margin: 0 auto; width: fit-content; bottom: calc(80px + env(safe-area-inset-bottom)); display: flex; gap: 12px; align-items: center; padding: 10px 14px 10px 16px;
      border-radius: var(--gf-radius-pill); background: #1f2a1f; color: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font-size: 0.92rem; animation: up 0.25s ease-out; }
    .toast button { border: 0; background: none; color: #9be15d; font: inherit; font-weight: 700; cursor: pointer; padding: 4px; }
    @keyframes up { from { opacity: 0; transform: translateY(10px); } }
    /* A phone (or narrow): Liste | Carte. */
    @container (max-width: 899px) {
      .wrap.on .tabs { display: flex; position: sticky; top: 0; z-index: 3; justify-content: center; padding: 8px 14px; background: var(--gf-bg, var(--gf-surface-2)); }
      .wrap.on.v-map .col { display: none; }
      .wrap.on.v-list .mapcol { display: none; }
      .wrap.on.v-map .mapcol { height: max(320px, calc(100dvh - 300px)); border-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {any} */
    this._trail = null;
    /** @type {{ coordinates: [number, number], accuracy: number } | null} */
    this._fix = null;
    /** @type {string | null} */
    this._geoError = null;
    this._q = '';
    /** @type {any[]} */
    this._hits = [];
    this._searching = false;
    this._view = 'list';
    /** @type {{ text: string, undo?: () => void } | null} */
    this._toast = null;
    /** @type {any[]} */
    this._past = [];
    /** @type {any[]} */
    this._places = [];
    this._locating = false;
    /** How many of the hits are shown (« Voir plus » adds STEP). */
    this._shown = STEP;
  }

  /** @type {(() => void) | null} */ #stopGeo = null;
  #onSpots = () => this.#reload();

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpots);
    this.#reload();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpots);
    this.#stopGeo?.();
    this.#stopGeo = null;
  }

  /** The parcours walked (and those before), from Mes plantes. */
  async #reload() {
    const id = read(KEY, null);
    const trail = id ? await getPlace(id).catch(() => undefined) : undefined;
    this._trail = trail || null;
    if (!trail && id) write(KEY, null);
    const ids = /** @type {string[]} */ (read(LIST, []));
    this._past = (await Promise.all(ids.filter(x => x !== id).map(x => getPlace(x).catch(() => undefined)))).filter(Boolean).slice(0, 5);
    if (this._trail) this.#follow();
  }

  /** Where I am, followed while walking. */
  #follow() {
    if (this.#stopGeo) return;
    this.#stopGeo = watchLocation(s => {
      if (s.fix) { this._fix = { coordinates: s.fix.coordinates, accuracy: s.fix.accuracy }; this._geoError = null; }
      else if (s.error) this._geoError = s.error;
    });
  }

  /** « Commencer ici »: located, the parcours created there. */
  #startHere() {
    this._locating = true;
    this._geoError = null;
    const stop = watchLocation(s => {
      if (s.fix) { queueMicrotask(() => stop()); this._locating = false; this.#create(s.fix.coordinates, null); }
      else if (s.error) { queueMicrotask(() => stop()); this._locating = false; this._geoError = s.error + ' Choisissez plutôt une commune.'; }
    });
  }

  /** @param {[number, number]} at @param {string | null} where */
  async #create(at, where) {
    const place = newPlace(at, { name: 'Parcours du ' + dayName() + (where ? ' · ' + where : ''), notes: 'Parcours botanique' });
    await savePlace(place);
    write(KEY, place.id);
    write(LIST, [place.id, ...(/** @type {string[]} */ (read(LIST, []))).filter(x => x !== place.id)].slice(0, 20));
    await refreshMembership().catch(() => {});
    this._trail = place;
    this.#follow();
    await this.updateComplete;
    /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.search input'))?.focus();
  }

  /** @type {any} */ #placeTimer = 0;
  /** @param {string} text */
  #searchPlace(text) {
    clearTimeout(this.#placeTimer);
    this.#placeTimer = setTimeout(async () => { try { this._places = text.trim() ? await searchPlaces(text) : []; } catch { this._places = []; } }, 250);
  }

  /** @type {any} */ #findTimer = 0;
  /** The flora's plants for what is typed (or said), as it is typed. @param {string} text @param {boolean} [now] */
  #find(text, now = false) {
    this._q = text;
    clearTimeout(this.#findTimer);
    const run = async () => {
      const q = text.trim();
      if (!q) { this._hits = []; return; }
      this._searching = true;
      const hits = await findPlants(q).catch(() => []);
      if (this._q === text) { this._hits = hits; this.#hitsFor = text; this._shown = STEP; this._searching = false; }
      return hits;
    };
    if (now) return run();
    this.#findTimer = setTimeout(run, 160);
    return null;
  }

  /** The words the hits shown answer (Entrée never adds a plant found for fewer letters). */
  #hitsFor = '';

  /** Entrée: the first plant for what is typed now — searched at once when the hits are not yet for it. @param {string} text */
  async #addFirst(text) {
    const hits = this.#hitsFor === text ? this._hits : await this.#find(text, true);
    if (hits?.[0] && this._q === text) this.#add(hits[0]);
  }

  /** A plant added to the parcours, where I stand (else at the parcours' point). @param {any} hit */
  async #add(hit) {
    const trail = this._trail;
    if (!trail) return;
    const plant = await db.get('plants', hit.id).catch(() => null) || { id: hit.id, scientificName: hit.scientificName, vernacularName: hit.vernacularName };
    const position = this._fix ? { coordinates: this._fix.coordinates, accuracy: Math.round(this._fix.accuracy) } : undefined;
    const next = withPlant(trail, plant, position);
    await savePlace(next);
    this._trail = next;
    const name = hit.vernacularName || hit.scientificName;
    this.#say(`${name} ajoutée au parcours${position ? ', ici' : ''}`, async () => { const back = withoutPlant(/** @type {any} */ (this._trail), hit.id); await savePlace(back); this._trail = back; });
    // Ready for the next one.
    this._q = ''; this._hits = [];
    /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.search input'))?.focus();
  }

  /** @param {number} plantId */
  async #remove(plantId) {
    const next = withoutPlant(this._trail, plantId);
    await savePlace(next);
    this._trail = next;
  }

  /** @type {any} */ #toastTimer = 0;
  /** @param {string} text @param {() => void} [undo] */
  #say(text, undo) {
    clearTimeout(this.#toastTimer);
    this._toast = { text, undo };
    this.#toastTimer = setTimeout(() => { this._toast = null; }, 4500);
  }

  /** « Terminer »: the parcours stays in Mes plantes; another one can start. */
  #end() {
    write(KEY, null);
    this.#stopGeo?.(); this.#stopGeo = null;
    this._trail = null; this._q = ''; this._hits = [];
    this.#reload();
  }

  /** @param {any} place */
  #resume(place) {
    write(KEY, place.id);
    this._trail = place;
    this.#follow();
    this.#reload();
  }

  /** @param {string} name */
  async #rename(name) {
    const n = name.trim();
    if (!n || !this._trail || n === this._trail.properties.name) return;
    const next = { ...this._trail, properties: { ...this._trail.properties, name: n.slice(0, 80) } };
    await savePlace(next);
    this._trail = next;
  }

  render() {
    const t = this._trail;
    if (!t) return this.#starting();
    const plants = [...t.properties.plants].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    return html`<div class="wrap on v-${this._view}">
      <div class="head">${this.#card(t)}</div>
      <div class="tabs"><div class="segmented" role="group" aria-label="Affichage">
        ${[['list', 'Liste'], ['map', `Carte · ${plants.length}`]].map(([k, l]) => html`<button type="button" aria-pressed=${String(this._view === k)} @click=${() => { this._view = k; }}>${l}</button>`)}
      </div></div>
      <div class="col">
        <div class="search" role="search">
          <span class="lens" aria-hidden="true">${icon('search')}</span>
          <input type="search" enterkeyhint="search" autocomplete="off" placeholder="Quelle plante voyez-vous ?" aria-label="Nommer une plante (la flore propose)"
            .value=${this._q} @input=${(/** @type {any} */ e) => this.#find(e.target.value)}
            @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') { e.preventDefault(); this.#addFirst(/** @type {any} */ (e.target).value); } }} />
          <span class="tools">${this._q ? html`<button class="icon-btn" type="button" aria-label="Effacer" @click=${() => this.#find('', true)}>${icon('x-lg')}</button>` : nothing}
            <gf-voice-button @voice-text=${(/** @type {CustomEvent} */ e) => this.#find(e.detail.text, e.detail.final)}></gf-voice-button></span>
        </div>
        ${this._q ? this.#hitsView(t) : plants.length ? nothing : html`<p class="muted">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, un « Ajouter » la pose sur la carte, là où vous êtes.</p>`}
        ${plants.length ? html`<section class="list" aria-label="Les plantes du parcours">
          <h2><span>Le parcours</span><span>${plants.length} plante${plants.length > 1 ? 's' : ''}</span></h2>
          <ul class="mine">${repeat(plants, e => e.plantId, e => html`<li>
            <span class="th">${icon('flower1')}</span>
            <a href=${href.plant(e.plantId)}><b>${e.vernacularName || e.scientificName}</b>${e.vernacularName ? html`<i>${e.scientificName}</i>` : nothing}</a>
            <small>${timeOf(e.addedAt)}</small>
            <button class="icon-btn" type="button" aria-label=${'Retirer ' + (e.vernacularName || e.scientificName) + ' du parcours'} title="Retirer du parcours" @click=${() => this.#remove(e.plantId)}>${icon('x-lg')}</button>
          </li>`)}</ul>
        </section>` : nothing}
      </div>
      <div class="mapcol">${this.#map(t)}</div>
      ${this._toast ? html`<div class="toast" role="status">${icon('check-lg')} <span>${this._toast.text}</span>
        ${this._toast.undo ? html`<button type="button" @click=${() => { this._toast?.undo?.(); this._toast = null; }}>Annuler</button>` : nothing}</div>` : nothing}
    </div>`;
  }

  /** The parcours, small: its name (always editable), its plants, my position; « Terminer ». @param {any} t */
  #card(t) {
    const n = t.properties.plants.length;
    const gps = this._fix ? `Position ±${Math.round(this._fix.accuracy)} m` : this._geoError ? 'Position introuvable : les plantes vont au point du parcours' : 'Recherche de votre position…';
    return html`<div class="card" aria-label="Le parcours">
      <span class="pin" aria-hidden="true">${icon('geo-alt-fill')}</span>
      <label class="title" title="Renommer le parcours">
        <input class="name" .value=${t.properties.name} aria-label="Nom du parcours" maxlength="80" enterkeyhint="done" autocomplete="off"
          @keydown=${(/** @type {KeyboardEvent} */ e) => { const i = /** @type {HTMLInputElement} */ (e.target);
            if (e.key === 'Enter') i.blur();
            if (e.key === 'Escape') { i.value = t.properties.name; i.blur(); } }}
          @change=${(/** @type {any} */ e) => this.#rename(e.target.value)}
          @blur=${(/** @type {any} */ e) => { if (!e.target.value.trim()) e.target.value = t.properties.name; }} />
        ${icon('pencil')}
      </label>
      <button class="end secondary" type="button" @click=${() => this.#end()}>Terminer</button>
      <span class="meta"><span>${n} plante${n > 1 ? 's' : ''}</span><span class="gps ${this._fix ? '' : 'off'}">${gps}</span></span>
    </div>`;
  }

  /** The flora's suggestions: each with its photo, its names and a large « Ajouter ». @param {any} t */
  #hitsView(t) {
    if (!this._hits.length) return html`<p class="muted">${this._searching ? 'Recherche dans la flore…' : `Aucune plante de la flore pour « ${this._q} ».`}</p>`;
    const shown = this._hits.slice(0, this._shown);
    const more = this._hits.length - shown.length;
    return html`<ul class="hits" aria-label="Plantes proposées">${repeat(shown, h => h.id, h => {
      const there = Boolean(findEntry(t, h.id));
      return html`<li class="hit">
        <span class="th">${h.thumbnail?.url ? html`<img src=${h.thumbnail.url} alt="" loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />` : icon('flower1')}</span>
        <span class="t"><b>${h.vernacularName || h.scientificName}</b><i>${h.vernacularName ? h.scientificName + ' · ' : ''}${h.family || ''}</i></span>
        ${there ? html`<span class="added">${icon('check-lg')} Dans le parcours</span>`
          : html`<button class="primary add" type="button" @click=${() => this.#add(h)} aria-label=${'Ajouter ' + (h.vernacularName || h.scientificName) + ' au parcours'}>${icon('plus-lg')} Ajouter</button>`}
      </li>`;
    })}</ul>
    ${more > 0 ? html`<button class="more secondary" type="button" @click=${() => { this._shown += STEP; }}>Voir ${Math.min(more, STEP)} plante${Math.min(more, STEP) > 1 ? 's' : ''} de plus (${this._hits.length} en tout)</button>` : nothing}`;
  }

  /** The map of the parcours: its point, each plant where it was added; me, followed. @param {any} t */
  #map(t) {
    const markers = plantMarkers([t]);
    const frame = { key: 'trail:' + t.id + ':' + markers.length, maxZoom: 17, points: [t.geometry.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean) };
    return html`<gf-map no-search no-create .spots=${[t]} .plants=${markers} plant-zoom="0" .frame=${frame} track></gf-map>`;
  }

  /** No parcours yet: one action — start here (or in a commune); or take one up again. */
  #starting() {
    return html`<div class="wrap"><div class="col start">
      <p class="big" aria-hidden="true">${icon('geo-alt-fill')}</p>
      <h1>Votre parcours botanique</h1>
      <p>Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.</p>
      <button class="primary go" type="button" ?disabled=${this._locating} @click=${() => this.#startHere()}>${icon('geo-alt-fill')} ${this._locating ? 'Localisation…' : 'Commencer ici'}</button>
      ${this._geoError ? html`<p class="muted" role="alert">${this._geoError}</p>` : nothing}
      <span class="or">ou partir d’une commune</span>
      <div class="commune">
        <input type="search" placeholder="Une commune, un lieu-dit…" aria-label="Partir d’une commune" autocomplete="off" @input=${(/** @type {any} */ e) => this.#searchPlace(e.target.value)} />
        ${this._places.length ? html`<ul class="places" role="listbox" aria-label="Lieux">${this._places.map(p => html`<li><button type="button" role="option"
          @click=${() => { this._places = []; this.#create(p.coordinates, p.label); }}>${p.label} <small>${p.detail}</small></button></li>`)}</ul>` : nothing}
      </div>
      ${this._past.length ? html`<div class="past"><h2>Reprendre un parcours</h2>
        ${this._past.map(p => html`<button type="button" @click=${() => this.#resume(p)}><span>${p.properties.name}</span><small>${p.properties.plants.length} plante${p.properties.plants.length > 1 ? 's' : ''}</small></button>`)}</div>` : nothing}
    </div></div>`;
  }
}

customElements.define('gf-trail', GfTrail);
