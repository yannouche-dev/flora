// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { lastSearchHash } from '../core/query.js';
import { setPlantView, setTarget, StoreController, whenReady } from '../core/store.js';
import { getMembership, setInCollection, toggleFavorite } from '../core/collections.js';
import { href } from '../core/router.js';
import { share } from '../core/share.js';
import * as sources from '../core/sources.js';
import './gf-attribution.js';
import './gf-plant-spots.js';
import './gf-calendar.js';
import './gf-status.js';
import './gf-add-to.js';
import { ui } from '../styles/ui.js';

/** Remote text is untrusted HTML: keep only its text content (DOMParser never runs scripts). */
function toText(/** @type {string} */ value) {
  const { body } = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  body.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  return body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

const truncate = (/** @type {string} */ text, max = 900) =>
  text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text;

const commonsKey = (/** @type {string | undefined} */ url) => {
  try { return decodeURIComponent(url || '').replace(/_/g, ' ').toLowerCase(); } catch { return url || ''; }
};

/**
 * Builds the gallery: the dataset thumbnail first, then free-licensed Commons images,
 * then the iNaturalist default photo; deduplicated by Commons page.
 */
function gallery(plant, details) {
  const images = [];
  const seen = new Set();
  const add = (/** @type {any} */ image) => {
    const key = commonsKey(image.sourceUrl || image.pageUrl || image.url);
    if (!image.url || seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };

  if (plant.thumbnail?.url) add(plant.thumbnail);
  for (const image of details?.commons || []) {
    add({ ...image, url: image.thumbnail || image.url, source: 'Wikimedia Commons' });
  }
  const inat = details?.identifiers?.inaturalist;
  if (inat?.photo?.url) {
    add({
      url: inat.photo.url,
      attribution: inat.photo.attribution,
      license: inat.photo.license,
      source: 'iNaturalist',
      sourceUrl: 'https://www.inaturalist.org/taxa/' + inat.id
    });
  }
  return images;
}

/** GBIF descriptions, French first, then English; one per type. */
function descriptions(details) {
  const rows = details?.gbif?.descriptions?.results || [];
  const order = { fra: 0, fre: 0, fr: 0, eng: 1, en: 1 };
  const byType = new Map();
  rows
    .filter(row => row.description && row.language in order)
    .sort((a, b) => order[a.language] - order[b.language])
    .forEach(row => {
      const type = row.type || 'description';
      if (!byType.has(type)) byType.set(type, { ...row, text: truncate(toText(row.description)) });
    });
  return [...byType.values()].filter(row => row.text).slice(0, 4);
}

function distributions(details) {
  const rows = details?.gbif?.distributions?.results || [];
  const seen = new Set();
  return rows
    .map(row => ({
      place: row.locality || row.country || row.locationId,
      means: row.establishmentMeans
    }))
    .filter(row => row.place && !seen.has(row.place) && seen.add(row.place))
    .slice(0, 24);
}

function gbifFrenchNames(plant, details) {
  const known = new Set((plant.vernacularNames || []).map(name => name.toLowerCase()));
  const names = (details?.gbif?.vernacularNames?.results || [])
    .filter(row => /^(fra|fre|fr)$/.test(row.language || ''))
    .map(row => row.vernacularName)
    .filter(name => name && !known.has(name.toLowerCase()) && known.add(name.toLowerCase()));
  return names.slice(0, 12);
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Baseflor flowering months, and whether this month is one of them. @param {any} plant */
function flowering(plant) {
  const [first, last] = plant.flowering || [];
  if (!first || !last) return null;
  const month = new Date().getMonth() + 1;
  const now = first <= last ? month >= first && month <= last : month >= first || month <= last;
  return { text: first === last ? MONTHS[first - 1] : MONTHS[first - 1] + ' → ' + MONTHS[last - 1], now };
}

const STATUS_TYPES = {
  PN: 'Protection nationale',
  PR: 'Protection régionale',
  PD: 'Protection départementale',
  REGL: 'Réglementation (cueillette, commerce)',
  LRN: 'Liste rouge nationale',
  LRR: 'Liste rouge régionale'
};

/** GBIF species media: still images under a free licence, credited. */
function gbifMedia(details) {
  const free = (/** @type {string} */ l) => /creativecommons\.org\/(licenses\/by(-sa)?\/|publicdomain)|^cc0|^cc[ -]by/i.test(l || '');
  return (details?.gbif?.media?.results || [])
    .filter(m => m.identifier && (!m.type || m.type === 'StillImage') && free(m.license))
    .slice(0, 12)
    .map(m => ({
      url: m.identifier,
      author: m.creator || m.rightsHolder || '',
      license: /publicdomain|cc0/i.test(m.license) ? 'CC0 / domaine public' : /by-sa/i.test(m.license) ? 'CC BY-SA' : 'CC BY',
      licenseUrl: /^https?:/.test(m.license) ? m.license : '',
      source: 'GBIF',
      sourceUrl: m.references || (details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : '')
    }));
}

/** Vernacular names in other languages (GBIF), grouped by language. */
function otherNames(details) {
  const byLang = new Map();
  for (const row of details?.gbif?.vernacularNames?.results || []) {
    const lang = row.language || '';
    if (!row.vernacularName || /^(fra|fre|fr)$/.test(lang)) continue;
    const list = byLang.get(lang) || [];
    if (!list.includes(row.vernacularName) && list.length < 4) list.push(row.vernacularName);
    byLang.set(lang, list);
  }
  return [...byLang].slice(0, 12);
}

/** Trefle species record (user's own token): its scalar facts, flattened. */
function trefleFacts(details) {
  const t = details?.trefle;
  if (!t) return [];
  const facts = [];
  const add = (/** @type {string} */ label, /** @type {any} */ value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('cm' in value || 'mm' in value) return add(label, value.cm != null ? value.cm + ' cm' : value.mm != null ? value.mm + ' mm' : null);
      for (const [k, v] of Object.entries(value)) add(label + ' · ' + k.replace(/_/g, ' '), v);
      return;
    }
    facts.push([label, Array.isArray(value) ? value.join(', ') : String(value)]);
  };
  add('common name', t.common_name);
  add('observations', t.observations);
  add('duration', t.duration);
  add('edible', t.edible);
  add('edible part', t.edible_part);
  add('vegetable', t.vegetable);
  for (const key of ['specifications', 'growth', 'flower', 'foliage', 'fruit_or_seed']) add(key.replace(/_/g, ' '), t[key]);
  return facts.slice(0, 60);
}

export class GfPlantDetail extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Shown in the Flore tab's plant pane: compact padding, the pane has its own close / back controls. */
    embedded: { type: Boolean, reflect: true },
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    _wiki: { state: true },
    _science: { state: true },
    _occurrences: { state: true },
    _spotsOpen: { state: true },
    _plant: { state: true },
    _details: { state: true },
    _error: { state: true },
    _shareNote: { state: true }
  };

  static styles = [ui, css`
    :host {
      display: block;
      overflow-y: auto;
      padding: 16px;
    }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 4px 14px 24px; }
    :host([embedded]) .back { display: none; }
    :host([embedded]) h1 { margin-top: 4px; }
    .back { font-size: 0.9rem; }
    h1 { margin: 8px 0 0; font-size: 1.6rem; line-height: 1.2; }
    .sci { font-family: var(--gf-font-serif); font-size: 1.2rem; }
    .sci i { font-style: italic; }
    .author { color: var(--gf-text-muted); font-size: 0.9em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; padding: 0; list-style: none; }
    .tags li {
      background: var(--gf-accent-soft);
      border-radius: var(--gf-radius-pill);
      padding: 2px 10px;
      font-size: 0.8rem;
    }
    section { margin-top: 24px; }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      font-weight: 600;
      margin: 0 0 8px;
    }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--gf-gap);
    }
    figure {
      margin: 0;
      background: var(--gf-surface);
      border-radius: var(--gf-radius);
      overflow: hidden;
      box-shadow: var(--gf-shadow);
    }
    figure img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      background: var(--gf-surface-2);
    }
    figcaption { padding: 6px 8px; }
    p { margin: 0 0 12px; }
    .actions { margin: 12px 0 4px; }
    .actions .fav { min-height: var(--gf-control-h); padding: 8px 16px; font-size: 0.9rem; }
    .actions .fav[aria-pressed='true'] { color: var(--gf-fav); border-color: var(--gf-fav); background: color-mix(in srgb, var(--gf-fav) 10%, var(--gf-surface)); }
    .share-note { color: var(--gf-text-muted); font-size: 0.85rem; margin: 4px 0 0; }
    .description { background: var(--gf-surface); border-radius: var(--gf-radius); padding: 12px 14px; margin-bottom: 8px; }
    .description small { display: block; color: var(--gf-text-muted); margin-bottom: 4px; }
    ul.inline { padding: 0; margin: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .links a {
      display: inline-block;
      color: var(--gf-accent);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius-pill);
      padding: 4px 12px;
      text-decoration: none;
      background: var(--gf-surface);
    }
    .links a:hover { background: var(--gf-surface-2); }
    .skeleton {
      height: 180px;
      border-radius: var(--gf-radius);
      background: linear-gradient(90deg, var(--gf-surface-2), var(--gf-surface), var(--gf-surface-2));
      background-size: 200% 100%;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { from { background-position: 100% 0; } to { background-position: -100% 0; } }

    /* Épuré: big photo, the essentials, one-tap add to the current collection. */
    .epure { max-width: 560px; }
    .hero { margin: 4px 0 12px; border-radius: var(--gf-radius-lg); overflow: hidden; background: var(--gf-surface-2); box-shadow: var(--gf-shadow); }
    .hero img, .hero .skeleton, .hero .no-photo { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; height: auto; border-radius: 0; }
    .hero .no-photo { display: grid; place-items: center; font-size: 3rem; }
    .hero figcaption { padding: 4px 10px; }
    .epure h1 { font-size: 1.8rem; }
    .meta { color: var(--gf-text-muted); margin: 6px 0 10px; }
    .season { background: var(--gf-season, var(--gf-accent-soft)); color: var(--gf-text); border-radius: var(--gf-radius-pill); padding: 1px 8px; font-size: 0.8rem; font-weight: 600; }
    .gate { display: grid; gap: 8px; margin: 16px 0 8px; }
    .gate .add { width: 100%; justify-content: center; }
    .gate .add[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); border: 2px solid var(--gf-accent); }
    .quick { display: flex; flex-wrap: wrap; gap: 8px; }
    .quick .fav[aria-pressed='true'] { color: var(--gf-fav); border-color: var(--gf-fav); }
    .more { margin-top: 18px; }

    /* Standard: collections as one discreet line. */
    .mine { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--gf-text-muted); margin: 4px 0; }

    /* Scientifique: facts as label / value rows, tables, sources. */
    h3 { font-size: 0.85rem; margin: 14px 0 6px; }
    .facts { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 6px 14px; margin: 0; font-size: 0.9rem; }
    .facts dt { color: var(--gf-text-muted); }
    .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .facts .lang { font-size: 0.75rem; font-weight: 700; color: var(--gf-text-muted); text-transform: uppercase; }
    .statuses { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 10px; }
    .statuses th, .statuses td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: top; }
    .statuses th { color: var(--gf-text-muted); font-weight: 600; }
    .science p.muted { font-size: 0.9rem; }
    .credit { font-size: 0.75rem; color: var(--gf-text-muted); margin: 8px 0 0; }
    .credit a { color: inherit; }
    .wiki p.credit { margin-top: 6px; }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {number} */
    this.plantId = 0;
    /** @type {any} */
    this._plant = undefined;
    /** @type {any} */
    this._details = undefined;
    /** @type {string | null} */
    this._error = null;
    /** @type {string | null} */
    this._shareNote = null;
    this.view = 'standard';
    /** @type {any} */ this._wiki = undefined;
    /** @type {any} */ this._science = undefined;
    /** @type {number | null | undefined} */ this._occurrences = undefined;
    this._spotsOpen = false;
  }

  /** @type {AbortController | null} */
  #abort = null;
  /** Extras already requested for the current plant. */
  #requested = new Set();

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plantId')) this.#load(this.plantId);
    else if (changed.has('view') && this._plant && this._details !== undefined) this.#loadExtras(this._plant, this._details, this.#abort?.signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
  }

  /** @param {number} id */
  async #load(id) {
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._plant = undefined;
    this._details = undefined;
    this._error = null;
    this._wiki = undefined;
    this._science = undefined;
    this._occurrences = undefined;
    this._spotsOpen = false;
    this.#requested.clear();
    this.scrollTop = 0;

    let plant;
    try {
      await whenReady();
      if (abort.signal.aborted) return;
      plant = await db.get('plants', id);
    } catch (error) {
      console.error(error);
      if (!abort.signal.aborted) this._plant = { failed: /** @type {Error} */ (error).message };
      return;
    }
    if (abort.signal.aborted) return;
    this._plant = plant || null;
    if (!plant) return;
    document.title = (plant.vernacularNames?.[0] || plant.scientificName) + ' — GeoFlora';

    try {
      const details = await sources.details(plant, abort.signal);
      if (!abort.signal.aborted) this._details = details;
      if (!abort.signal.aborted) this.#loadExtras(plant, details, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        this._details = null;
        this.#loadExtras(plant, null, abort.signal);
        this._error = navigator.onLine
          ? 'Les sources distantes ne répondent pas pour le moment.'
          : 'Hors ligne : les données distantes ne sont pas disponibles.';
      }
    }
  }

  /**
   * What the current view needs beyond the details: the Wikipedia summary (standard, scientific), and the
   * Wikidata classification, IUCN status and GBIF count in France (scientific). Each loads once per plant.
   * @param {any} plant @param {any} details @param {AbortSignal} [signal]
   */
  #loadExtras(plant, details, signal) {
    if (this.view === 'epure') return;
    const qid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    const settle = (/** @type {Promise<any>} */ task, /** @type {(v: any) => void} */ set) =>
      task.then(v => { if (!signal?.aborted && this._plant === plant) set(v ?? null); })
        .catch(() => { if (!signal?.aborted && this._plant === plant) set(null); });
    const once = (/** @type {string} */ key) => !this.#requested.has(key) && Boolean(this.#requested.add(key));
    if (once('wiki')) settle(sources.wikipedia(plant, qid, signal), v => { this._wiki = v; });
    if (this.view !== 'scientific') return;
    if (once('science')) settle(sources.wikidataScience(plant, qid, signal), v => { this._science = v; });
    const gbif = details?.identifiers?.gbif;
    if (once('occurrences')) settle(sources.occurrencesFR(plant, gbif?.nubKey ?? gbif?.id, signal), v => { this._occurrences = v; });
  }

  #store = new StoreController(this);

  /** @param {any} plant */
  #actions(plant) {
    const fav = this.#store.state.favorites.has(plant.id);
    const name = plant.vernacularNames?.[0] || plant.scientificName;
    return html`
      <div class="actions" role="group" aria-label="Actions">
        <button type="button" class="fav" aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant)}>
          ${fav ? '♥ Favori' : '♡ Favori'}
        </button>
        <button type="button" @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open()}>＋ Ajouter à…</button>
        <button type="button" @click=${() => this.#share(plant, name)}>Partager</button>
      </div>
      ${this._shareNote ? html`<p class="share-note" role="status">${this._shareNote}</p>` : nothing}`;
  }

  /** @param {any} plant @param {string} name */
  async #share(plant, name) {
    const result = await share({ title: name + ' — GeoFlora', text: `${name} (${plant.scientificName})`, url: href.plant(plant.id) });
    this._shareNote = result === 'copied' ? 'Lien copié.' : null;
    if (this._shareNote) setTimeout(() => { this._shareNote = null; }, 2500);
  }

  render() {
    const plant = this._plant;
    if (plant === undefined) return html`<article><div class="skeleton"></div></article>`;
    if (plant?.failed) {
      return html`<article>
        <a class="back link" href=${lastSearchHash()}>← Recherche</a>
        <h1>Impossible de lire la flore locale</h1>
        <p class="muted">${plant.failed}</p>
        <p><button class="primary" type="button" @click=${() => this.#load(this.plantId)}>Réessayer</button></p>
      </article>`;
    }
    if (plant === null) {
      return html`<article><a class="back link" href=${lastSearchHash()}>← Recherche</a><h1>Plante introuvable</h1></article>`;
    }

    const ctx = this.#context(plant);
    return this.view === 'epure' ? this.#epure(ctx) : this.view === 'scientific' ? this.#scientific(ctx) : this.#standard(ctx);
  }

  /** Everything the views share, computed once per render. @param {any} plant */
  #context(plant) {
    const details = this._details;
    const inat = details?.identifiers?.inaturalist;
    return {
      plant,
      details,
      loading: details === undefined,
      name: plant.vernacularNames?.[0] || plant.scientificName,
      // Photos en ligne switched off (Réglages › Modules): no remote image anywhere on the sheet.
      photosOff: !this.#store.state.modules.photos,
      images: this.#store.state.modules.photos ? gallery(plant, details) : [],
      inat,
      wikidata: plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id,
      links: sources.links(plant),
      status: plant.status?.france,
      bloom: flowering(plant)
    };
  }

  /** @param {any} ctx */
  #title({ plant, name }) {
    return html`
      <a class="back link" href=${lastSearchHash()}>← Recherche</a>
      <h1>${name}</h1>
      <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>`;
  }

  /** @param {any} ctx */
  #tags({ plant, status, inat }) {
    return html`<ul class="tags">
      <li>${plant.family}</li>
      <li>Genre <i>${plant.genus}</i></li>
      ${status ? html`<li title="Statut TAXREF ${status}">${STATUS_LABELS[status] || status}</li>` : nothing}
      ${inat?.observationsCount ? html`<li>${inat.observationsCount.toLocaleString('fr-FR')} observations iNaturalist</li>` : nothing}
    </ul>`;
  }

  /** @param {any} ctx @param {number} [max] */
  #gallery({ plant, images, loading, photosOff }, max = Infinity) {
    const shown = images.slice(0, max);
    return html`<section>
      <h2>Photos</h2>
      ${photosOff ? html`<p class="muted">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>` : shown.length ? html`
        <div class="gallery">
          ${shown.map(image => html`
            <figure>
              <a href=${image.sourceUrl || image.pageUrl || image.url} target="_blank" rel="noopener">
                <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              </a>
              <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
            </figure>`)}
        </div>` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`}
    </section>`;
  }

  #wikipedia() {
    const wiki = this._wiki;
    if (!wiki) return nothing;
    return html`<div class="description wiki">
      <small>Wikipédia</small>
      ${wiki.extract}
      <p class="credit"><a href=${wiki.url} target="_blank" rel="noopener">Lire l’article</a> · texte sous licence CC BY-SA 4.0</p>
    </div>`;
  }

  /** @param {any} ctx */
  #resources({ details, inat, wikidata, links }) {
    return html`<section class="links">
      <h2>Ressources</h2>
      <ul class="inline">
        ${links.inpn ? html`<li><a href=${links.inpn} target="_blank" rel="noopener">INPN</a></li>` : nothing}
        ${links.taxref ? html`<li><a href=${links.taxref} target="_blank" rel="noopener">TAXREF</a></li>` : nothing}
        <li><a href=${details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : links.gbif} target="_blank" rel="noopener">GBIF</a></li>
        <li><a href=${inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : links.inaturalist} target="_blank" rel="noopener">iNaturalist</a></li>
        <li><a href=${wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : links.wikidata} target="_blank" rel="noopener">Wikidata</a></li>
        <li><a href=${links.wikimedia} target="_blank" rel="noopener">Wikimedia Commons</a></li>
        ${this._wiki?.url || inat?.wikipediaUrl ? html`<li><a href=${this._wiki?.url || inat.wikipediaUrl} target="_blank" rel="noopener">Wikipédia</a></li>` : nothing}
      </ul>
    </section>`;
  }

  // ── Épuré: the plant at a glance, and one tap to put it in the current collection ──────────────────────

  /** @param {any} ctx */
  #epure(ctx) {
    const { plant, name, images, loading, bloom } = ctx;
    const hero = images[0];
    const { collections, target, favorites } = this.#store.state;
    const choices = collections.filter(c => c.kind !== 'favorites');
    const current = choices.find(c => c.id === target) || null;
    const inTarget = current ? (getMembership().byPlant.get(plant.id) || []).includes(current.id) : false;
    const fav = favorites.has(plant.id);
    const places = choices.filter(c => c.kind === 'place');
    const lists = choices.filter(c => c.kind !== 'place');
    return html`
      <article class="epure">
        <figure class="hero">
          ${hero ? html`<img src=${hero.url} alt=${plant.scientificName} decoding="async" referrerpolicy="no-referrer" />
            <figcaption><gf-attribution .media=${hero}></gf-attribution></figcaption>`
            : html`<div class=${loading && !ctx.photosOff ? 'skeleton' : 'no-photo'} aria-hidden="true">${loading && !ctx.photosOff ? '' : '🌿'}</div>`}
        </figure>
        <h1>${name}</h1>
        <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
        <p class="meta">${plant.family}${bloom ? html` · Floraison ${bloom.text}${bloom.now ? html` <span class="season">en fleur</span>` : nothing}` : nothing}</p>
        <gf-status .plant=${plant}></gf-status>

        <div class="gate" role="group" aria-label="Ajouter à la collection en cours">
          ${current ? html`
            <button class="primary large add" type="button" aria-pressed=${inTarget ? 'true' : 'false'}
              @click=${() => setInCollection(current.id, plant, !inTarget).then(() => setTarget(current.id)).catch(console.error)}>
              ${inTarget ? '✓ Dans ' : '＋ Ajouter à '}${current.kind === 'place' ? '📍 ' : ''}${current.name}
            </button>` : nothing}
          <select class="target" aria-label="Collection en cours" .value=${current?.id || ''}
            @change=${e => this.#pickTarget(e.target)}>
            <option value="" ?selected=${!current} disabled>${current ? 'Changer…' : 'Choisir où ajouter…'}</option>
            ${places.length ? html`<optgroup label="Mes lieux">${places.map(c => html`<option value=${c.id} ?selected=${c.id === current?.id}>📍 ${c.name}</option>`)}</optgroup>` : nothing}
            ${lists.length ? html`<optgroup label="Mes collections">${lists.map(c => html`<option value=${c.id} ?selected=${c.id === current?.id}>${c.name}</option>`)}</optgroup>` : nothing}
            <option value="__new">＋ Nouvelle collection…</option>
          </select>
        </div>
        <div class="quick" role="group" aria-label="Actions">
          <button type="button" class="fav" aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant)}>${fav ? '♥' : '♡'} Favori</button>
          <a class="button" href=${href.newSpot(plant.id)}>📍 Noter ici</a>
          <button type="button" @click=${() => this.#share(plant, name)}>Partager</button>
        </div>
        ${this._shareNote ? html`<p class="share-note" role="status">${this._shareNote}</p>` : nothing}
        <gf-add-to .plant=${plant}></gf-add-to>
        <p class="more"><button class="link" type="button" @click=${() => setPlantView('standard')}>Plus d’infos →</button></p>
      </article>`;
  }

  /** @param {HTMLSelectElement} select */
  #pickTarget(select) {
    const value = select.value;
    if (value === '__new') {
      select.value = this.#store.state.target || '';
      /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open();
      return;
    }
    if (value) setTarget(value);
  }

  // ── Standard: for everyone; collections stay discreet, the calendar comes first ─────────────────────────

  /** @param {any} ctx */
  #standard(ctx) {
    const { plant, details } = ctx;
    const fr = descriptions(details).find(row => /^(fra|fre|fr)$/.test(row.language || ''));
    const extraNames = gbifFrenchNames(plant, details);
    const count = (getMembership().byPlant.get(plant.id) || []).length;
    return html`
      <article>
        ${this.#title(ctx)}
        ${this.#actions(plant)}
        <gf-add-to .plant=${plant}></gf-add-to>
        <gf-status .plant=${plant}></gf-status>
        ${this.#tags(ctx)}

        <div class="mine">
          <span>${count ? `Dans ${count} de mes collections` : 'Dans aucune de mes collections'}</span>
          <button class="link" type="button" aria-expanded=${this._spotsOpen ? 'true' : 'false'}
            @click=${() => { this._spotsOpen = !this._spotsOpen; }}>${this._spotsOpen ? 'Masquer' : count ? 'Voir' : 'Lieux'}</button>
        </div>
        ${this._spotsOpen ? html`<section><gf-plant-spots plant-id=${plant.id}></gf-plant-spots></section>` : nothing}

        <section><gf-calendar .plant=${plant}></gf-calendar></section>
        ${this.#gallery(ctx, 6)}
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}

        ${this._wiki || fr ? html`<section>
          <h2>Description</h2>
          ${this._wiki ? this.#wikipedia() : html`<div class="description"><small>${fr.type || 'Description'} — GBIF</small>${fr.text}</div>`}
        </section>` : nothing}

        ${plant.vernacularNames?.length > 1 || extraNames.length ? html`
          <section>
            <h2>Noms français</h2>
            <p>${[...plant.vernacularNames, ...extraNames].join(' · ')}</p>
          </section>` : nothing}

        ${this.#resources(ctx)}
      </article>`;
  }

  // ── Scientifique: everything the app holds or can fetch, each with its source ───────────────────────────

  /** @param {any} ctx */
  #scientific(ctx) {
    const { plant, details, inat, wikidata, status } = ctx;
    const texts = descriptions(details);
    const places = distributions(details);
    const extraNames = gbifFrenchNames(plant, details);
    const foreign = otherNames(details);
    const media = ctx.photosOff ? [] : gbifMedia(details);
    const facts = trefleFacts(details);
    const sci = this._science;
    const claims = sci?.claims;
    const chain = [...(sci?.classification || [])].reverse();
    const gbif = details?.identifiers?.gbif;
    const statuses = [...(plant.statuses || [])].sort((a, b) =>
      Object.keys(STATUS_TYPES).indexOf(a.type) - Object.keys(STATUS_TYPES).indexOf(b.type) || String(a.area).localeCompare(String(b.area), 'fr'));
    const ids = [
      ['TAXREF (cd_nom)', plant.id, plant.links?.taxref],
      ['INPN', plant.id, plant.links?.inpn],
      ['GBIF', gbif?.id, gbif?.id ? 'https://www.gbif.org/species/' + gbif.id : null],
      ['iNaturalist', inat?.id, inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : null],
      ['Wikidata', wikidata, wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : null],
      ['Tela Botanica', claims?.tela, claims?.tela ? 'https://www.tela-botanica.org/bdtfx-nn-' + claims.tela : null],
      ['IPNI', claims?.ipni, claims?.ipni ? 'https://www.ipni.org/n/' + claims.ipni : null],
      ['POWO', claims?.powo, claims?.powo ? 'https://powo.science.kew.org/taxon/' + claims.powo : null],
      ['Trefle', details?.identifiers?.trefle?.id, details?.identifiers?.trefle?.slug ? 'https://trefle.io/species/' + details.identifiers.trefle.slug : null]
    ].filter(row => row[1]);
    const pending = html`<span class="muted">chargement…</span>`;

    return html`
      <article class="science">
        ${this.#title(ctx)}
        ${this.#actions(plant)}
        <gf-add-to .plant=${plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}

        <section>
          <h2>Taxonomie</h2>
          <dl class="facts">
            <dt>Classification</dt>
            <dd>${chain.length ? html`${chain.map(t => html`<span class="rank"><i>${t.name || t.label}</i></span> › `)}<i>${plant.scientificName}</i>`
              : sci === undefined && wikidata ? pending : html`${plant.family} › <i>${plant.genus}</i> › <i>${plant.scientificName}</i>`}</dd>
            <dt>Famille · genre · espèce</dt><dd>${plant.family} · <i>${plant.genus}</i> · <i>${plant.species}</i></dd>
            <dt>Auteur</dt><dd>${plant.author || '—'}</dd>
            <dt>Statut en France</dt><dd>${status ? `${STATUS_LABELS[status] || status} (TAXREF ${status})` : '—'}</dd>
            ${plant.synonyms?.length ? html`<dt>Synonymes (${plant.synonyms.length})</dt><dd class="sci-list"><i>${plant.synonyms.join(' · ')}</i></dd>` : nothing}
            <dt>Noms français</dt><dd>${[...(plant.vernacularNames || []), ...extraNames].join(' · ') || '—'}${inat?.commonName ? html` <span class="muted">(iNaturalist : ${inat.commonName})</span>` : nothing}</dd>
            ${foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd>${foreign.map(([lang, names]) => html`<span class="lang">${lang || '?'}</span> ${names.join(', ')} `)}</dd>` : nothing}
          </dl>
          <p class="credit">Sources : TAXREF v18 (PatriNat) · Wikidata (classification) · GBIF, iNaturalist (noms).</p>
        </section>

        <section>
          <h2>Statuts</h2>
          <dl class="facts">
            <dt>UICN (monde)</dt><dd>${sci?.iucn ? sci.iucn.label || sci.iucn.id : sci === undefined && wikidata ? pending : '—'}</dd>
          </dl>
          ${statuses.length ? html`<table class="statuses">
            <thead><tr><th>Type</th><th>Territoire</th><th>Statut</th></tr></thead>
            <tbody>${statuses.map(st => html`<tr><td>${STATUS_TYPES[st.type] || st.type}</td><td>${st.area}${st.level ? html` <span class="muted">(${st.level})</span>` : nothing}</td><td>${st.code && st.code !== st.label ? html`<b>${st.code}</b> ` : nothing}${st.label}</td></tr>`)}</tbody>
          </table>` : html`<p class="muted">Aucune protection, réglementation ni liste rouge connue (INPN).</p>`}
          <p class="credit">Sources : INPN – Base de connaissance Statuts (PatriNat) · Wikidata (UICN).</p>
        </section>

        <section><gf-calendar .plant=${plant}></gf-calendar></section>

        <section>
          <h2>Occurrences et répartition</h2>
          <dl class="facts">
            <dt>Observations iNaturalist</dt><dd>${inat?.observationsCount != null ? inat.observationsCount.toLocaleString('fr-FR') : '—'}</dd>
            <dt>Occurrences GBIF en France</dt><dd>${this._occurrences != null ? html`<a href=${'https://www.gbif.org/occurrence/search?country=FR&taxon_key=' + (gbif?.nubKey ?? gbif?.id)} target="_blank" rel="noopener">${this._occurrences.toLocaleString('fr-FR')}</a>` : this._occurrences === undefined && gbif ? pending : '—'}</dd>
          </dl>
          ${places.length ? html`<h3>Répartition (GBIF)</h3>
            <ul class="inline">${places.map(row => html`<li>${row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>` : nothing}
        </section>

        ${this._wiki || texts.length ? html`<section>
          <h2>Descriptions</h2>
          ${this.#wikipedia()}
          ${texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)}
        </section>` : nothing}

        ${this.#gallery(ctx)}
        ${media.length ? html`<section>
          <h2>Médias GBIF</h2>
          <div class="gallery">${media.map(image => html`<figure>
            <a href=${image.sourceUrl || image.url} target="_blank" rel="noopener"><img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>
            <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption></figure>`)}</div>
        </section>` : nothing}

        ${facts.length ? html`<section>
          <h2>Trefle</h2>
          <dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
          <p class="credit">Source : Trefle (données en anglais, avec votre jeton).</p>
        </section>` : nothing}

        <section>
          <h2>Identifiants</h2>
          <dl class="facts ids">${ids.map(([label, id, url]) => html`<dt>${label}</dt><dd>${url ? html`<a href=${url} target="_blank" rel="noopener">${id}</a>` : id}</dd>`)}</dl>
        </section>

        <section><gf-plant-spots plant-id=${plant.id}></gf-plant-spots></section>
        ${this.#resources(ctx)}
      </article>`;
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
