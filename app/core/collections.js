// @ts-check
// Collections of plants, kept in IndexedDB as GeoJSON Features and never sent anywhere:
//  - favorites: the built-in ♥ collection (id 'favorites', no geometry)
//  - list:      a named list of plants (no geometry)
//  - place:     a list at a location (Point) — harvest places
// Each plant entry has its own abundance, rating, notes and harvest log.

import { config } from '../config.js';
import * as db from './db.js';
import { FAVORITES_ID, countOf, joinEntry, locationLoss, madeBy, mergeCollections, newEntryId, normalizeEntry, normalizeCollection, plantIdsOf, plantKey, promoted, promotedEntry, promoteTouched, rebase, sameContent, tagLegacy, userChange, walkMarked, withoutMadeBy } from './place-model.js';
import { store } from './store.js';
import { FORMAT_VERSION, toPortable } from './portable.js';
import { encodeCollection, encodePortable, share } from './share.js';
import { href } from './router.js';
import { publish, subscribe } from './sync.js';
import { exportNotes, importNotes } from './sheet-blocks.js';
import { notesEvents, notesLoaded } from './sheet-notes.js';
import { readJSON, readText, writeJSON, writeText } from './prefs.js';
import { metres as distance } from './distance.js';

export { FAVORITES_ID };

/**
 * @typedef {import('./place-model.js').Place} Place
 * @typedef {import('./place-model.js').Collection} Collection
 * @typedef {import('./place-model.js').CollectionKind} CollectionKind
 * @typedef {import('./place-model.js').PlantEntry} PlantEntry
 * @typedef {import('./place-model.js').Harvest} Harvest
 */

export const ABUNDANCE = [
  { value: 'rare', label: 'Rare' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'abondant', label: 'Abondant' }
];
const ABUNDANCE_RANK = { rare: 0, moyen: 1, abondant: 2 };

/**
 * Fired on `spotEvents` whenever collections change — here or in another tab (sync.js) — so maps, lists and open
 * editors read them again.
 */
export const spotEvents = new EventTarget();
async function changed() {
  await refreshMembership().catch(error => console.error(error));
  await writeBackup().catch(error => console.error(error));
  publish('spots');
  spotEvents.dispatchEvent(new Event('change'));
}

// Another tab wrote: the same as a write here, but its backup copy is already written.
subscribe('spots', async () => {
  await refreshMembership().catch(error => console.error(error));
  spotEvents.dispatchEvent(new Event('change'));
});

// The notes of the plant sheet are in the backup copy too: written again shortly after one changes.
/** @type {any} */ let notesBackup = 0;
notesEvents.addEventListener('change', () => {
  clearTimeout(notesBackup);
  notesBackup = setTimeout(() => writeBackup().catch(error => console.error(error)), 1500);
});

/** A collection deleted (in another tab, or here) before a change to it was written: it is not made again. */
export class GoneError extends Error {
  constructor() {
    super('Supprimé entre-temps (dans un autre onglet ?) : rien n’a été enregistré.');
    this.name = 'GoneError';
  }
}

/** Records are migrated on upgrade; normalizing on read also covers collections imported mid-upgrade. */
const read = (/** @type {any} */ record) => record ? normalizeCollection(record) : undefined;
const isPlace = (/** @type {Collection} */ c) => c.properties.kind === 'place' && c.geometry !== null;

/** Every collection (favorites, lists, places). @returns {Promise<Collection[]>} */
export const listCollections = async () => /** @type {Collection[]} */ ((await db.getAll('spots')).map(read).filter(Boolean));

/** Collections with a location. @returns {Promise<Place[]>} */
export const listPlaces = async () => (await listCollections()).filter(isPlace);

/** Every collection containing a plant. @param {number} plantId @returns {Promise<Collection[]>} */
export const collectionsForPlant = async plantId =>
  /** @type {Collection[]} */ ((await db.getAllByIndex('spots', 'by_plant', plantId)).map(read).filter(Boolean));

/** @param {string} id @returns {Promise<Collection | undefined>} */
export const getPlace = async id => read(await db.get('spots', id)) || undefined;

/** @param {string} id */
export async function deletePlace(id) {
  if (id === FAVORITES_ID) throw new Error('Les favoris ne peuvent pas être supprimés.');
  await db.remove('spots', id);
  // A deliberate deletion may leave nothing: the backup must follow, not keep the deleted collection.
  allowEmptyBackup = true;
  await changed();
}

