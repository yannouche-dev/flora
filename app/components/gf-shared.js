// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { getPlants, nameOf } from '../core/plants.js';
import { href } from '../core/router.js';
import { importPortable, keptContents, lastEntry, newCollection, newPlace, plantCount, saveCollection, withEntry, withPlant } from '../core/collections.js';
import { FAVORITES_ID } from '../core/place-model.js';
import { hasPersonal } from '../core/portable.js';
import { decodeCollection, decodePortable, isPortableLink } from '../core/share.js';
import { whenReady } from '../core/store.js';
import './gf-map.js';
import './gf-thumb.js';
import { ui } from '../styles/ui.js';
import { kindIcon } from '../core/icons.js';
import { back, replaceView } from '../core/history.js';

/**
 * Preview of a collection received by link (#/shared?d=…), with « Enregistrer dans Mes plantes »: a list, a lieu, or a
 * parcours (« Parcours partagé »: its line, its plants in the order met, its start) — saved as one, the user's own.
 */
export class GfShared extends LitElement {
  static properties = {
    data: {},
    _shared: { state: true },
    _plants: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _portable: { state: true },
    _done: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 14px 16px 40px; display: grid; gap: 12px; }
    h1 { margin: 0; font-size: 1.4rem; }
    gf-map { height: clamp(240px, 42vh, 420px); border-radius: var(--gf-radius); overflow: hidden; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    li a {
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 0 12px;
      align-items: center;
      padding: 6px 10px;
      border-radius: var(--gf-radius);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
    }
    li a:hover { border-color: var(--gf-accent); }
    li gf-thumb { grid-row: span 2; }
    .nm { font-weight: 600; }
    .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); font-size: 0.85rem; }
    .times { font-weight: 600; color: var(--gf-accent); }
    .actions { gap: 14px; position: sticky; bottom: 0; padding: 10px 0; background: var(--gf-bg); }
    p.muted { font-size: 0.9rem; margin: 0; }
    .error { color: var(--gf-danger); }
    ul.names { display: grid; gap: 4px; }
    ul.names li { padding: 6px 10px; border-radius: var(--gf-radius-sm); background: var(--gf-surface); border: 1px solid var(--gf-border); display: flex; justify-content: space-between; }
  `];

  constructor() {
    super();
    this.data = '';
    /** @type {import('../core/share.js').SharedCollection | null} */
    this._shared = null;
    /** @type {any[]} */
    this._plants = [];
    /** @type {string | null} */
    this._error = null;
    this._busy = false;
    /** A transfer link: several collections as slim GeoJSON. @type {any} */
    this._portable = null;
    /** @type {string | null} */
    this._done = null;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('data')) this.#load();
  }

  async #load() {
    this._shared = null;
    this._portable = null;
    this._done = null;
    this._error = null;
    if (isPortableLink(this.data)) {
      try {
        this._portable = await decodePortable(this.data);
        document.title = 'Transfert de Mes plantes — GeoFlora';
      } catch (error) {
        this._error = /** @type {Error} */ (error).message;
      }
      return;
    }
    try {
      const shared = await decodeCollection(this.data);
      await whenReady();
      // One record per plant; the shared rows (occurrences) refer to them.
      const ids = [...new Set(shared.plants.map(p => p.plantId))];
      const records = await getPlants(ids);
      this._plants = records;
      this._shared = shared;
      document.title = (shared.name || sharedKind(shared)) + ' — GeoFlora';
    } catch (error) {
      this._error = /** @type {Error} */ (error).message;
    }
  }

  async #save() {
    const shared = this._shared;
    if (!shared) return;
    this._busy = true;
    try {
      // A parcours stays one (its line, « Continuer »); received, it is the user's own (no origin).
      let collection = shared.kind === 'place' && shared.coordinates
        ? newPlace(shared.coordinates, { name: shared.name, ...(shared.walk ? { walk: true } : {}), ...(shared.startedHere ? { startedHere: true } : {}) })
        : newCollection('list', { name: shared.name });
      // Every shared occurrence (a walk may note the same plant several times, each at its spot).
      const byId = new Map(this._plants.map(p => [p.id, p]));
      for (const row of shared.plants) {
        const plant = byId.get(row.plantId);
        if (!plant) continue;
        const before = collection;
        collection = withPlant(collection, plant, row.coordinates ? { coordinates: row.coordinates, accuracy: null } : undefined, { again: true });
        if (collection !== before && row.abundance) collection = withEntry(collection, /** @type {any} */ (lastEntry(collection)).id, { abundance: /** @type {any} */ (row.abundance) });
      }
      const saved = await saveCollection(collection);
      // Saved, in the preview's place: Back does not open it again (a place: its editor goes on to the Carte, in place).
      replaceView(href.spot(saved.id));
    } catch (error) {
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
    }
  }

  /** « Voir Mes plantes » (the transfer imported, a link that cannot be read): Mes plantes in this page's place. @param {Event} e */
  #toMine = e => { e.preventDefault(); replaceView(href.collections()); };

  async #importPortable() {
    this._busy = true;
    try {
      await whenReady();
      const r = await importPortable(this._portable);
      // Favourites, lists and places together: masculine, as the file import of Réglages says them.
      this._done = `${r.added} ajouté${r.added > 1 ? 's' : ''}, ${r.updated} mis à jour, ${r.unchanged} déjà à jour`
        + (r.skipped ? `, ${r.skipped} ignoré${r.skipped > 1 ? 's' : ''}` : '')
        + (r.notes ? `, ${r.notes} note${r.notes > 1 ? 's' : ''} de fiche` : '') + '.';
    } catch (error) {
      this._error = 'Import impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
    }
  }

  #portableView() {
    const features = this._portable.features;
    const kindOf = (/** @type {any} */ f) => f.id === FAVORITES_ID ? 'favorites' : f.geometry ? 'place' : 'list';
    // The favourites named apart (neither a list nor a place), the sheet's notes last: « Vos favoris (2 plantes), 1 liste,
    // 3 lieux et 1 note de fiche » — a link of notes alone too.
    const notes = (this._portable.sheetNotes || []).reduce((/** @type {number} */ n, /** @type {any} */ b) => n + Object.keys(b?.texts || {}).length, 0);
    const kept = keptContents(features, notes);
    const plants = features.reduce((n, f) => n + (f.properties?.plants?.length || 0), 0);
    const label = (/** @type {any} */ f) => html`${kindIcon(kindOf(f))} ${kindOf(f) === 'favorites' ? 'Favoris' : f.properties?.name || 'Sans nom'}`;
    return html`
      <div class="wrap">
        <span class="kicker">Transfert de Mes plantes</span>
        <h1>${kept ? kept[0].toUpperCase() + kept.slice(1) : 'Rien à importer'}</h1>
        <p class="muted">${plantCount(plants)}${hasPersonal(this._portable) ? ' · avec notes et récoltes' : ' · sans notes ni récoltes'}${this._portable.exportedAt ? ` · créé le ${new Date(this._portable.exportedAt).toLocaleDateString('fr-FR')}` : ''}.</p>
        <ul class="names">${features.map(f => html`<li>${label(f)} <span class="muted">${f.properties?.plants?.length || 0}</span></li>`)}</ul>
        ${this._done ? html`
          <p role="status"><strong>Importé :</strong> ${this._done}</p>
          <div class="actions"><a class="link muted" href=${href.collections()} @click=${this.#toMine}>Voir Mes plantes</a></div>` : html`
          <div class="actions">
            <button class="primary large" type="button" ?disabled=${this._busy} @click=${this.#importPortable}>Importer</button>
            <button class="link muted" type="button" @click=${() => back(href.collections())}>Ignorer</button>
          </div>
          <p class="muted">Vos favoris, listes et lieux déjà présents sur cet appareil sont mis à jour (la version la plus récente l’emporte), sans doublon ; rien n’est envoyé sur Internet.</p>`}
      </div>`;
  }

  /**
   * The shared place on its map: its point and every plant where it was noted — framed on all of them (a walk
   * shared shows the whole walk, and its line: from its start when it began « ici », through each plant noted at a
   * position of its own, in the order met — walk.js's rule).
   * @param {import('../core/share.js').SharedCollection} shared @param {any[]} rows @param {Map<number, any>} byId
   */
  #map(shared, rows, byId) {
    const origin = /** @type {[number, number]} */ (shared.coordinates);
    const plants = rows.map((r, i) => {
      const plant = byId.get(r.plantId);
      return {
        key: 'shared:s' + i, placeId: 'shared', entryId: 's' + i, plantId: r.plantId, sci: plant?.scientificName,
        coordinates: r.coordinates || origin, own: Boolean(r.coordinates), abundance: r.abundance || 'moyen',
        label: nameOf(plant) || 'Plante', season: false
      };
    });
    const points = [origin, ...plants.map(m => m.coordinates)];
    const frame = { key: 'shared:' + points.map(c => c.join(',')).join(';'), points, maxZoom: 18 };
    const spot = { type: 'Feature', id: 'shared', geometry: { type: 'Point', coordinates: origin },
      properties: { kind: 'place', name: shared.name, plants: rows.map(() => ({ abundance: 'moyen', harvests: [] })), plantIds: [] } };
    const line = shared.walk ? { key: 'shared', coordinates: [...(shared.startedHere ? [origin] : []), ...rows.filter(r => r.coordinates).map(r => r.coordinates)] } : null;
    return html`<gf-map no-search no-create .spots=${[spot]} .plants=${plants} plant-zoom="0" .frame=${frame} .line=${line}></gf-map>`;
  }

  render() {
    if (this._portable && !this._error) return this.#portableView();
    if (this._error) {
      return html`<div class="wrap"><h1>Lien de partage</h1><p class="error" role="alert">${this._error}</p>
        <a href=${href.collections()} @click=${this.#toMine}>Voir Mes plantes</a></div>`;
    }
    const shared = this._shared;
    if (!shared) return html`<div class="wrap"><p class="muted">Ouverture du partage…</p></div>`;
    const byId = new Map(this._plants.map(p => [p.id, p]));
    const rows = shared.plants.filter(r => byId.has(r.plantId));
    const missing = shared.plants.length - rows.length;
    // How many times each plant was noted (a walk may meet it again further on).
    const times = new Map();
    for (const r of rows) times.set(r.plantId, (times.get(r.plantId) || 0) + 1);
    const count = rows.length > this._plants.length
      ? `${plantCount(this._plants.length)}, notée${this._plants.length > 1 ? 's' : ''} ${rows.length} fois`
      : plantCount(this._plants.length);

    return html`
      <div class="wrap">
        <span class="kicker">${sharedKind(shared)}</span>
        <h1>${shared.name || 'Sans nom'}</h1>
        <p class="muted">${count}${missing > 0 ? ` (${missing} inconnue${missing > 1 ? 's' : ''} de cette version de la flore)` : ''}</p>
        ${shared.coordinates ? this.#map(shared, rows, byId) : nothing}
        <ul>
          ${this._plants.map(plant => html`
            <li><a href=${href.plant(plant.id)}>
              <gf-thumb .plant=${plant} size="44"></gf-thumb>
              <span class="nm">${nameOf(plant)}${(times.get(plant.id) || 0) > 1 ? html` <small class="times">× ${times.get(plant.id)}</small>` : nothing}</span>
              <span class="sci">${plant.scientificName}</span>
            </a></li>`)}
        </ul>
        <div class="actions">
          <button class="primary large" type="button" ?disabled=${this._busy || !this._plants.length} @click=${this.#save}>Enregistrer dans Mes plantes</button>
          <button class="link muted" type="button" @click=${() => back(href.collections())}>Ignorer</button>
        </div>
        <p class="muted">${shared.walk ? 'L’enregistrement crée un nouveau parcours dans Mes plantes ; rien n’est envoyé.'
          : `L’enregistrement crée ${shared.kind === 'place' ? 'un nouveau lieu' : 'une nouvelle liste'} sur cet appareil ; rien n’est envoyé.`}</p>
      </div>
    `;
  }
}

/** What was shared, in words. @param {import('../core/share.js').SharedCollection} shared */
const sharedKind = shared => shared.walk ? 'Parcours partagé' : shared.kind === 'place' ? 'Lieu partagé' : 'Liste partagée';

customElements.define('gf-shared', GfShared);
