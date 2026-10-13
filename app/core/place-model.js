// @ts-check
// Shape of a collection of plants (favorites, list or place), shared by the database upgrade,
// the app and GeoJSON import. A place is a collection with a Point; lists have `geometry: null`.
// No imports: db.js uses it during schema upgrades.

/**
 * @typedef {{ date: string, quantity?: string, note?: string }} Harvest
 * @typedef {'rare' | 'moyen' | 'abondant'} Abundance
 * @typedef {object} PlantEntry          one plant growing at a place — in a place, the same species may be noted
 *                                       several times (along a walk), each occurrence its own entry
 * @property {string} id                 the entry's own id (stable; « p<plantId> » for entries older than it)
 * @property {number | null} plantId
 * @property {string} scientificName
 * @property {string | null} vernacularName
 * @property {Abundance} abundance
 * @property {number} rating             0–5
 * @property {string} notes
 * @property {string} addedAt
 * @property {Harvest[]} harvests        newest first
 * @property {[number, number] | null} coordinates   where this plant grows [lon, lat]; null outside places
 * @property {number | null} accuracy    GPS accuracy (m) when recorded
 * @property {Altitude | null} altitude  the ground's altitude where it grows (none yet: asked of the IGN when online)
 * @property {Origin} [origin]           made by a mini-app (a favourite of a match): « Recommencer » it, and it goes
 * @property {Origin} [from]             made by a mini-app, then made the user's own (promoted): « Recommencer » keeps it
 * @typedef {{ app: string }} Origin     the mini-app that made an entry or a collection (app/miniapps/<app>.js)
 * @typedef {{ m: number | null, at: [number, number] }} Altitude   metres (RGE ALTI®; null: no data there) at the
 *                                       point `at` — the altitude of that point only: moved, it is asked again
 * @typedef {'favorites' | 'list' | 'place'} CollectionKind
 * @typedef {object} PlaceProperties
 * @property {CollectionKind} kind
 * @property {string} name
 * @property {string} notes
 * @property {number | null} accuracy    GPS accuracy (m) when recorded
 * @property {Altitude | null} altitude  the place's point's
 * @property {boolean} [startedHere]     a parcours started where the walker stood: its point is the walk's first step
 * @property {Origin} [origin]           made by a mini-app (a parcours): « Recommencer » it, and it goes
 * @property {Origin} [from]             made by a mini-app, then made the user's own (a parcours finished, renamed…): kept
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {PlantEntry[]} plants
 * @property {number[]} plantIds         derived from `plants`, indexed (multiEntry) for "places of a plant"
 * @typedef {{ type: 'Point', coordinates: [number, number] }} PointGeometry
 * @typedef {{ type: 'Feature', id: string, geometry: PointGeometry | null, properties: PlaceProperties }} Collection
 * @typedef {Collection} Place   a collection, usually with a location
 */

export const FAVORITES_ID = 'favorites';
const KINDS = ['favorites', 'list', 'place'];

const ABUNDANCES = ['rare', 'moyen', 'abondant'];

const isNumber = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/** The origin of an entry or a collection, as stored or read from a file: { app } with a mini-app's id, else none. @param {any} o @returns {Origin | null} */
export const validOrigin = o => o && typeof o === 'object' && typeof o.app === 'string' && /^[a-z][a-z0-9-]{1,23}$/.test(o.app) ? { app: o.app } : null;
const text = (/** @type {unknown} */ v, max = 5000) => typeof v === 'string' ? v.slice(0, max) : '';

/** @param {any[]} list @returns {Harvest[]} */
export const normalizeHarvests = list => (Array.isArray(list) ? list : [])
  .filter(h => h && /^\d{4}-\d{2}-\d{2}/.test(h.date))
  .map(h => ({ date: String(h.date).slice(0, 10), quantity: text(h.quantity, 200), note: text(h.note, 1000) }))
  .sort((a, b) => b.date.localeCompare(a.date));

/**
 * The altitude kept with a position: only while it is the altitude of that very position (a plant or a place
 * moved has its altitude asked again). @param {unknown} a @param {[number, number] | null} at @returns {Altitude | null}
 */
export function validAltitude(a, at) {
  // A file or a link: the altitude alone, that of the position it comes with.
  const v = typeof a === 'number' ? { m: a, at } : /** @type {any} */ (a);
  if (!at || !v || typeof v !== 'object' || !Array.isArray(v.at) || v.at[0] !== at[0] || v.at[1] !== at[1]) return null;
  if (v.m !== null && !(isNumber(v.m) && v.m > -500 && v.m < 9000)) return null;
  return { m: v.m === null ? null : Math.round(v.m), at: [at[0], at[1]] };
}

