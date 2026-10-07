// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { lastSearchHash } from '../core/query.js';
import { StoreController, whenReady } from '../core/store.js';
import { toggleFavorite } from '../core/collections.js';
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

export class GfPlantDetail extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Shown in the Flore tab's plant pane: compact padding, the pane has its own close / back controls. */
    embedded: { type: Boolean, reflect: true },
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
  }

  /** @type {AbortController | null} */
  #abort = null;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plantId')) this.#load(this.plantId);
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
    } catch (error) {
      if (!abort.signal.aborted) {
        this._details = null;
        this._error = navigator.onLine
          ? 'Les sources distantes ne répondent pas pour le moment.'
          : 'Hors ligne : les données distantes ne sont pas disponibles.';
      }
    }
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

    const details = this._details;
    const loading = details === undefined;
    const images = gallery(plant, details);
    const texts = descriptions(details);
    const places = distributions(details);
    const extraNames = gbifFrenchNames(plant, details);
    const inat = details?.identifiers?.inaturalist;
    const wikidata = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    const links = sources.links(plant);
    const status = plant.status?.france;

    return html`
      <article>
        <a class="back link" href=${lastSearchHash()}>← Recherche</a>
        <h1>${plant.vernacularNames?.[0] || plant.scientificName}</h1>
        <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
        ${this.#actions(plant)}
        <gf-add-to .plant=${plant}></gf-add-to>
        <gf-status .plant=${plant}></gf-status>

        <ul class="tags">
          <li>${plant.family}</li>
          <li>Genre <i>${plant.genus}</i></li>
          ${status ? html`<li title="Statut TAXREF ${status}">${STATUS_LABELS[status] || status}</li>` : nothing}
          ${inat?.observationsCount ? html`<li>${inat.observationsCount.toLocaleString('fr-FR')} observations iNaturalist</li>` : nothing}
        </ul>

        <section>
          <gf-plant-spots plant-id=${plant.id}></gf-plant-spots>
        </section>
        <section>
          <gf-calendar .plant=${plant}></gf-calendar>
        </section>

        ${plant.vernacularNames?.length > 1 || extraNames.length ? html`
          <section>
            <h2>Noms français</h2>
            <p>${[...plant.vernacularNames, ...extraNames].join(' · ')}</p>
          </section>` : nothing}

        <section>
          <h2>Photos</h2>
          ${images.length ? html`
            <div class="gallery">
              ${images.map(image => html`
                <figure>
                  <a href=${image.sourceUrl || image.pageUrl || image.url} target="_blank" rel="noopener">
                    <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  </a>
                  <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
                </figure>`)}
            </div>` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`}
        </section>

        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}

        ${texts.length ? html`
          <section>
            <h2>Descriptions (GBIF)</h2>
            ${texts.map(row => html`
              <div class="description">
                <small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''}</small>
                ${row.text}
              </div>`)}
          </section>` : nothing}

        ${places.length ? html`
          <section>
            <h2>Répartition (GBIF)</h2>
            <ul class="inline">${places.map(row => html`<li>${row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>
          </section>` : nothing}

        ${plant.synonyms?.length ? html`
          <section>
            <h2>Synonymes</h2>
            <p class="sci"><i>${plant.synonyms.join(' · ')}</i></p>
          </section>` : nothing}

        <section class="links">
          <h2>Ressources</h2>
          <ul class="inline">
            ${links.inpn ? html`<li><a href=${links.inpn} target="_blank" rel="noopener">INPN</a></li>` : nothing}
            ${links.taxref ? html`<li><a href=${links.taxref} target="_blank" rel="noopener">TAXREF</a></li>` : nothing}
            <li><a href=${details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : links.gbif} target="_blank" rel="noopener">GBIF</a></li>
            <li><a href=${inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : links.inaturalist} target="_blank" rel="noopener">iNaturalist</a></li>
            <li><a href=${wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : links.wikidata} target="_blank" rel="noopener">Wikidata</a></li>
            <li><a href=${links.wikimedia} target="_blank" rel="noopener">Wikimedia Commons</a></li>
            ${inat?.wikipediaUrl ? html`<li><a href=${inat.wikipediaUrl} target="_blank" rel="noopener">Wikipédia</a></li>` : nothing}
          </ul>
        </section>
      </article>
    `;
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