/** 7 decimals ≈ 1 cm: plenty, and keeps exports readable. @param {[number, number]} c @returns {[number, number]} */
const roundCoordinates = ([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];

/**
 * @param {[number, number]} coordinates [lon, lat]
 * @param {Partial<import('./place-model.js').PlaceProperties>} [properties]
 * @returns {Place}
 */
export function newPlace(coordinates, properties = {}) {
  return { ...newCollection('place', properties), geometry: { type: 'Point', coordinates: roundCoordinates(coordinates) } };
}

/**
 * @param {CollectionKind} kind
 * @param {Partial<import('./place-model.js').PlaceProperties>} [properties]
 * @returns {Collection}
 */
export function newCollection(kind, properties = {}) {
  const now = new Date().toISOString();
  return {
    type: 'Feature',
    // randomUUID only exists in a secure context (https, localhost): served over http on the LAN, another id.
    id: kind === 'favorites' ? FAVORITES_ID : (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    geometry: null,
    properties: {
      kind, name: kind === 'favorites' ? 'Favoris' : '', notes: '', accuracy: null,
      createdAt: now, updatedAt: now, plants: [], plantIds: [], ...properties
    }
  };
}

/**
 * Gives a list a location (it becomes a place), or removes it (it becomes a list).
 * @param {Collection} collection @param {[number, number] | null} coordinates @param {number | null} [accuracy]
 * @returns {Collection}
 */
export function withLocation(collection, coordinates, accuracy = null) {
  if (collection.properties.kind === 'favorites') return collection;
  if (!coordinates) {
    // A list's plants have no position.
    const plants = collection.properties.plants.map(e => ({ ...e, coordinates: null, accuracy: null }));
    return { ...collection, geometry: null, properties: { ...collection.properties, kind: 'list', accuracy: null, plants } };
  }
  const point = roundCoordinates(coordinates);
  // Plants without their own position start at the place's point.
  const plants = collection.properties.plants.map(e => e.coordinates ? e : { ...e, coordinates: point, accuracy: null });
  return { ...collection, geometry: { type: 'Point', coordinates: point }, properties: { ...collection.properties, kind: 'place', accuracy, plants } };
}

/**
 * What « Retirer la position » asks of a lieu (as stored: the editor reads it again first). When the list it would
 * become loses something (place-model.js locationLoss: a plant's own position, the other times a plant is noted, a
 * parcours' walk), it is refused — « Copier en liste » offered instead (copyAsList); otherwise confirmed first, its
 * harvest logs said to stay, though only a lieu shows them. Pure. @param {Collection} c
 * @returns {{ refused: true, title: string, text: string } | { refused: false, title: string, text: string, yes: string }}
 */
export function locationQuestion(c) {
  const { placed, repeats, walk } = locationLoss(c);
  const lost = [
    placed > 1 ? `les positions de ${placed} plantes` : placed ? 'la position d’une plante' : '',
    repeats > 1 ? `les autres fois où ${repeats} plantes sont notées` : repeats ? 'les autres fois où une plante est notée' : '',
    walk ? 'le tracé du parcours' : ''
  ].filter(Boolean);
  if (lost.length) {
    return { refused: true, title: 'Le lieu garde sa position', text: 'Une liste n’a pas de position et ne note chaque plante qu’une fois : '
      + `retirer la position effacerait ${joined(lost)}. « Copier en liste » crée une liste de ses plantes ; le lieu garde ses positions.` };
  }
  const harvests = c.properties.plants.some(e => e.harvests.length);
  return { refused: false, title: 'Retirer la position ?', yes: 'Retirer la position',
    text: 'Le lieu devient une liste de plantes.' + (harvests ? ' Ses journaux de récolte restent, mais ne s’affichent que dans un lieu.' : '') };
}

/**
 * A lieu's plants as a new list (« Copier en liste »): each plant once — its first noting, with a new id, its date, no
 * position, no harvest log (the lieu keeps them; a list shows none), no origin —, the notes, the rating and the
 * abundance of its other notings joined to it (place-model.js joinEntry; notes that would pass what a note holds stay
 * in the lieu only). The list is the user's: no origin, no parcours mark. The lieu is not changed. Pure but for the new
 * ids. @param {Collection} place @param {string} name @returns {Collection}
 */
export function asList(place, name) {
  /** @type {Map<number | string, PlantEntry>} */
  const once = new Map();
  for (const e of place.properties.plants) {
    const had = once.get(plantKey(e));
    if (had) { once.set(plantKey(e), joinEntry(had, { ...e, harvests: [] }) ?? had); continue; }
    const { origin, from, ...rest } = e;
    void origin; void from;
    once.set(plantKey(e), { ...rest, id: newEntryId(), coordinates: null, accuracy: null, altitude: null, harvests: [] });
  }
  return withPlants(newCollection('list', { name }), [...once.values()]);
}

/**
 * « Copier en liste » (offered where « Retirer la position » would lose what a lieu says): a new list of the lieu's
 * plants (asList), « {lieu} (liste) », saved as the user's (savePlace: the favourites of its plants theirs too); the lieu
 * as it was. Resolves with the list as stored; the lieu deleted meanwhile: GoneError.
 * @param {string} id @returns {Promise<Collection>}
 */
export async function copyAsList(id) {
  const place = await getPlace(id);
  if (!place) throw new GoneError();
  return savePlace(asList(place, `${placeTitle(place)} (liste)`));
}

/** Plants are offered the GPS position only when standing near the place (else: the place's point). */
const NEAR_PLACE = 100;

/**
 * Default position of a plant added to a place: the current GPS fix if within 100 m of the place,
 * otherwise the place's point (e.g. when adding from home).
 * @param {Collection} place @param {{ coordinates: [number, number], accuracy: number } | null | undefined} fix
 * @returns {{ coordinates: [number, number] | null, accuracy: number | null }}
 */
export function defaultPlantPosition(place, fix) {
  if (!place.geometry) return { coordinates: null, accuracy: null };
  if (fix && distance(fix.coordinates, place.geometry.coordinates) <= NEAR_PLACE) {
    return { coordinates: roundCoordinates(fix.coordinates), accuracy: Math.round(fix.accuracy) };
  }
  return { coordinates: place.geometry.coordinates, accuracy: null };
}

/**
 * Map markers for the plants of places (each at its own position).
 * @param {Collection[]} places @param {(entry: PlantEntry) => boolean} [keep] @param {boolean} [harvestMode]
 */
export function plantMarkers(places, keep = () => true, harvestMode = false) {
  const out = [];
  for (const place of places) {
    if (!place.geometry) continue;
    for (const entry of place.properties.plants) {
      if (!keep(entry)) continue;
      out.push({
        key: place.id + ':' + entry.id,
        placeId: place.id,
        entryId: entry.id,
        plantId: entry.plantId,
        sci: entry.scientificName || undefined,
        coordinates: entryPosition(place, entry),
        own: Boolean(entry.coordinates),
        abundance: entry.abundance,
        label: entryName(entry) + (place.properties.name ? ' · ' + place.properties.name : ''),
        season: harvestMode && entryInSeason(entry)
      });
    }
  }
  return out;
}

/** Where a plant of a place grows (its own position, else the place's). @param {Collection} place @param {PlantEntry} entry */
export const entryPosition = (place, entry) => entry.coordinates || place.geometry?.coordinates || null;

/** A new plant entry from a TAXREF plant record (or search summary). @param {any} plant @returns {PlantEntry} */
export const newEntry = plant => normalizeEntry({
  id: newEntryId(),
  plantId: plant.id,
  scientificName: plant.scientificName,
  vernacularName: plant.vernacularNames?.[0] ?? plant.vernacularName ?? null,
  addedAt: new Date().toISOString()
}, new Date().toISOString());

/**
 * An entry of a collection: `ref` an entry id (one occurrence), or a plant id (its first occurrence; a
 * number given as text too, as in an address).
 * @param {Place} place @param {string | number | null} ref
 */
export function findEntry(place, ref) {
  const plants = place.properties.plants;
  if (typeof ref === 'string') {
    const byId = plants.find(e => e.id === ref);
    if (byId || !/^\d+$/.test(ref)) return byId || null;
    ref = Number(ref);
  }
  return plants.find(e => e.plantId === ref) || null;
}

/** All the occurrences of a plant in a collection (a place may hold several, along a walk). @param {Place} place @param {number | null} plantId */
export const entriesOf = (place, plantId) => place.properties.plants.filter(e => e.plantId === plantId);

/** The entry a collection got last (the one `withPlant` just added). @param {Place} place */
export const lastEntry = place => place.properties.plants[place.properties.plants.length - 1] || null;

/** Whether `ref` names this entry: its id, or (a number) its plant — every occurrence of it. @param {PlantEntry} e @param {string | number | null} ref */
const matches = (e, ref) => typeof ref === 'string' ? e.id === ref : e.plantId === ref;

/**
 * Returns a copy of the collection with the plant added. In a list it is there once (no-op if already
 * there); in a place, `again` adds another occurrence of it (somewhere else along a walk), else no-op too.
 * In a place, the plant gets `position` (default: the place's point); in a list, no position.
 * @param {Collection} place @param {any} plant
 * @param {{ coordinates: [number, number] | null, accuracy: number | null }} [position]
 * @param {{ again?: boolean, origin?: import('./place-model.js').Origin }} [options] `origin`: the mini-app adding it (a match's favourite)
 */
export function withPlant(place, plant, position, { again = false, origin } = {}) {
  if (!(again && place.geometry) && findEntry(place, plant.id)) return place;
  const entry = newEntry(plant);
  if (origin) entry.origin = { app: origin.app };
  if (place.geometry) {
    entry.coordinates = position?.coordinates ? roundCoordinates(position.coordinates) : place.geometry.coordinates;
    entry.accuracy = position?.coordinates ? position.accuracy ?? null : null;
  }
  return withPlants(place, [...place.properties.plants, entry]);
}

/** Without one occurrence (`ref` an entry id) or a plant altogether (`ref` its plant id). @param {Place} place @param {string | number | null} ref */
export const withoutPlant = (place, ref) => withPlants(place, place.properties.plants.filter(e => !matches(e, ref)));

/** One occurrence changed (`ref` an entry id), or every occurrence of a plant (`ref` its plant id). @param {Place} place @param {string | number | null} ref @param {Partial<PlantEntry>} patch */
export const withEntry = (place, ref, patch) =>
  withPlants(place, place.properties.plants.map(e => matches(e, ref) ? { ...e, ...patch, id: e.id } : e));

/**
 * What taking a plant out of a collection would erase, asked first (the lieu's editor, « Ajouter à… » unticked): `ref`
 * an entry id (that noting: « Retirer le n° 2 du lieu ») or a plant id (every noting of it: unticked). Its note, its
 * harvest log; noted several times in a lieu, the position of each too. null when only its being there goes: one noting
 * without note nor harvest log, or (no positions) a plant of a list or of the favourites without them. Pure.
 * @param {Collection} c @param {string | number | null} ref
 * @returns {{ title: string, text: string, yes: string, danger: boolean } | null}
 */
export function removeQuestion(c, ref) {
  const gone = c.properties.plants.filter(e => matches(e, ref));
  if (!gone.length) return null;
  const notes = gone.some(e => e.notes.trim()), harvests = gone.some(e => e.harvests.length);
  const where = c.id === FAVORITES_ID ? 'des favoris' : c.geometry ? 'de ce lieu' : 'de cette liste';
  const asked = { yes: 'Retirer', danger: true };
  if (gone.length === 1) {
    if (!notes && !harvests) return null;
    // One of the plant's notings in a lieu: which one (« n° 2 », as the editor numbers them).
    const all = c.geometry ? entriesOf(c, gone[0].plantId) : [];
    const name = entryName(gone[0]) + (all.length > 1 ? ` n° ${all.indexOf(gone[0]) + 1}` : '');
    return { ...asked, title: `Retirer ${name} ${where} ?`,
      text: notes && harvests ? 'Sa note et son journal de récolte seront effacés.' : notes ? 'Sa note sera effacée.' : 'Son journal de récolte sera effacé.' };
  }
  const what = joined([c.geometry ? `ses ${gone.length} positions` : '', notes ? 'ses notes' : '', harvests ? 'ses journaux de récolte' : ''].filter(Boolean));
  if (!what) return null;
  return { ...asked, title: `Retirer ${entryName(gone[0])}, notée ${gone.length} fois, ${where} ?`,
    text: `${what[0].toUpperCase()}${what.slice(1)} seront ${harvests ? 'effacés' : 'effacées'}.` };
}

/** @param {Place} place @param {PlantEntry[]} plants @returns {Place} */
const withPlants = (place, plants) => ({ ...place, properties: { ...place.properties, plants, plantIds: plantIdsOf(plants) } });

/** The record as stored: rounded point, derived plant ids, the time of this change. @param {Collection} place @returns {Collection} */
const stamped = place => ({
  ...place,
  geometry: place.geometry ? { type: 'Point', coordinates: roundCoordinates(place.geometry.coordinates) } : null,
  properties: { ...place.properties, plantIds: plantIdsOf(place.properties.plants), updatedAt: new Date().toISOString() }
});

/** @param {Collection} saved */
async function afterSave(saved) {
  markHasSpots();
  await changed();
  // The altitudes of its new or moved positions, in the background (saved again once found); altitude.js comes then,
  // not with the start of the app.
  if (saved.geometry) import('./altitude.js').then(a => a.fillAltitudes(saved.id, getPlace, updatePlace)).catch(() => {});
}

/**
 * Stores a whole collection as given: a new one (created here), or one put back as it was (« Annuler »). A change
 * to a collection that exists goes through updatePlace, which starts from the stored record.
 * A list or a lieu of the user's (no mini-app made it: « Noter ici », a link saved, a list made in « Ajouter à… »):
 * the favourites of its plants a game made are theirs now (promoteFavorites) — « Recommencer » the game keeps them.
 * @param {Collection} place
 */
export async function savePlace(place) {
  const saved = stamped(place);
  await db.put('spots', saved);
  await afterSave(saved);
  if (saved.id !== FAVORITES_ID && !saved.properties.origin) await promoteFavorites(plantIdsOf(saved.properties.plants));
  return saved;
}
export const saveCollection = savePlace;

/**
 * Changes a stored collection atomically: `change` gets it as stored now (read in the same transaction as the write,
 * so nothing written meanwhile — by another tab, the altitudes, « Noter ici » — is lost) and returns it changed, or
 * the same object to leave it as it is. A collection deleted meanwhile is not made again: GoneError (except the
 * favorites, created on first use — unless `create` is false: nothing written then, GoneError too).
 * What a mini-app made, changed by the user — anyone but that mini-app (`by`), anything but the altitudes —, becomes
 * the user's own (place-model.js#promoted): « Recommencer » the mini-app keeps it. One rule, three ways:
 *  - a collection it made (a parcours), changed in anything: the collection and all it holds;
 *  - an entry it made (a favourite of a match), changed (a note, a rating, a harvest…: place-model.js#promoteTouched);
 *  - a plant put in a list or a lieu (a new entry: noted again in a lieu counts too): its favourite (promoteFavorites).
 * @param {string} id @param {(current: Collection) => Collection} change
 * @param {{ by?: string, create?: boolean }} [opts] `by`: the mini-app writing; `create`: the favourites made if missing
 * @returns {Promise<Collection>} as stored
 */
export async function updatePlace(id, change, { by, create = true } = {}) {
  /** @type {Collection | null} */
  let saved = null;
  let wrote = false;
  /** @type {number[]} */
  let gained = [];
  await db.update('spots', id, record => {
    const current = read(record) || (id === FAVORITES_ID && create ? newCollection('favorites') : undefined);
    if (!current) return undefined;
    let next = change(current);
    if (next === current && record) { saved = current; return undefined; }
    const app = current.properties.origin?.app;
    if (app && app !== by && userChange(current, next)) next = promoted(next);
    if (!by) {
      next = promoteTouched(current, next);
      const had = new Set(current.properties.plants.map(e => e.id));
      gained = id === FAVORITES_ID ? [] : plantIdsOf(next.properties.plants.filter(e => !had.has(e.id)));
    }
    wrote = true;
    return saved = stamped(next);
  });
  if (!saved) throw new GoneError();
  if (wrote) {
    await afterSave(saved);
    await promoteFavorites(gained);
  }
  return saved;
}

/**
 * An editor's edits saved: what it changed since it read the collection (`base` → `mine`) applied to the record as
 * stored now (place-model.js rebase), atomically. A collection deleted meanwhile throws GoneError.
 * @param {Collection} base @param {Collection} mine @returns {Promise<Collection>}
 */
export const savePatch = (base, mine) => updatePlace(mine.id, theirs => rebase(base, mine, theirs));

// ── Favorites & membership ────────────────────────────────────────────────

/**
 * In-memory view of what is in which collection, for cheap lookups in list rows and the search worker.
 * @typedef {{ id: string, name: string, kind: CollectionKind, count: number }} CollectionSummary
 * @type {{ favorites: Set<number>, byPlant: Map<number, string[]>, collections: CollectionSummary[] }}
 */
let membership = { favorites: new Set(), byPlant: new Map(), collections: [] };

export const getMembership = () => membership;

/** Rebuilds the membership view and publishes it in the store (favorites ♥, "Mes plantes" facet). */
export async function refreshMembership() {
  const all = await listCollections();
  const byPlant = new Map();
  for (const c of all) {
    for (const id of c.properties.plantIds) {
      const list = byPlant.get(id) || [];
      list.push(c.id);
      byPlant.set(id, list);
    }
  }
  const favorites = new Set(all.find(c => c.id === FAVORITES_ID)?.properties.plantIds || []);
  // Plant → one place where it is noted (📍 in the results grid opens it on the map).
  const placed = new Map();
  for (const c of all) if (isPlace(c)) for (const id of c.properties.plantIds) if (!placed.has(id)) placed.set(id, c.id);
  const collections = all
    .map(c => ({ id: c.id, name: placeTitle(c), kind: c.properties.kind, count: c.properties.plants.length }))
    .sort((a, b) => (a.kind === 'favorites' ? -1 : b.kind === 'favorites' ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
  membership = { favorites, byPlant, collections };
  store.set({ favorites, placed, collections });
}

/** @param {string} text */
const foldName = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Existing collections whose name contains the typed text (accents and case ignored): suggestions for
 * every "collection name" field, so typing "mell" offers « Mellifères » rather than creating a twin.
 * @param {CollectionSummary[]} collections
 * @param {string} text
 * @param {number} [limit]
 * @returns {{ matches: CollectionSummary[], exact: CollectionSummary | null }}
 */
export function matchCollections(collections, text, limit = 6) {
  const query = foldName(text);
  if (!query) return { matches: [], exact: null };
  const scored = collections
    .map(c => ({ c, at: foldName(c.name).indexOf(query) }))
    .filter(m => m.at >= 0)
    .sort((a, b) => (a.c.kind === 'favorites' ? -1 : b.c.kind === 'favorites' ? 1 : 0) || a.at - b.at || a.c.name.localeCompare(b.c.name, 'fr'));
  return {
    matches: scored.slice(0, limit).map(m => m.c),
    exact: collections.find(c => foldName(c.name) === query) || null
  };
}

/** @param {number} plantId */
export const isFavorite = plantId => membership.favorites.has(plantId);

/**
 * Adds or removes a plant from the favorites (created on first use). `origin`: the mini-app adding it (a match),
 * whose « Recommencer » takes it away again.
 * @param {any} plant TAXREF record or search summary @param {import('./place-model.js').Origin} [origin]
 * @returns {Promise<boolean>} new state
 */
export async function toggleFavorite(plant, origin) {
  let on = false;
  await updatePlace(FAVORITES_ID, current => {
    on = !findEntry(current, plant.id);
    return on ? withPlant(current, plant, undefined, { origin }) : withoutPlant(current, plant.id);
  });
  return on;
}

/**
 * A heart (a match, the deck of a layout): the plant put in the favourites when it is not there — never taken out (a
 * heart in a tab whose ♥ is stale, set or removed in another one, never removes a favourite). `origin`: the mini-app
 * whose match adds it (« Recommencer » it, and it goes). Resolves with the entry added, or null (a favourite already).
 * @param {any} plant TAXREF record or search summary @param {import('./place-model.js').Origin} [origin]
 * @returns {Promise<PlantEntry | null>}
 */
export async function addFavorite(plant, origin) {
  /** @type {PlantEntry | null} */
  let added = null;
  await updatePlace(FAVORITES_ID, current => {
    added = null;
    if (findEntry(current, plant.id)) return current;
    const next = withPlant(current, plant, undefined, { origin });
    added = lastEntry(next);
    return next;
  }, { by: origin?.app });
  return added;
}

// ── What a mini-app made ──────────────────────────────────────────────────

/**
 * A collection made the user's own (a parcours finished with plants, shared, exported alone; the favourites shared or
 * exported alone: the favourites of matches in them): its mini-app's « Recommencer » keeps it. Nothing made by a
 * mini-app (or gone): nothing done. @param {string} id
 */
export async function promotePlace(id) {
  await updatePlace(id, c => madeHere(c) ? promoted(c) : c, { create: false }).catch(() => {});
}

/** Whether a mini-app made this collection, or something in it (a favourite of a match). @param {Collection} c */
const madeHere = c => Boolean(c.properties.origin || c.properties.plants.some(e => e.origin));

// ── Shared, exported: what leaves the device, said first ─────────────────

/**
 * The positions a link or a file carries of a lieu, counted: « la position exacte de ce lieu et de ses 2 plantes »
 * (« de ce parcours » ; « et de sa plante, notée 3 fois » ; « et de ses 2 plantes, notées 3 fois »). Pure.
 * @param {Collection} c a collection with a point
 */
export function positionWords(c) {
  const plants = c.properties.plants;
  const n = plants.length, species = new Set(plants.map(plantKey)).size;
  const them = !n ? '' : species > 1 ? ` et de ses ${species} plantes` : ' et de sa plante';
  const times = n > species ? `, notée${species > 1 ? 's' : ''} ${n} fois` : '';
  return `la position exacte ${c.properties.walk ? 'de ce parcours' : 'de ce lieu'}${them}${times}`;
}

/**
 * What a link to this collection asks before it carries a position (shareCollection): a lieu's, a parcours' (and its
 * start, where the walker stood: said). null without a point (a list, the favourites): nothing to ask. Pure.
 * @param {Collection} c @returns {{ title: string, text: string, yes: string } | null}
 */
export function positionQuestion(c) {
  if (!c.geometry) return null;
  const walk = Boolean(c.properties.walk);
  return { title: walk ? 'Partager le parcours ?' : 'Partager ce lieu ?', yes: 'Partager',
    text: `Le lien contiendra ${positionWords(c)}.` + (walk && c.properties.startedHere ? ' Son départ est la position où vous étiez quand vous l’avez commencé.' : '') };
}

/**
 * « Partager » a list, a lieu, a parcours or the favourites (the lieu's editor, Mes plantes, the Parcours): a link that
 * carries it (share.js encodeCollection: its plants, a lieu's positions — never notes nor harvest logs), by the system's
 * share sheet or copied. A position is asked first (`ask`: gf-ask.js confirmAsk, given by the screen — this module
 * starts with the app, the dialog does not): refused, nothing goes. Shared, copied, or shown to copy by hand: the
 * user's own from then on (promotePlace: « Recommencer » keeps it); cancelled or refused, nothing changes.
 * @param {Collection} c @param {(q: { title: string, text: string, yes: string }) => Promise<boolean>} ask
 * @returns {Promise<'shared' | 'copied' | 'cancelled' | 'failed' | 'refused'>}
 */
export async function shareCollection(c, ask) {
  const q = positionQuestion(c);
  if (q && !await ask(q)) return 'refused';
  const title = placeTitle(c);
  const result = await share({ title: title + ' — GeoFlora', text: `${title} · ${countOf(c)}`, url: href.shared(await encodeCollection(c)) });
  if (result !== 'cancelled') await promotePlace(c.id);
  return result;
}

/**
 * The favourites of these plants made the user's own (put in a list or a lieu, given a note on the sheet): their
 * mini-app's « Recommencer » keeps them. One write, only when one of them is a game's (read as stored: never an
 * in-memory guess); no favourites: nothing written. @param {number[]} plantIds
 */
export async function promoteFavorites(plantIds) {
  if (!plantIds.length) return;
  const ids = new Set(plantIds);
  const mine = (/** @type {PlantEntry} */ e) => Boolean(e.origin) && e.plantId !== null && ids.has(e.plantId);
  await updatePlace(FAVORITES_ID, c => c.properties.plants.some(mine)
    ? withPlants(c, c.properties.plants.map(e => mine(e) ? promotedEntry(e) : e)) : c, { create: false }).catch(() => {});
}

/**
 * A favourite a mini-app made, taken back (↺ on its heart, « Retirer » a match, a toxic look-alike matched) — read as
 * stored, never one the user made, or made their own since (promoted: filed, annotated…). No favourites: nothing
 * written. Resolves with whether it went.
 * @param {number} plantId @param {string} app @returns {Promise<boolean>}
 */
export async function forgetFavoriteMadeBy(plantId, app) {
  let gone = false;
  await updatePlace(FAVORITES_ID, c => {
    const plants = c.properties.plants.filter(e => !(e.plantId === plantId && e.origin?.app === app));
    gone = plants.length < c.properties.plants.length;
    return gone ? withPlants(c, plants) : c;
  }, { by: app, create: false }).catch(() => { gone = false; });
  return gone;
}

/**
 * The favourite a heart added, taken back (↺ in the deck of a layout: no mini-app, no origin) — only while it is there
 * as that heart left it: a note, a rating, an abundance or a harvest given since, it is the user's and stays. Resolves
 * with whether it went. @param {string} entryId @param {PlantEntry} made the entry as added (addFavorite)
 * @returns {Promise<boolean>}
 */
export async function forgetFavoriteEntry(entryId, made) {
  const said = (/** @type {PlantEntry} */ e) => JSON.stringify([e.notes, e.rating, e.abundance, e.harvests]);
  let gone = false;
  await updatePlace(FAVORITES_ID, c => {
    const e = c.properties.plants.find(x => x.id === entryId);
    gone = Boolean(e) && said(/** @type {PlantEntry} */ (e)) === said(made);
    return gone ? withoutPlant(c, entryId) : c;
  }, { create: false }).catch(() => { gone = false; });
  return gone;
}

/**
 * The favourites these mini-apps' matches added, made the user's own at once (« Revoir les premiers pas »: their games
 * forgotten, their favourites kept — never taken by a later « Recommencer »), in one write. No favourites: nothing
 * written. Resolves with how many became the user's.
 * @param {readonly string[]} apps @returns {Promise<number>}
 */
export async function adoptMadeBy(apps) {
  let n = 0;
  await updatePlace(FAVORITES_ID, c => {
    const theirs = (/** @type {PlantEntry} */ e) => Boolean(e.origin && apps.includes(e.origin.app));
    n = c.properties.plants.filter(theirs).length;
    return n ? withPlants(c, c.properties.plants.map(e => theirs(e) ? promotedEntry(e) : e)) : c;
  }, { create: false }).catch(error => {
    n = 0;
    // No favourites: none to adopt. Anything else: said to the caller (the first steps are not started again).
    if (!(error instanceof GoneError)) throw error;
  });
  return n;
}

/** What a mini-app made in Mes plantes (place-model.js#madeBy): its favourites, its collections. @param {string} app */
export const madeByApp = async app => madeBy(await listCollections(), app);

/**
 * « Recommencer » a mini-app: what it made in Mes plantes deleted, in one transaction — its favourites (the
 * entries with its origin), the collections it made (a parcours, with every plant in it) —; nothing else. The other
 * tabs and the backup follow. @param {string} app @returns {Promise<number>} the collections and entries removed
 */
export async function forgetMadeBy(app) {
  const keys = (await listCollections()).map(c => c.id);
  let removed = 0;
  await db.updateMany('spots', keys, record => {
    const c = read(record);
    if (!c) return undefined;
    const next = withoutMadeBy(c, app);
    if (next === c) return undefined;
    removed += next ? c.properties.plants.length - next.properties.plants.length : 1;
    return next ? stamped(next) : db.DELETE;
  });
  if (removed) {
    // A deliberate deletion may leave nothing: the backup must follow, not keep what was deleted.
    allowEmptyBackup = true;
    await changed();
  }
  return removed;
}

/**
 * The origins of what the mini-apps made before they were recorded, given once (best effort, place-model.js#tagLegacy):
 * the parcours under way or empty (the finished ones, and every favourite of before, are the user's). Marked done in
 * the database (meta « origins »).
 * @param {{ walks: string[], walk?: string | null }} known
 */
export async function tagLegacyOrigins(known) {
  if (await db.get('meta', 'origins').catch(() => null)) return;
  const changes = tagLegacy(await listCollections(), known);
  if (changes.length) {
    const byId = new Map(changes.map(c => [c.id, c]));
    await db.updateMany('spots', [...byId.keys()], record => {
      const c = read(record);
      // Changed meanwhile: tagged again from what is stored now.
      return c ? tagLegacy([c], known).map(stamped)[0] : undefined;
    });
    await changed();
  }
  await db.put('meta', { at: new Date().toISOString() }, 'origins');
}

/**
 * The parcours of before the mark, marked once (place-model.js#walkMarked): those made by the Parcours (read as walks
 * already), started « ici », or kept by the Parcours of this device (`known`: its list to continue, the recap shown, the
 * walk under way — the list read before it is forgotten, main.js). Only `walk: true` is written, each record read again
 * in the same transaction, its date of change kept (no change by the user); the backup copy and the other tabs follow.
 * Done once (meta « walks »): run again, it writes nothing. Resolves with how many were marked.
 * @param {{ walks: string[], walk?: string | null }} known @returns {Promise<number>}
 */
export async function markWalks(known) {
  if (await db.get('meta', 'walks').catch(() => null)) return 0;
  const keys = (await db.getAll('spots')).filter(record => walkMarked(record, known)).map(record => record.id);
  let marked = 0;
  if (keys.length) {
    await db.updateMany('spots', keys, record => {
      // As stored now (another tab may have written meanwhile): marked only if it still needs it.
      const next = walkMarked(record, known);
      if (next) marked++;
      return next ?? undefined;
    });
  }
  if (marked) await changed();
  await db.put('meta', { at: new Date().toISOString() }, 'walks');
  return marked;
}

/**
 * Adds or removes a plant from a collection.
 * @param {string} collectionId @param {any} plant @param {boolean} on
 */
export async function setInCollection(collectionId, plant, on) {
  // A favourite of a game put in a list or a lieu: the user's own now (updatePlace).
  try {
    return await updatePlace(collectionId, current =>
      Boolean(findEntry(current, plant.id)) === on ? current : on ? withPlant(current, plant) : withoutPlant(current, plant.id));
  } catch (error) {
    if (error instanceof GoneError) throw new Error('Liste ou lieu introuvable.', { cause: error });
    throw error;
  }
}

/**
 * Asks the browser not to evict our storage under pressure (places exist only on this device).
 * Granting it can make Chrome close open IndexedDB connections (db.js reconnects), so it is
 * asked at startup, before the database is opened — and only once places exist.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* best effort */ }
}

/** Remembers, without opening the database, that this device holds places worth protecting. */
function markHasSpots() {
  if (readText(config.storageKeys.hasSpots)) return;
  writeText(config.storageKeys.hasSpots, '1');
  // First place ever: ask now (later sessions ask at startup).
  requestPersistence();
}

export function hasSpots() {
  return readText(config.storageKeys.hasSpots) === '1';
}

// ── Season, labels & distance ─────────────────────────────────────────────

const DAY = 86400000;
const dayOfYear = (/** @type {Date} */ d) => Math.floor((Date.UTC(2001, d.getMonth(), d.getDate()) - Date.UTC(2001, 0, 1)) / DAY);

/**
 * A plant is in season at a place when it was harvested there, in any year,
 * within ±15 days of today's day of the year.
 * @param {PlantEntry} entry @param {Date} [today]
 */
export function entryInSeason(entry, today = new Date()) {
  const now = dayOfYear(today);
  return entry.harvests.some(h => {
    const date = new Date(h.date + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return false;
    const gap = Math.abs(dayOfYear(date) - now);
    return Math.min(gap, 365 - gap) <= 15;
  });
}

/**
 * "Bientôt": harvested, in any year, within the next 30 days of the calendar (and not in season now).
 * @param {PlantEntry} entry @param {Date} [today]
 */
export function entrySoon(entry, today = new Date()) {
  if (entryInSeason(entry, today)) return false;
  const now = dayOfYear(today);
  return entry.harvests.some(h => {
    const date = new Date(h.date + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return false;
    const ahead = (dayOfYear(date) - now + 365) % 365;
    return ahead > 15 && ahead <= 30;
  });
}

/** @param {Place} place @param {Date} [today] */
export const soon = (place, today = new Date()) => !inSeason(place, today) && place.properties.plants.some(e => entrySoon(e, today));

/** Does any collection hold a harvest? (decides the default of harvest mode) */
export async function anyHarvest() {
  return (await listCollections()).some(c => c.properties.plants.some(e => e.harvests.length));
}

/** Recently used plants (quick capture suggestions). @returns {number[]} */
export function recentPlants() {
  const list = readJSON(config.storageKeys.recentPlants, []);
  return Array.isArray(list) ? list.filter(Number.isInteger) : [];
}

/** @param {number} plantId */
export function rememberPlant(plantId) {
  const list = [plantId, ...recentPlants().filter(id => id !== plantId)].slice(0, 12);
  writeJSON(config.storageKeys.recentPlants, list);
}

/** @param {Place} place @param {Date} [today] */
export const inSeason = (place, today = new Date()) => place.properties.plants.some(e => entryInSeason(e, today));

/** @param {PlantEntry} entry */
export const lastHarvest = entry => entry.harvests[0] || null;

/** Most recent harvest at the place, any plant. @param {Place} place @returns {{ entry: PlantEntry, harvest: Harvest } | null} */
export function placeLastHarvest(place) {
  let best = null;
  for (const entry of place.properties.plants) {
    const harvest = entry.harvests[0];
    if (harvest && (!best || harvest.date > best.harvest.date)) best = { entry, harvest };
  }
  return best;
}

/** Highest abundance among the plants (pin colour). @param {Place} place @returns {import('./place-model.js').Abundance} */
export function placeAbundance(place) {
  let best = /** @type {import('./place-model.js').Abundance} */ ('moyen');
  let rank = -1;
  for (const e of place.properties.plants) {
    if (ABUNDANCE_RANK[e.abundance] > rank) { rank = ABUNDANCE_RANK[e.abundance]; best = e.abundance; }
  }
  return best;
}

/** @param {PlantEntry} entry */
export const entryName = entry => entry.vernacularName || entry.scientificName || 'Plante';

/** Collection name, else (places) its single plant, else "Benoîte + 2 autres". @param {Collection} place */
export function placeTitle(place) {
  if (place.properties.kind === 'favorites') return 'Favoris';
  if (place.properties.name) return place.properties.name;
  if (place.properties.kind === 'list') return 'Liste sans nom';
  const plants = place.properties.plants;
  if (plants.length === 1) return entryName(plants[0]);
  if (!plants.length) return 'Lieu sans plante';
  return `${entryName(plants[0])} + ${plants.length - 1} autre${plants.length > 2 ? 's' : ''}`;
}

/** @param {number} n */
export const plantCount = n => `${n} plante${n > 1 ? 's' : ''}`;

// The great-circle distance in metres, and a distance said (« 1,5 km »): core/distance.js's, offered here too (screens
// import them from this module; `distance` is read here as well).
export { distance };
export { formatDistance } from './distance.js';

/**
 * Existing places within `radius` metres, nearest first.
 * @param {[number, number]} coordinates @param {number} radius @param {string} [excludeId]
 */
export async function nearbyPlaces(coordinates, radius, excludeId) {
  return (await listPlaces())
    .filter(place => place.id !== excludeId)
    .map(place => ({ place, distance: distance(coordinates, place.geometry.coordinates) }))
    .filter(row => row.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

/** Link handing the place to the phone's navigation app. @param {Place} place */
export function directionsUrl(place) {
  if (!place.geometry) return '#';
  const [lon, lat] = place.geometry.coordinates;
  if (/android/i.test(navigator.userAgent)) return `geo:${lat},${lon}?q=${lat},${lon}`;
  if (/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)) return `https://maps.apple.com/?daddr=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

// ── Local backup copy ─────────────────────────────────────────────────────
// A second copy of every collection in localStorage, rewritten on each change. If IndexedDB loses the
// collections (failed upgrade, partial wipe, bug), "Mes plantes" offers to restore them. A full wipe of
// the site's data by the browser removes this copy too: only an exported file survives that.

/** Above this size the copy is not written (localStorage holds ~5 MB per site). */
const BACKUP_LIMIT = 2_500_000;
/** Set by a deliberate deletion: an empty list may then overwrite a non-empty backup. */
let allowEmptyBackup = false;

/** @typedef {{ savedAt: string, features: any[], sheetNotes?: any[] }} Backup */

/** @returns {Backup | null} */
export function readBackup() {
  const data = readJSON(config.storageKeys.backup, null);
  return data && Array.isArray(data.features) ? data : null;
}

/**
 * Rewrites the backup from the database. Never replaces a backup holding collections with an empty
 * one unless the user just deleted something: an empty database is exactly what it must survive.
 * Never while a repair waits to put it back (restorePending): the first ♥ in the new, empty base would replace it.
 * @returns {Promise<'saved' | 'kept' | 'too-large' | 'failed'>}
 */
export async function writeBackup() {
  if (restorePending()) return 'kept';
  const all = (await listCollections()).filter(c => c.properties.plants.length || c.properties.kind !== 'favorites');
  const previous = readBackup();
  // The plant sheet's notes too; not read yet, or none left (a wiped database, like the collections): the copy's kept.
  let sheetNotes = notesLoaded() ? exportNotes() : [];
  if (!sheetNotes.length) sheetNotes = previous?.sheetNotes || [];
  if (!all.length && previous?.features.length && !allowEmptyBackup) return 'kept';
  allowEmptyBackup = false;
  const json = JSON.stringify({ savedAt: new Date().toISOString(), features: toPortable(all).features, ...(sheetNotes.length ? { sheetNotes } : {}) });
  if (json.length > BACKUP_LIMIT) return 'too-large';
  // Refused for lack of room: said on screen (quota.js).
  return writeText(config.storageKeys.backup, json) ? 'saved' : 'failed';
}

/** Collections in the backup that the database no longer has. @returns {Promise<Collection[]>} */
export async function missingFromBackup() {
  const backup = readBackup();
  if (!backup?.features.length) return [];
  const present = new Set((await listCollections()).map(c => c.id));
  const missing = /** @type {Collection[]} */ (backup.features.map(normalizeCollection)
    .filter(c => c && !present.has(c.id) && (c.properties.plants.length || c.properties.kind !== 'favorites')));
  if (missing.length) fillNames(missing, await db.getAll('plants'));
  return missing;
}

/**
 * Puts the missing collections back, and the plant sheet's notes this device lost.
 * @returns {Promise<{ count: number, kept: string }>} how many collections were restored, and what they hold in words
 *   (keptContents)
 */
export async function restoreBackup() {
  await importNotes(readBackup()?.sheetNotes).catch(error => console.error(error));
  const missing = await missingFromBackup();
  if (!missing.length) return { count: 0, kept: '' };
  const { added, updated } = await importFeatures(missing);
  return { count: added + updated, kept: keptContents(missing) };
}

/** Forgets collections the user chose not to restore (the backup then follows the database). */
export async function discardMissingBackup() {
  allowEmptyBackup = true;
  await writeBackup();
}

// « Réparer le stockage » (components/gf-storage-error.js): the database erased and made again, what the backup copy
// holds is put back by itself at the next launch (main.js), once the flora is stored (the names of the plants come
// from it). Until then the copy is held: noted in localStorage before anything is erased, so a reload, a crash or
// another tab never loses it. A base the browser emptied by itself is put back the same way (holdIfEmptied).

/** Why the backup copy is put back: the app's repair erased the base, or the browser emptied it (holdIfEmptied). @typedef {'repair' | 'lost'} RestoreReason */

/** A repair waits to put the backup copy back. */
export function restorePending() {
  return readText(config.storageKeys.restorePending) !== null;
}

/** Why it waits (a mark of before the reason was noted: the repair's). @returns {RestoreReason} */
export function restoreReason() {
  return readJSON(config.storageKeys.restorePending, null)?.reason === 'lost' ? 'lost' : 'repair';
}

/**
 * Noted before the database is erased; false when it could not be (then nothing must be erased).
 * @param {RestoreReason} [reason]
 */
export function markRestore(reason = 'repair') {
  return writeJSON(config.storageKeys.restorePending, { at: new Date().toISOString(), backupAt: readBackup()?.savedAt ?? null, reason });
}

/**
 * The base was made at this page's open (db.js baseMade) while the backup copy of this device holds something: the
 * browser emptied it — its IndexedDB cleared, a damaged store made again, empty (Chromium does) —, as only a base that
 * existed leaves a copy. Held at once, before anything is written into the new base (the first ♥ would replace it),
 * and put back as after a repair (main.js restoreAfter). Returns whether a restore now waits.
 */
export function holdIfEmptied() {
  if (!restorePending() && db.baseMade() && backupSummary()) markRestore('lost');
  return restorePending();
}

/** Nothing was erased after all, or everything is back: no longer waiting. */
export function cancelRestore() {
  writeText(config.storageKeys.restorePending, null);
}

/**
 * After the repair: everything the backup copy holds put back — merged, so what was added since (a ♥ meanwhile) stays —
 * with the plant sheet's notes; then the copy, held until now, follows the database again. Resolves with what it held,
 * now back (null: nothing), counted as the repair's dialog counted it. Rejects, the copy still held, when anything could
 * not be put back (tried again at the next launch).
 * @returns {Promise<BackupSummary | null>}
 */
export async function restoreAfterRepair() {
  const backup = readBackup();
  const summary = backupSummary();
  await importNotes(backup?.sheetNotes);
  await importFeatures(backup?.features ?? []);
  cancelRestore();
  await writeBackup();
  return summary;
}

/** @typedef {{ savedAt: string, favorites: number, lists: number, places: number, notes: number }} BackupSummary */

/**
 * What the backup copy holds, said before a repair: read from localStorage only (IndexedDB may not open). null: no
 * copy, or nothing in it.
 * @returns {BackupSummary | null}
 */
export function backupSummary() {
  const backup = readBackup();
  if (!backup) return null;
  const all = /** @type {Collection[]} */ (backup.features.map(normalizeCollection).filter(Boolean));
  const kind = (/** @type {CollectionKind} */ k) => all.filter(c => c.properties.kind === k);
  const favorites = kind('favorites').reduce((n, c) => n + c.properties.plants.length, 0);
  const lists = kind('list').length, places = kind('place').length;
  const notes = (backup.sheetNotes || []).reduce((n, b) => n + Object.keys(b?.texts || {}).length, 0);
  return favorites || lists || places || notes ? { savedAt: backup.savedAt, favorites, lists, places, notes } : null;
}

/**
 * What a backup copy holds, in words: « vos favoris (2 plantes), 1 liste, 3 lieux et 1 note de fiche » — the
 * same before a repair (its dialog) and after it (what came back). @param {Omit<BackupSummary, 'savedAt'>} s
 */
export function backupContents(s) {
  const count = (/** @type {number} */ n, /** @type {string} */ one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
  return joined([s.favorites ? `vos favoris (${plantCount(s.favorites)})` : '', s.lists ? count(s.lists, 'liste') : '',
    s.places ? count(s.places, 'lieu', 'lieux') : '', s.notes ? count(s.notes, 'note de fiche', 'notes de fiche') : ''].filter(Boolean));
}

/** Things said in one breath: « a, b et c » ('' for none). @param {string[]} items */
function joined(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items.at(-1)}` : items[0] ?? '';
}

/**
 * Favourites, lists and places counted in the same words: « vos favoris (2 plantes), 1 liste et 3 lieux » — the
 * favourites named apart, being neither a list nor a place (docs/LEXIQUE.md), and not at all once emptied. '': nothing.
 * @param {Array<{ id?: unknown, geometry?: unknown, properties?: { plants?: unknown[] } }>} all collections, or the
 *   features of a portable file (an export, a transfer link, the backup copy)
 * @param {number} [notes] the texts of the sheet's Note blocks that go along (a transfer link), counted last
 */
export function keptContents(all, notes = 0) {
  const others = all.filter(c => c.id !== FAVORITES_ID);
  const places = others.filter(c => c.geometry).length;
  const favorites = all.reduce((n, c) => n + (c.id === FAVORITES_ID ? c.properties?.plants?.length ?? 0 : 0), 0);
  return backupContents({ favorites, lists: others.length - places, places, notes });
}

/**
 * The backup copy as a GeoJSON file, without IndexedDB (Réglages › Mes plantes › « Importer un fichier… » reads it
 * back): what to keep before the database is erased, or when it cannot be. False: no copy.
 */
export function downloadBackup() {
  const backup = readBackup();
  if (!backup) return false;
  const file = { type: 'FeatureCollection', name: 'GeoFlora — copie de secours', generator: 'GeoFlora', formatVersion: FORMAT_VERSION,
    exportedAt: backup.savedAt, features: backup.features, ...(backup.sheetNotes?.length ? { sheetNotes: backup.sheetNotes } : {}) };
  download(new File([JSON.stringify(file)], `geoflora-copie-de-secours-${backup.savedAt.slice(0, 10)}.geojson`, { type: 'application/geo+json' }));
  return true;
}

/**
 * Storage health, for the diagnostic in Réglages.
 * @returns {Promise<{ dbVersion: number | null, kept: string, persisted: boolean | null,
 *   usage: number | null, quota: number | null, backupAt: string | null, backupKept: string,
 *   markedHasSpots: boolean, lastExport: string | null }>} kept, backupKept: what the base and the backup copy hold
 *   (keptContents)
 */
export async function storageReport() {
  const [conn, all, persisted, estimate] = await Promise.all([
    db.openDb().catch(() => null),
    listCollections().catch(() => []),
    navigator.storage?.persisted?.().catch(() => null) ?? null,
    navigator.storage?.estimate?.().catch(() => null) ?? null
  ]);
  const backup = readBackup();
  return {
    dbVersion: conn?.version ?? null,
    kept: keptContents(all),
    persisted: persisted ?? null,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    backupAt: backup?.savedAt ?? null,
    backupKept: keptContents(backup?.features ?? []),
    markedHasSpots: hasSpots(),
    lastExport: lastExportDate()
  };
}

/** Asks for persistent storage now (from a button: a user gesture). @returns {Promise<boolean | null>} granted */
export async function protectStorage() {
  await requestPersistence();
  try { return await navigator.storage.persisted(); } catch { return null; }
}

// ── GeoJSON export / import ───────────────────────────────────────────────

/**
 * What a file of these collections says of the user, before it goes to the phone's share sheet: their positions
 * (positionWords), their notes, their harvest logs. null when it says none of these. Pure.
 * @param {Collection[]} cs @returns {{ title: string, text: string, yes: string } | null}
 */
export function fileQuestion(cs) {
  const parts = cs.filter(c => c.geometry).map(positionWords);
  if (cs.some(c => c.properties.notes.trim() || c.properties.plants.some(e => e.notes.trim()))) parts.push('vos notes');
  if (cs.some(c => c.properties.plants.some(e => e.harvests.length))) parts.push('vos journaux de récolte');
  return parts.length ? { title: 'Envoyer ce fichier ?', text: `Le fichier contient ${joined(parts)}.`, yes: 'Envoyer' } : null;
}

/**
 * Exports every collection (or only `only`) as a GeoJSON FeatureCollection file: downloaded, or (a phone) handed to its
 * share sheet. One collection exported (its own file, `only`) is written as the user's own (no origin: on another
 * device, « Recommencer » takes nothing of it), and is theirs once the file went out (promotePlace) — the favourites:
 * their matches'. Handed to the share sheet, what it says of the user is asked first (`ask`: gf-ask.js confirmAsk;
 * fileQuestion); a download is not asked. Refused or cancelled: nothing changes. Everything (Réglages): as stored, the
 * origins with it (another device's « Recommencer » counts them).
 * @param {Collection[]} [only] @param {{ ask?: (q: { title: string, text: string, yes: string }) => Promise<boolean> }} [options]
 */
export async function exportGeoJSON(only, { ask } = {}) {
  const features = (only ? only.map(c => madeHere(c) ? promoted(c) : c) : await listCollections())
    .sort((a, b) => a.properties.createdAt.localeCompare(b.properties.createdAt));
  // Everything (not one collection): the plant sheet's notes with it, so the file restores them too.
  const collection = toPortable(features, { name: only?.length === 1 ? 'GeoFlora — ' + placeTitle(only[0]) : 'GeoFlora — mes plantes', sheetNotes: only ? undefined : exportNotes() });
  const date = new Date().toISOString().slice(0, 10);
  const slug = only?.length === 1
    ? placeTitle(only[0]).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
    : 'mes-plantes';
  const file = new File([JSON.stringify(collection)], `geoflora-${slug}-${date}.geojson`, { type: 'application/geo+json' });

  const sheet = navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches;
  const cancelled = { count: features.length, kept: keptContents(features), cancelled: true };
  if (sheet && only && ask) {
    const q = fileQuestion(features);
    if (q && !await ask(q)) return cancelled;
  }
  try {
    if (sheet) await navigator.share({ files: [file], title: 'Lieux de récolte GeoFlora' });
    else download(file);
  } catch (error) {
    if (/** @type {Error} */ (error).name === 'AbortError') return cancelled;
    download(file);
  }
  if (only) {
    // Gone out (shared, downloaded): the user's own here too.
    for (const c of only) if (madeHere(c)) await promotePlace(c.id);
  } else {
    writeText(config.storageKeys.lastExport, new Date().toISOString());
  }
  return { count: features.length, kept: keptContents(features), cancelled: false };
}

/** @param {File} file */
function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @returns {string | null} */
export function lastExportDate() {
  return readText(config.storageKeys.lastExport);
}

/** Merges a decoded transfer link (slim GeoJSON), its sheet notes included. @param {{ features: any[], sheetNotes?: any[] }} featureCollection */
export async function importPortable(featureCollection) {
  const notes = await importNotes(featureCollection.sheetNotes);
  return { ...(await importFeatures(featureCollection.features)), notes };
}

/**
 * Link carrying every collection, to open on another device (#/shared?d=g…).
 * @param {{ personal: boolean }} options personal: include notes and harvest logs
 * @returns {Promise<{ url: string, count: number, kept: string }>} kept: what it carries, in words (keptContents)
 */
export async function transferLink({ personal }) {
  const all = (await listCollections()).filter(c => c.properties.plants.length || c.properties.kind !== 'favorites');
  const data = await encodePortable(toPortable(all, { personal, sheetNotes: personal ? exportNotes() : undefined }));
  return { url: '#/shared?d=' + data, count: all.length, kept: keptContents(all) };
}

/**
 * Portable files and links carry plants by TAXREF id only: put the names back from the local flora.
 * Plants given by scientific name only (older files) get their id when the flora knows them.
 * @param {Collection[]} collections @param {any[]} plants the dataset
 */
function fillNames(collections, plants) {
  const byId = new Map(plants.map(plant => [plant.id, plant]));
  const byName = new Map(plants.map(plant => [plant.scientificName.toLowerCase(), plant]));
  for (const c of collections) {
    for (const entry of c.properties.plants) {
      const plant = entry.plantId !== null ? byId.get(entry.plantId) : entry.scientificName ? byName.get(entry.scientificName.toLowerCase()) : null;
      if (!plant) continue;
      entry.plantId = plant.id;
      if (!entry.scientificName) entry.scientificName = plant.scientificName;
      entry.vernacularName ??= plant.vernacularNames?.[0] || null;
    }
    c.properties.plantIds = plantIdsOf(c.properties.plants);
  }
}

/**
 * Merges a GeoJSON file into the local places: same id → the most recently updated wins.
 * Accepts both the current format (properties.plants) and the first one (one plant per feature).
 * Plants without a TAXREF id are matched by scientific name.
 * The plant sheet's notes it carries are merged too (`notes`: how many were added or updated).
 * @param {File} file
 * @returns {Promise<{ added: number, updated: number, unchanged: number, skipped: number, notes: number }>}
 */
export async function importGeoJSON(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Ce fichier n’est pas un GeoJSON valide.');
  }
  const features = data?.type === 'FeatureCollection' ? data.features : data?.type === 'Feature' ? [data] : null;
  if (!Array.isArray(features)) throw new Error('Le fichier ne contient pas de FeatureCollection GeoJSON.');
  const notes = await importNotes(data.sheetNotes);
  return { ...(await importFeatures(features)), notes };
}

/**
 * Merges features (GeoJSON or collections) into the local ones, each collection read and written in one transaction:
 * a new one is added; one this device has gets the newer copy's fields and the plants of both copies (place-model.js
 * mergeCollections: a plant added on either device is never dropped, harvest logs are joined).
 * @param {any[]} features
 * @returns {Promise<{ added: number, updated: number, unchanged: number, skipped: number }>}
 */
async function importFeatures(features) {
  const plants = await db.getAll('plants');
  const result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  /** @type {Map<string, Collection>} the same id twice in a file: both copies, merged */
  const incoming = new Map();
  for (const feature of features) {
    const place = normalizeCollection(feature);
    if (!place) { result.skipped++; continue; }
    if (place.geometry) place.geometry.coordinates = roundCoordinates(place.geometry.coordinates);
    fillNames([place], plants);
    const before = incoming.get(place.id);
    incoming.set(place.id, before ? mergeCollections(before, place) : place);
  }
  if (!incoming.size) return result;

  const outcomes = await db.updateMany('spots', [...incoming.keys()], (record, id) => {
    const place = /** @type {Collection} */ (incoming.get(/** @type {string} */ (id)));
    const current = read(record);
    if (!current) return { kind: 'added', record: { ...place, properties: { ...place.properties, plantIds: plantIdsOf(place.properties.plants) } } };
    const merged = mergeCollections(current, place);
    if (sameContent(merged, current)) return undefined;
    // Made here, from both copies: dated now (imported back elsewhere, it is the newer copy).
    const updatedAt = sameContent(merged, place) ? place.properties.updatedAt : new Date().toISOString();
    return { kind: 'updated', record: { ...merged, properties: { ...merged.properties, updatedAt } } };
  }, outcome => outcome?.record);
  for (const outcome of outcomes) {
    if (!outcome) result.unchanged++;
    else result[/** @type {'added' | 'updated'} */ (outcome.kind)]++;
  }
  if (result.added || result.updated) {
    markHasSpots();
    await changed();
  }
  return result;
}
