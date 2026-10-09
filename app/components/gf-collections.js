// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { GeoController } from '../core/geo.js';
import { href } from '../core/router.js';
import {
  FAVORITES_ID, collectionTitle, discardMissingBackup, distance, exportGeoJSON, formatDistance, inSeason, lastExportDate,
  listCollections, missingFromBackup, plantCount, restoreBackup, soon, spotEvents
} from '../core/collections.js';
import { config } from '../config.js';
import { StoreController, whenReady } from '../core/store.js';
import { ui } from '../styles/ui.js';
import { icon, kindIcon } from '../core/icons.js';
import { encodeCollection, share } from '../core/share.js';

/** Up to this many thumbnails per collection row. */
const THUMBS = 4;
/** Suggest an export when the last one is older than this. */
const REMIND_AFTER = 14 * 86400000;

/** Ids of the collections unfolded in Mes plantes. @returns {Set<string>} */
function readOpen() {
  try {
    const ids = JSON.parse(localStorage.getItem(config.storageKeys.collectionsOpen) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** "Mes plantes": favorites, lists and places in one place. Places open on the map, framed on their points. */
export class GfCollections extends LitElement {
  static properties = {
    _collections: { state: true },
    _thumbs: { state: true },
    _error: { state: true },
    _missing: { state: true },
    _note: { state: true },
    _restoreNote: { state: true },
    _busy: { state: true },
    _open: { state: true },
    _plants: { state: true },
    _shareNote: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 14px 16px 96px; }
    h1 { font-size: 1.35rem; margin: 4px 0 4px; }
    .lead { color: var(--gf-text-muted); margin: 0 0 14px; font-size: 0.9rem; }
    .new { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .new a { flex: 1 1 160px; border-style: dashed; border-color: var(--gf-accent); color: var(--gf-accent); font-weight: 600; min-height: 44px; }
    h2 { margin: 18px 0 8px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    /* A collection: the row opens it; share and fold on its right; unfolded, its plants below. */
    .item { border-radius: var(--gf-radius); background: var(--gf-surface); border: 1px solid var(--gf-border); min-width: 0; }
    .item:hover { border-color: var(--gf-accent); }
    .line { display: flex; align-items: center; min-width: 0; }
    .main {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-template-columns: 40px 1fr auto;
      gap: 2px 12px;
      align-items: center;
      padding: 10px 4px 10px 12px;
      color: inherit;
      text-decoration: none;
      border-radius: var(--gf-radius);
    }
    .tools { display: flex; align-items: center; padding-right: 4px; flex: none; }
    .fold .bi { transition: transform 0.2s; }
    .item.open .fold .bi { transform: rotate(180deg); }
    @media (prefers-reduced-motion: reduce) { .fold .bi { transition: none; } }
    .plants { gap: 0; padding: 0 12px 8px 64px; border-top: 1px solid var(--gf-border); }
    .plants a {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 0 10px;
      align-items: center;
      padding: 6px 0;
      color: inherit;
      text-decoration: none;
      border-bottom: 1px solid var(--gf-border);
    }
    .plants li:last-child a { border-bottom: 0; }
    .plants a:hover .pname { color: var(--gf-accent); }
    .plants img, .plants .ph { grid-row: span 2; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--gf-surface-2); }
    .pname { font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .psci { font-style: italic; color: var(--gf-text-muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .share-note { margin: 0; padding: 0 12px 8px 64px; color: var(--gf-text-muted); font-size: 0.8rem; }
    .icon {
      grid-row: span 2;
      width: 40px;
      height: 40px;
      border-radius: var(--gf-radius);
      display: grid;
      place-items: center;
      font-size: 1.2rem;
      background: var(--gf-accent-soft);
    }
    .icon.fav { color: var(--gf-fav); background: color-mix(in srgb, var(--gf-fav) 14%, var(--gf-surface)); }
    .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side { color: var(--gf-text-muted); font-size: 0.85rem; text-align: right; white-space: nowrap; }
    .sub { grid-column: 2 / -1; display: flex; align-items: center; gap: 8px; color: var(--gf-text-muted); font-size: 0.8rem; min-width: 0; }
    .thumbs { display: flex; }
    .thumbs img, .thumbs span {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--gf-surface);
      margin-left: -6px;
      background: var(--gf-surface-2);
    }
    .thumbs :first-child { margin-left: 0; }
    .empty { color: var(--gf-text-muted); font-size: 0.9rem; }
    .notice {
      display: grid;
      gap: 8px;
      margin: 0 0 16px;
    }
    .notice.backup { margin: 24px 0 0;
      font-size: 0.9rem;
    }
    .notice.restore { border-color: var(--gf-accent); background: var(--gf-accent-soft); }
    .notice p { margin: 0; }
    .notice .row { gap: 14px; }
    .error { color: var(--gf-danger); }
  `];

  #geo = new GeoController(this);
  #store = new StoreController(this);
  #onChange = () => this.#load();

  constructor() {
    super();
    /** @type {import('../core/collections.js').Collection[]} */
    this._collections = [];
    /** plantId → thumbnail url (from the dataset). @type {Map<number, string | null>} */
    this._thumbs = new Map();
    /** @type {string | null} */
    this._error = null;
    /** Collections found in the local backup but missing from the database. @type {import('../core/collections.js').Collection[]} */
    this._missing = [];
    /** @type {string | null} */
    this._note = null;
    /** @type {string | null} */
    this._restoreNote = null;
    this._busy = false;
    /** Ids of the collections unfolded to show their plants (remembered). @type {Set<string>} */
    this._open = readOpen();
    /** plantId → what an unfolded collection shows of it. @type {Map<number, { name: string, sci: string, thumb: string | null } | null>} */
    this._plants = new Map();
    /** « Lien copié. » under the collection just shared. @type {{ id: string, text: string } | null} */
    this._shareNote = null;
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onChange);
    document.title = 'Mes plantes — GeoFlora';
    this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onChange);
  }

  async #load() {
    try {
      await whenReady();
      const all = await listCollections();
      this._collections = all;
      // Thumbnails of the first plants of each collection, from the local dataset.
      const ids = new Set(all.flatMap(c => c.properties.plantIds.slice(0, THUMBS)));
      const thumbs = new Map(this._thumbs);
      await Promise.all([...ids].filter(id => !thumbs.has(id)).map(async id => {
        const plant = await db.get('plants', id);
        thumbs.set(id, plant?.thumbnail?.url || null);
      }));
      this._thumbs = thumbs;
      this.#loadPlants();
      this._missing = await missingFromBackup().catch(() => []);
      this._error = null;
    } catch (error) {
      console.error(error);
      this._error = 'Collections illisibles pour le moment : ' + /** @type {Error} */ (error).message;
    }
  }

  /** @param {import('../core/collections.js').Collection} c @param {string | null} side */
  #row(c, side) {
    const p = c.properties;
    const title = collectionTitle(c);
    const has = p.plantIds.length > 0;
    const open = has && this._open.has(c.id);
    return html`
      <li class="item ${open ? 'open' : ''}">
        <div class="line">
          <a class="main" href=${p.kind === 'place' ? href.map({ spot: c.id }) : href.spot(c.id)}>
            <span class="icon ${p.kind === 'favorites' ? 'fav' : ''}" aria-hidden="true">${kindIcon(p.kind)}</span>
            <span class="name">${title}</span>
            <span class="side">${side || ''}</span>
            <span class="sub">
              <span class="thumbs" aria-hidden="true">
                ${p.plantIds.slice(0, THUMBS).map(id => this._thumbs.get(id)
                  ? html`<img src=${/** @type {string} */ (this._thumbs.get(id))} alt="" loading="lazy" referrerpolicy="no-referrer" />`
                  : html`<span></span>`)}
              </span>
              ${plantCount(p.plants.length)}
              ${p.kind !== 'place' || !this.#store.state.harvestMode ? nothing
                : inSeason(c) ? html`<span class="badge">En saison</span>`
                : soon(c) ? html`<span class="badge soon">Bientôt</span>` : nothing}
            </span>
          </a>
          ${has ? html`<span class="tools">
            <button class="icon-btn share" type="button" title="Partager" aria-label=${'Partager « ' + title + ' »'} @click=${() => this.#share(c)}>${icon('share')}</button>
            <button class="icon-btn fold" type="button" title=${open ? 'Replier' : 'Voir les plantes'} aria-label=${(open ? 'Replier « ' : 'Voir les plantes de « ') + title + ' »'}
              aria-expanded=${open ? 'true' : 'false'} aria-controls=${'plants-' + c.id} @click=${() => this.#toggle(c.id)}>${icon('chevron-down')}</button>
          </span>` : nothing}
        </div>
        ${this._shareNote?.id === c.id ? html`<p class="share-note" role="status">${this._shareNote.text}</p>` : nothing}
        ${open ? html`<ul class="plants" id=${'plants-' + c.id}>${p.plantIds.map(id => this.#plant(id))}</ul>` : nothing}
      </li>`;
  }

  /** A plant of an unfolded collection: its photo and names, to its sheet. @param {number} id */
  #plant(id) {
    const plant = this._plants.get(id);
    if (plant === null) return nothing;
    return html`<li><a href=${href.plant(id)}>
      ${plant?.thumb ? html`<img src=${plant.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<span class="ph" aria-hidden="true"></span>`}
      <span class="pname">${plant?.name ?? '…'}</span>
      <span class="psci">${plant?.sci ?? ''}</span>
    </a></li>`;
  }

  /** Unfolds or folds a collection's plants. @param {string} id */
  #toggle(id) {
    const open = new Set(this._open);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    this._open = open;
    try { localStorage.setItem(config.storageKeys.collectionsOpen, JSON.stringify([...open])); } catch { /* not remembered */ }
    this.#loadPlants();
  }

  /** Names and photos of the plants of the unfolded collections, from the local dataset. */
  async #loadPlants() {
    const ids = new Set(this._collections.filter(c => this._open.has(c.id)).flatMap(c => c.properties.plantIds));
    const missing = [...ids].filter(id => !this._plants.has(id));
    if (!missing.length) return;
    await whenReady();
    const plants = new Map(this._plants);
    await Promise.all(missing.map(async id => {
      const plant = await db.get('plants', id).catch(() => null);
      plants.set(id, plant ? { name: plant.vernacularNames?.[0] || plant.scientificName, sci: plant.vernacularNames?.[0] ? plant.scientificName : '', thumb: plant.thumbnail?.url || null } : null);
    }));
    this._plants = plants;
  }

  /** A link that carries the collection (its plants, and a place's positions): the share sheet, or copied. @param {import('../core/collections.js').Collection} c */
  async #share(c) {
    const p = c.properties;
    if (p.kind === 'place' && !confirm('Le lien contiendra la position exacte de ce lieu. Partager ?')) return;
    const title = collectionTitle(c);
    const result = await share({ title: title + ' — GeoFlora', text: `${title} · ${plantCount(p.plants.length)}`, url: href.shared(await encodeCollection(c)) });
    if (result !== 'copied') return;
    this._shareNote = { id: c.id, text: 'Lien copié.' };
    setTimeout(() => { if (this._shareNote?.id === c.id) this._shareNote = null; }, 2500);
  }

  async #restore() {
    this._busy = true;
    try {
      const n = await restoreBackup();
      this._restoreNote = `${n} collection${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''}.`;
    } catch (error) {
      this._restoreNote = 'Restauration impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
      this.#load();
    }
  }

  async #discard() {
    if (!confirm('Oublier ces collections ? La copie de secours ne les gardera plus.')) return;
    await discardMissingBackup();
    this._missing = [];
  }

  async #export() {
    const { cancelled } = await exportGeoJSON();
    if (!cancelled) this._note = 'Sauvegarde exportée. Gardez le fichier (Drive, e-mail…) : il permet de tout restaurer.';
    this.requestUpdate();
  }

  #dismissReminder() {
    try { localStorage.setItem(config.storageKeys.backupReminder, new Date().toISOString()); } catch { /* not persisted */ }
    this.requestUpdate();
  }

  /** An export is due: collections with plants exist, none exported for 14 days, not dismissed since the last change. */
  #reminderDue() {
    const withPlants = this._collections.filter(c => c.properties.plants.length);
    if (!withPlants.length) return false;
    const last = lastExportDate();
    if (last && Date.now() - Date.parse(last) < REMIND_AFTER) return false;
    let dismissed = null;
    try { dismissed = localStorage.getItem(config.storageKeys.backupReminder); } catch { /* storage unavailable */ }
    const latest = withPlants.reduce((m, c) => (c.properties.updatedAt > m ? c.properties.updatedAt : m), '');
    return !dismissed || dismissed < latest;
  }

  /** At the top: collections found in this device's backup copy, to restore. */
  #restoreNotice() {
    const missing = this._missing;
    return html`
      ${missing.length ? html`
        <div class="notice card restore" role="alert">
          <p><strong>${missing.length} collection${missing.length > 1 ? 's' : ''} retrouvée${missing.length > 1 ? 's' : ''} dans la copie de secours</strong>
            de cet appareil : ${missing.slice(0, 4).map(c => collectionTitle(c)).join(', ')}${missing.length > 4 ? '…' : ''}.</p>
          <div class="row actions">
            <button class="primary" type="button" ?disabled=${this._busy} @click=${this.#restore}>Restaurer</button>
            <button class="link muted" type="button" @click=${this.#discard}>Oublier</button>
          </div>
        </div>` : nothing}
      ${this._restoreNote ? html`<p class="empty" role="status">${this._restoreNote}</p>` : nothing}`;
  }

  /** At the bottom: the reminder to export a backup, when one is due. */
  #backupNotice() {
    return html`
      ${!this._missing.length && this.#reminderDue() ? html`
        <div class="notice card backup">
          <p><strong>Sauvegardez vos collections.</strong> Elles ne sont que sur cet appareil : le navigateur peut les effacer.
            ${lastExportDate() ? `Dernière sauvegarde le ${new Date(/** @type {string} */ (lastExportDate())).toLocaleDateString('fr-FR')}.` : 'Aucune sauvegarde pour l’instant.'}</p>
          <div class="row actions">
            <button class="primary" type="button" @click=${this.#export}>Exporter</button>
            <button class="link muted" type="button" @click=${this.#dismissReminder}>Plus tard</button>
          </div>
        </div>` : nothing}
      ${this._note ? html`<p class="empty" role="status">${this._note}</p>` : nothing}`;
  }

  render() {
    const all = this._collections;
    const favorites = all.find(c => c.id === FAVORITES_ID);
    const lists = all.filter(c => c.properties.kind === 'list')
      .sort((a, b) => b.properties.updatedAt.localeCompare(a.properties.updatedAt));
    const fix = this.#geo.state.fix;
    const places = all.filter(c => c.properties.kind === 'place' && c.geometry)
      .map(c => ({ c, d: fix && c.geometry ? distance(fix.coordinates, c.geometry.coordinates) : null }))
      .sort((a, b) => a.d !== null && b.d !== null ? a.d - b.d : b.c.properties.updatedAt.localeCompare(a.c.properties.updatedAt));

    return html`
      <div class="wrap">
        <h1>Mes plantes</h1>
        <p class="lead">Vos collections de plantes. Une collection qui a des coordonnées GPS est un endroit : touchez-le pour le voir sur la carte. Tout reste sur cet appareil.</p>
        <div class="new">
          <a class="button" href=${href.newList()}>${icon('list-ul')} Nouvelle collection</a>
          <a class="button" href=${href.newSpot()} @click=${e => { e.preventDefault(); this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true })); }}>${icon('geo-alt-fill')} Noter une plante ici</a>
        </div>
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        ${this.#restoreNotice()}

        <ul>
          ${favorites ? this.#row(favorites, null) : html`
            <li class="item"><div class="line"><a class="main" href=${href.spot(FAVORITES_ID)}>
              <span class="icon fav" aria-hidden="true">${icon('heart-fill')}</span><span class="name">Favoris</span><span class="side"></span>
              <span class="sub">Touchez ${icon('heart')} sur une plante pour l’ajouter.</span>
            </a></div></li>`}
        </ul>

        <h2 class="kicker">Collections</h2>
        ${lists.length ? html`<ul>${lists.map(c => this.#row(c, null))}</ul>`
          : html`<p class="empty">Regroupez des plantes : « Mellifères », « À chercher cet été »… Ajoutez-y des coordonnées GPS pour en faire un endroit.</p>`}

        <h2 class="kicker">Endroits${fix ? ' · par distance' : ''}</h2>
        ${places.length ? html`<ul>${places.map(({ c, d }) => this.#row(c, d !== null ? formatDistance(d) : null))}</ul>`
          : html`<p class="empty">Un endroit est une collection qui a des coordonnées GPS ; chacune de ses plantes a aussi sa position.</p>`}

        ${this.#backupNotice()}
      </div>
    `;
  }
}

customElements.define('gf-collections', GfCollections);