/** 7 decimals ≈ 1 cm. @param {unknown} c @returns {[number, number] | null} */
export function validCoordinates(c) {
  if (!Array.isArray(c) || !isNumber(c[0]) || !isNumber(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) return null;
  return [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7];
}

/**
 * @param {any} e @param {string} fallbackDate
 * @param {[number, number] | null} [placeCoordinates] the place's point: plants of a place always have a
 *   position (their own, else the place's); plants of lists have none.
 * @returns {PlantEntry}
 */
export function normalizeEntry(e, fallbackDate, placeCoordinates = null) {
  const own = placeCoordinates ? validCoordinates(e?.coordinates) : null;
  const coordinates = own || (placeCoordinates ? /** @type {[number, number]} */ ([placeCoordinates[0], placeCoordinates[1]]) : null);
  const plantId = isNumber(e?.plantId) ? e.plantId : null;
  return {
    // Entries from before occurrences had no id: one derived from the plant, the same at every read.
    id: typeof e?.id === 'string' && ENTRY_ID.test(e.id) ? e.id : 'p' + (plantId ?? text(e?.scientificName, 40).replace(/[^\w-]+/g, '_')),
    plantId,
    scientificName: text(e?.scientificName, 300),
    vernacularName: e?.vernacularName ? text(e.vernacularName, 300) : null,
    abundance: ABUNDANCES.includes(e?.abundance) ? e.abundance : 'moyen',
    rating: isNumber(e?.rating) ? Math.max(0, Math.min(5, Math.round(e.rating))) : 0,
    notes: text(e?.notes),
    addedAt: typeof e?.addedAt === 'string' ? e.addedAt : fallbackDate,
    harvests: normalizeHarvests(e?.harvests),
    coordinates,
    accuracy: own && isNumber(e?.accuracy) ? e.accuracy : null,
    altitude: validAltitude(e?.altitude, coordinates),
    ...(validOrigin(e?.origin) ? { origin: /** @type {Origin} */ (validOrigin(e.origin)) } : {}),
    ...(validOrigin(e?.from) ? { from: /** @type {Origin} */ (validOrigin(e.from)) } : {})
  };
}

const ENTRY_ID = /^[\w-]{1,48}$/;

/** A new entry id: unique on this device (time + random). */
export const newEntryId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Entry ids unique within a collection (an import may repeat one): the later ones get a suffix, the same each time. @param {PlantEntry[]} plants */
function uniqueIds(plants) {
  const seen = new Set();
  return plants.map(e => {
    let id = e.id;
    for (let n = 2; seen.has(id); n++) id = `${e.id}-${n}`.slice(-48);
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

/** @param {PlantEntry[]} plants */
export const plantIdsOf = plants => [...new Set(plants.map(p => p.plantId).filter(isNumber))];

/**
 * Brings any stored or imported collection to the current shape. Accepts the first format,
 * where a spot held a single plant directly in its properties (plantId, abundance, harvests…),
 * and features without geometry (lists). Returns null when the feature is unusable.
 * @param {any} feature
 * @returns {Collection | null}
 */
export function normalizeCollection(feature) {
  if (feature?.type !== 'Feature') return null;

  /** @type {PointGeometry | null} */
  let geometry = null;
  if (feature.geometry) {
    if (feature.geometry.type !== 'Point') return null;
    const [lon, lat] = feature.geometry.coordinates || [];
    if (!isNumber(lon) || !isNumber(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    geometry = { type: 'Point', coordinates: [lon, lat] };
  }

  const p = feature.properties || {};
  const now = new Date().toISOString();
  const createdAt = typeof p.createdAt === 'string' ? p.createdAt : now;

  // Without geometry, only lists (and favorites) make sense.
  const id = typeof feature.id === 'string' && feature.id ? feature.id : (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
  let kind = KINDS.includes(p.kind) ? p.kind : geometry ? 'place' : 'list';
  if (id === FAVORITES_ID) kind = 'favorites';
  else if (kind === 'favorites') kind = 'list';
  if (kind === 'place' && !geometry) kind = 'list';
  if (kind !== 'place') geometry = null;
  const placePoint = geometry ? geometry.coordinates : null;

  /** @type {PlantEntry[]} */
  let plants;
  if (Array.isArray(p.plants)) {
    plants = uniqueIds(p.plants.map(e => normalizeEntry(e, createdAt, placePoint)).filter(e => e.plantId !== null || e.scientificName));
  } else if (isNumber(p.plantId) || p.scientificName) {
    // Format 1: one plant per spot, its fields at the top level (its position is the spot's).
    plants = [normalizeEntry({ ...p, coordinates: null, addedAt: createdAt }, createdAt, placePoint)];
  } else {
    plants = [];
  }

  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      kind,
      name: kind === 'favorites' ? 'Favoris' : text(p.name ?? p.label, 300),
      // Format 1 notes belonged to the single plant; they now live on its entry.
      notes: Array.isArray(p.plants) ? text(p.notes) : '',
      accuracy: geometry && isNumber(p.accuracy) ? p.accuracy : null,
      altitude: validAltitude(p.altitude, placePoint),
      ...(geometry && p.startedHere === true ? { startedHere: true } : {}),
      ...(kind !== 'favorites' && validOrigin(p.origin) ? { origin: /** @type {Origin} */ (validOrigin(p.origin)) } : {}),
      ...(kind !== 'favorites' && validOrigin(p.from) ? { from: /** @type {Origin} */ (validOrigin(p.from)) } : {}),
      createdAt,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
      plants,
      plantIds: plantIdsOf(plants)
    }
  };
}

// ── Two copies of a collection ──────────────────────────────────────────────

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);
const harvestKey = (/** @type {Harvest} */ h) => JSON.stringify([h.date, h.quantity || '', h.note || '']);
const newestFirst = (/** @type {Harvest[]} */ list) => list.sort((a, b) => b.date.localeCompare(a.date));

/** The fields of a collection that are not edited (kept by the store, or derived). */
const DERIVED = new Set(['plants', 'plantIds', 'createdAt', 'updatedAt']);

/**
 * Kind and geometry agree (one side may have moved the point while the other made the place a list).
 * @param {Collection} c @returns {Collection}
 */
function consistent(c) {
  if (c.properties.kind === 'place' && !c.geometry) return { ...c, properties: { ...c.properties, kind: 'list' } };
  if (c.properties.kind !== 'place' && c.geometry) return { ...c, geometry: null };
  return c;
}

/**
 * Harvest logs edited on two sides: those `mine` removed from `base` go, those it added come, the rest is `theirs`.
 * @param {Harvest[]} base @param {Harvest[]} mine @param {Harvest[]} theirs
 */
function rebaseHarvests(base, mine, theirs) {
  const mineKeys = new Set(mine.map(harvestKey));
  const baseKeys = new Set(base.map(harvestKey));
  const out = theirs.filter(h => mineKeys.has(harvestKey(h)) || !baseKeys.has(harvestKey(h)));
  const have = new Set(out.map(harvestKey));
  for (const h of mine) if (!baseKeys.has(harvestKey(h)) && !have.has(harvestKey(h))) { out.push(h); have.add(harvestKey(h)); }
  return newestFirst(out);
}

/** @param {PlantEntry} base @param {PlantEntry} mine @param {PlantEntry} theirs @returns {PlantEntry} */
function rebaseEntry(base, mine, theirs) {
  if (same(base, mine)) return theirs;
  /** @type {any} */
  const out = { ...theirs };
  for (const key of /** @type {(keyof PlantEntry)[]} */ (Object.keys(mine))) {
    if (key === 'id' || key === 'harvests') continue;
    if (!same(base[key], mine[key])) out[key] = mine[key];
  }
  out.harvests = rebaseHarvests(base.harvests, mine.harvests, theirs.harvests);
  return out;
}

/**
 * The edits made on a copy, applied to the stored record as it is now (a three-way merge, field by field):
 * `base` the record as the editor read it, `mine` as edited, `theirs` as stored now (changed meanwhile by another
 * tab, « Noter ici », the altitudes…). What `mine` changed wins; everything else stays as `theirs` has it — a plant
 * added elsewhere, a harvest noted elsewhere, a name changed elsewhere are all kept. Plants are matched by entry id.
 * @param {Collection} base @param {Collection} mine @param {Collection} theirs @returns {Collection}
 */
export function rebase(base, mine, theirs) {
  if (same(base, mine)) return theirs;
  const geometry = same(base.geometry, mine.geometry) ? theirs.geometry : mine.geometry;
  /** @type {any} */
  const properties = { ...theirs.properties };
  const b = /** @type {any} */ (base.properties), m = /** @type {any} */ (mine.properties);
  for (const key of new Set([...Object.keys(b), ...Object.keys(m)])) {
    if (DERIVED.has(key) || same(b[key], m[key])) continue;
    if (key in m) properties[key] = m[key]; else delete properties[key];
  }
  const baseById = new Map(base.properties.plants.map(e => [e.id, e]));
  const mineById = new Map(mine.properties.plants.map(e => [e.id, e]));
  const plants = theirs.properties.plants
    // Removed here: gone (removed there too, or never there: nothing to do).
    .filter(e => !(baseById.has(e.id) && !mineById.has(e.id)))
    .map(e => {
      const was = baseById.get(e.id), now = mineById.get(e.id);
      return was && now ? rebaseEntry(was, now, e) : e;
    });
  const there = new Set(plants.map(e => e.id));
  for (const e of mine.properties.plants) if (!baseById.has(e.id) && !there.has(e.id)) plants.push(e);
  return consistent({ ...theirs, geometry, properties: { ...properties, plants, plantIds: plantIdsOf(plants) } });
}

/**
 * Two copies of the same collection from two devices (an import, a transfer link, the backup copy): the newer
 * one's fields, and the plants of both — none is dropped for being missing from the other copy. A plant both have
 * (the same occurrence; in a list, the same plant) takes the newer copy's details, its harvest logs joined and its
 * notes kept where the newer copy has none (a link shared without them).
 * @param {Collection} local @param {Collection} incoming @returns {Collection}
 */
export function mergeCollections(local, incoming) {
  const newer = incoming.properties.updatedAt > local.properties.updatedAt;
  const win = newer ? incoming : local, lose = newer ? local : incoming;
  const list = !win.geometry;
  /** @type {Set<PlantEntry>} */
  const used = new Set();
  /** @param {PlantEntry} e */
  const partner = e => {
    let other = lose.properties.plants.find(o => o.id === e.id && !used.has(o));
    if (!other && e.plantId !== null) {
      const theirs = lose.properties.plants.filter(o => o.plantId === e.plantId && !used.has(o));
      const ours = win.properties.plants.filter(o => o.plantId === e.plantId);
      // In a list a plant is there once; in a place, only an unambiguous pair (one occurrence each side).
      if (theirs.length && (list || (theirs.length === 1 && ours.length === 1))) other = theirs[0];
    }
    if (other) used.add(other);
    return other;
  };
  const plants = win.properties.plants.map(e => {
    const other = partner(e);
    if (!other) return e;
    const harvests = [...e.harvests];
    const have = new Set(harvests.map(harvestKey));
    for (const h of other.harvests) if (!have.has(harvestKey(h))) { harvests.push(h); have.add(harvestKey(h)); }
    return { ...e, notes: e.notes || other.notes, harvests: newestFirst(harvests) };
  });
  for (const e of lose.properties.plants) {
    if (used.has(e)) continue;
    // A list holds a plant once.
    if (list && plants.some(p => p.plantId !== null && p.plantId === e.plantId)) continue;
    const point = win.geometry?.coordinates;
    plants.push(!point ? { ...e, coordinates: null, accuracy: null, altitude: null } : e.coordinates ? e : { ...e, coordinates: point });
  }
  return consistent({ ...win, properties: { ...win.properties, notes: win.properties.notes || lose.properties.notes, plants, plantIds: plantIdsOf(plants) } });
}

/** The same content, the dates of change aside. @param {Collection} a @param {Collection} b */
export const sameContent = (a, b) =>
  same({ ...a, properties: { ...a.properties, updatedAt: '' } }, { ...b, properties: { ...b.properties, updatedAt: '' } });

// ── What a mini-app made ────────────────────────────────────────────────────
// A mini-app marks what it makes in Mes plantes (`origin`): a favourite of a match, a parcours and its plants.
// « Recommencer » it, and that goes — unless the user made it their own meanwhile (« promoted »: its origin dropped,
// `from` kept to say where it came from): a parcours finished with plants, or renamed, edited or added to from Mes
// plantes, shared or exported; a favourite then put in a collection or given a note.

/**
 * @typedef {{ favorites: PlantEntry[], collections: { id: string, name: string, plants: number }[], kept: { favorites: number, collections: number } }} Made
 */

/** Its own, the user's: the origin dropped (`from` says where it came from), for the collection and its entries. Pure. @param {Collection} c @returns {Collection} */
export function promoted(c) {
  const app = c.properties.origin?.app;
  const plants = c.properties.plants.map(e => e.origin ? promotedEntry(e) : e);
  const { origin, ...rest } = c.properties;
  void origin;
  return { ...c, properties: { ...rest, ...(app ? { from: { app } } : {}), plants } };
}

/** An entry made the user's own (origin dropped, `from` kept). Pure. @param {PlantEntry} e @returns {PlantEntry} */
export function promotedEntry(e) {
  const { origin, ...rest } = e;
  return origin ? { ...rest, from: { app: origin.app } } : e;
}

/**
 * A change to a collection by the user (not by the mini-app that made it): anything but the altitudes the app asks for
 * in the background — its name, its notes, its plants and what is said of them. Pure.
 * @param {Collection} before @param {Collection} after
 */
export function userChange(before, after) {
  const plain = (/** @type {Collection} */ c) => JSON.stringify({ geometry: c.geometry, name: c.properties.name, notes: c.properties.notes,
    plants: c.properties.plants.map(({ altitude, ...e }) => { void altitude; return e; }) });
  return plain(before) !== plain(after);
}

/**
 * What a mini-app made in Mes plantes, still its own (« Recommencer » takes it away, the confirmation says it): the
 * favourites its matches added (entries of the favourites with its origin — not a favourite set elsewhere, nor one
 * already there before the match), and the collections it made (a parcours under way); and what came from it but the
 * user made their own (kept: counted for the confirmation). Pure.
 * @param {Collection[]} collections @param {string} app @returns {Made}
 */
export function madeBy(collections, app) {
  const mine = (/** @type {{ origin?: Origin }} */ x) => x.origin?.app === app;
  const was = (/** @type {{ from?: Origin }} */ x) => x.from?.app === app;
  const favs = collections.filter(c => c.id === FAVORITES_ID).flatMap(c => c.properties.plants);
  const others = collections.filter(c => c.id !== FAVORITES_ID);
  return {
    favorites: favs.filter(mine),
    collections: others.filter(c => mine(c.properties)).map(c => ({ id: c.id, name: c.properties.name, plants: c.properties.plants.length })),
    kept: { favorites: favs.filter(was).length, collections: others.filter(c => was(c.properties)).length }
  };
}

/**
 * A collection without what a mini-app made: null when it made the collection itself (to delete), else the
 * collection without the entries it added (the same object when there is none). Pure.
 * @param {Collection} c @param {string} app @returns {Collection | null}
 */
export function withoutMadeBy(c, app) {
  if (c.id !== FAVORITES_ID && c.properties.origin?.app === app) return null;
  const plants = c.properties.plants.filter(e => e.origin?.app !== app);
  return plants.length === c.properties.plants.length ? c : { ...c, properties: { ...c.properties, plants, plantIds: plantIdsOf(plants) } };
}

/**
 * The origins of what the mini-apps made before they were recorded (best effort, once): a favourite whose plant is
 * among a game's matches (`matches`, by mini-app, the first one listed wins) is that game's; the parcours under way
 * (`walk`), and a parcours kept (`walks`) or started where the walker stood (a parcours' mark) with no plant, are the
 * Parcours'; one with plants was finished, its own already: promoted (kept). Returns the collections changed. Pure.
 * @param {Collection[]} collections @param {{ matches: [string, number[]][], walks: string[], walk?: string | null }} known @returns {Collection[]}
 */
export function tagLegacy(collections, { matches, walks, walk = null }) {
  /** @type {Collection[]} */
  const out = [];
  for (const c of collections) {
    if (c.id === FAVORITES_ID) {
      let changed = false;
      const plants = c.properties.plants.map(e => {
        if (e.origin || e.from || e.plantId === null) return e;
        const app = matches.find(([, ids]) => ids.includes(/** @type {number} */ (e.plantId)))?.[0];
        if (!app) return e;
        changed = true;
        return { ...e, origin: { app } };
      });
      if (changed) out.push({ ...c, properties: { ...c.properties, plants } });
      continue;
    }
    const p = c.properties;
    if (p.origin || p.from) continue;
    const parcours = c.id === walk || walks.includes(c.id) || (p.kind === 'place' && p.startedHere === true);
    if (!parcours) continue;
    const draft = c.id === walk || !p.plants.length;
    out.push({ ...c, properties: { ...p, ...(draft ? { origin: { app: 'parcours' } } : { from: { app: 'parcours' } }) } });
  }
  return out;
}
