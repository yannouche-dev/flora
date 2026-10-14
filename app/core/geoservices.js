// @ts-check
// IGN Géoplateforme services (free, no key): address search, nearest address, altitude.
// Point lookups are cached in IndexedDB so places already seen keep their address and altitude offline.

import * as cache from './cache.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { candidateOf, normalize, parsePlace, pickCommune, rankPlaces } from './place-find.js';

const GEOCODING = 'https://data.geopf.fr/geocodage';
const ALTIMETRY = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
/** Addresses and altitudes hardly change: keep them a year. */
const TTL = 365 * 24 * 3600 * 1000;

/** @typedef {{ label: string, detail: string, coordinates: [number, number], kind: string }} GeoResult */

/** @param {string} url @param {AbortSignal} [signal] @param {(data: any) => boolean} [expect] */
const json = (url, signal, expect) => fetchJson(url, { signal, expect });

/** A GeoJSON answer (WFS, geocoding): its `features` a list. @param {any} d */
const features = d => Array.isArray(d.features);

const key5 = (/** @type {[number, number]} */ [lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/**
 * Cached a year (core/cache.js); `partial`: the answer is degraded (kept a few minutes only).
 * @template T @param {string} key @param {() => Promise<T>} load @param {(value: T) => boolean} [partial] @returns {Promise<T>}
 */
const cached = (key, load, partial) => cache.cached(key, load, { ttl: TTL, partial });

const KINDS = { municipality: 'Commune', locality: 'Lieu-dit', street: 'Voie', housenumber: 'Adresse', administratif: 'Commune' };

/**
 * Suggestions while typing: addresses, localities (lieux-dits), communes, points of interest.
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<GeoResult[]>}
 */
export async function searchPlaces(text, signal) {
  const q = text.trim();
  if (q.length < 3) return [];
  if (!moduleOn('ignGeo')) throw new ModuleOffError('ignGeo');
  const data = await json(`${GEOCODING}/completion?text=${encodeURIComponent(q)}&maximumResponses=6`, signal, d => Array.isArray(d.results));
  return (data.results || [])
    .filter(r => Number.isFinite(r.x) && Number.isFinite(r.y))
    .map(r => {
      const [label, ...rest] = String(r.fulltext || '').split(', ');
      return {
        label: label || r.fulltext,
        detail: rest.join(', ') || r.zipcode || '',
        coordinates: /** @type {[number, number]} */ ([r.x, r.y]),
        kind: KINDS[r.kind] || (r.country === 'PositionOfInterest' ? 'Lieu' : 'Adresse')
      };
    });
}

/**
 * A place typed as words (« mirabel, menetrol, 63 », « Fontainebleau 77 »: core/place-find.js reads them): the first
 * suggestion of the map's search bar for them (firstSuggestion); none, or that service down: the geocoder's search
 * (GeoJSON, ranked by core/place-find.js): the commune said first, when one is (`index=address&type=municipality`), then
 * the places of that name (`index=poi`: lieux-dits, summits, hills… — around the commune's centre when there is one,
 * the geocoder favouring the nearest) and, no commune said, the communes of that name too (both at once). Null: none
 * fits. Cached a year once found (a place's point hardly moves); « none » only a few minutes (asked again on a reload).
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./place-find.js').FoundPlace | null>}
 */
export function findPlace(text, signal) {
  const q = parsePlace(text);
  if (!q) return Promise.resolve(null);
  if (!moduleOn('ignGeo')) return Promise.reject(new ModuleOffError('ignGeo'));
  return cache.cached(`geo:first:${normalize(q.text)}`, async () => {
    const first = await firstSuggestion(q, signal).catch(e => { if (signal?.aborted) throw e; return null; });
    return first ?? searchPlace(q, signal);
  }, { ttl: TTL, partial: v => !v, signal });
}

/**
 * The words asked as the map's search bar asks them (/geocodage/completion: lieux-dits, communes, addresses), its
 * first suggestion kept — the name and its commune first (« Mirabel Ménétrol »), then the name alone; a département
 * said: the first one in it (its postcode). Null: none.
 * @param {import('./place-find.js').PlaceQuery} q @param {AbortSignal} [signal]
 * @returns {Promise<import('./place-find.js').FoundPlace | null>}
 */
async function firstSuggestion(q, signal) {
  const tries = [...new Set([[q.name, q.commune].filter(Boolean).join(' '), q.name])].filter(t => t.trim().length >= 3);
  for (const words of tries) {
    const data = await json(`${GEOCODING}/completion?text=${encodeURIComponent(words)}&maximumResponses=10`, signal, d => Array.isArray(d.results));
    const hit = (data.results || []).find(r => Number.isFinite(r.x) && Number.isFinite(r.y)
      && (!q.dept || String(r.zipcode ?? '').startsWith(/^2[AB]$/i.test(q.dept) ? '20' : q.dept)));
    if (hit) {
      const [name, ...rest] = String(hit.fulltext || '').split(', ');
      const city = String(hit.city || rest.find(x => !/^\d/.test(x)) || '').trim();
      const label = city && normalize(city) !== normalize(name) ? `${name} (${city})` : name;
      const kind = hit.kind === 'municipality' || hit.kind === 'administratif' ? 'municipality' : 'poi';
      return { label: label.slice(0, 80), coordinates: /** @type {[number, number]} */ ([hit.x, hit.y]), kind };
    }
  }
  return null;
}

/**
 * No suggestion: the geocoder's search, ranked (core/place-find.js).
 * @param {import('./place-find.js').PlaceQuery} q @param {AbortSignal} [signal]
 * @returns {Promise<import('./place-find.js').FoundPlace | null>}
 */
function searchPlace(q, signal) {
  /** @param {string} params @returns {Promise<import('./place-find.js').Candidate[]>} */
  const search = async params => {
    const data = await json(`${GEOCODING}/search?${params}`, signal, features);
    return (data.features || []).map(candidateOf).filter(/** @returns {c is import('./place-find.js').Candidate} */ c => c !== null);
  };
  const towns = (/** @type {string} */ name) => search(`q=${encodeURIComponent(name)}&index=address&type=municipality&limit=20`);
  const places = (/** @type {[number, number] | null} */ near) => search(`q=${encodeURIComponent(q.name)}&index=poi&limit=20`
    + (near ? `&lon=${near[0].toFixed(5)}&lat=${near[1].toFixed(5)}` : ''));
  return cache.cached(`geo:find:${normalize(q.name)}|${normalize(q.commune ?? '')}|${q.dept ?? ''}`, async () => {
    if (q.commune) {
      const commune = pickCommune(q.commune, await towns(q.commune), q.dept);
      return rankPlaces(q, { pois: await places(commune?.coordinates ?? null), commune });
    }
    const [pois, communes] = await Promise.all([places(null), towns(q.name)]);
    return rankPlaces(q, { pois, communes });
  }, { ttl: TTL, partial: v => !v, signal });
}

/**
 * Nearest address (within ~500 m) and commune of a point, and its context (« 34, Hérault, Occitanie »).
 * @param {[number, number]} point [lon, lat]
 * @returns {Promise<{ label: string, city: string, distance: number, context: string } | null>}
 */
export function addressAt(point) {
  if (!moduleOn('ignGeo')) return Promise.resolve(null);
  return cached('geo:rev2:' + key5(point), async () => {
    const data = await json(`${GEOCODING}/reverse?lon=${point[0]}&lat=${point[1]}&limit=1`, undefined, features);
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const far = Number(p.distance) > 500;
    return { label: far ? p.city : p.label, city: p.city || '', distance: Number(p.distance) || 0, context: p.context || '' };
  });
}

/**
 * Ground altitude (RGE ALTI®), metres, or null where there is no data.
 * @param {[number, number]} point [lon, lat]
 * @returns {Promise<number | null>}
 */
export function altitudeAt(point) {
  if (!moduleOn('ignGeo')) return Promise.resolve(null);
  return cached('geo:alt:' + key5(point), async () => {
    const data = await json(`${ALTIMETRY}?lon=${point[0]}&lat=${point[1]}&resource=ign_rge_alti_wld&zonly=true`, undefined, d => Array.isArray(d.elevations));
    const z = data.elevations?.[0];
    const value = typeof z === 'object' ? z?.z : z;
    return Number.isFinite(value) && value > -1000 ? Math.round(value) : null;
  });
}

/** "45.76410, 4.83570" (lat, lon: the order GPS apps and search engines accept). @param {[number, number]} point */
export const formatCoordinates = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

const WFS = 'https://data.geopf.fr/wfs/ows';

/**
 * The outline of a French administrative area of GBIF's GADM (a région: « FRA.10_1 », a département:
 * « FRA.10.3_1 »), from IGN's ADMIN EXPRESS (generalised for maps), by its official name; null elsewhere or
 * when unknown. Lightened to a vertex every ~400 m, coordinates rounded to ~100 m. Cached a year.
 * @param {string} gid @param {string} name
 * @returns {Promise<{ type: 'Feature', geometry: any, properties: { name: string } } | null>}
 */
export function zoneShape(gid, name) {
  const level = /^FRA\./.test(gid || '') ? gid.split('.').length - 1 : 0;
  const type = level === 1 ? 'region' : level === 2 ? 'departement' : null;
  return type ? adminShape(type, name) : Promise.resolve(null);
}

/**
 * The outline of a French région or département by its official name (IGN ADMIN EXPRESS), lightened.
 * @param {'region' | 'departement'} type @param {string} name
 * @returns {Promise<{ type: 'Feature', geometry: any, properties: { name: string } } | null>}
 */
export function adminShape(type, name) {
  if (!name || !moduleOn('ignGeo')) return Promise.resolve(null);
  return cached(`geo:admin:${type}:${name}`, async () => {
    const q = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: `ADMINEXPRESS-COG-CARTO.LATEST:${type}`,
      outputFormat: 'application/json', count: '1', CQL_FILTER: `nom_officiel='${name.replace(/'/g, "''")}'`
    });
    const data = await json(`${WFS}?${q}`, undefined, features);
    const geometry = data.features?.[0]?.geometry;
    if (!geometry?.coordinates) return null;
    // [lon, lat] whatever the server's axis order (France: longitudes under 10°, latitudes over 41°).
    const flip = (/** @type {number[]} */ p) => Math.abs(p[0]) > 40 && Math.abs(p[1]) < 15;
    const first = /** @type {number[]} */ (geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0][0] : geometry.coordinates[0][0]);
    const swap = flip(first);
    // Lighter for a map's outline: a vertex every ~400 m at most (a région weighs over 1 MB in full).
    const ring = (/** @type {number[][]} */ r) => {
      /** @type {number[][]} */ const out = [];
      for (const [i, p] of r.entries()) {
        const q = (swap ? [p[1], p[0]] : [p[0], p[1]]).map(v => Math.round(v * 1000) / 1000);
        const last = out[out.length - 1];
        if (!last || i === r.length - 1 || Math.abs(last[0] - q[0]) + Math.abs(last[1] - q[1]) > 0.004) out.push(q);
      }
      return out.length >= 4 ? out : r.map(p => (swap ? [p[1], p[0]] : [p[0], p[1]]));
    };
    const coordinates = geometry.type === 'MultiPolygon'
      ? geometry.coordinates.map((/** @type {number[][][]} */ poly) => poly.map(ring))
      : geometry.coordinates.map(ring);
    return { type: 'Feature', geometry: { type: geometry.type, coordinates }, properties: { name } };
  });
}

// ── The finest name of a place ───────────────────────────────────────────────
// For a new parcours: the most precise name the IGN knows where you stand — a public forest you are in, a named
// wood or place nearby (BD TOPO), a hamlet or a neighbourhood — and the commune around it.

/** @param {string} typename @param {string} filter @param {number} count @param {AbortSignal} [signal] */
const wfsFeatures = async (typename, filter, count, signal) => {
  const q = new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: typename,
    outputFormat: 'application/json', COUNT: String(count), CQL_FILTER: filter });
  const get = async () => /** @type {any[]} */ ((await json(`${WFS}?${q}`, signal, features)).features);
  try {
    return await get();
  } catch (error) {
    // Too many requests at once (the map's tiles come from the same servers): once more, a moment later.
    if (signal?.aborted || ![429, 503].includes(/** @type {any} */ (error).status)) throw error;
    await new Promise(done => setTimeout(done, 1200 + Math.random() * 800));
    return get();
  }
};

/** Metres between two [lon, lat] points (equirectangular: fine at these distances). @param {number[]} a @param {number[]} b */
const metres = (a, b) => {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), y = b[1] - a[1];
  return Math.hypot(x, y) * 111320;
};

/**
 * How far a feature is from a point (0 inside its polygon): its geometry's nearest vertex otherwise.
 * Coordinates read as [lon, lat] whatever the server's axis order (France: latitudes over 41°).
 * @param {any} geometry @param {[number, number]} point
 */
function distanceTo(geometry, point) {
  if (!geometry?.coordinates) return Infinity;
  /** @param {number[]} p */
  const ll = p => (Math.abs(p[0]) > 40 && Math.abs(p[1]) < 15 ? [p[1], p[0]] : p);
  /** @type {number[][][]} */ let rings = [];
  if (geometry.type === 'Point') return metres(point, ll(geometry.coordinates));
  if (geometry.type === 'MultiPoint') return Math.min(...geometry.coordinates.map((/** @type {number[]} */ p) => metres(point, ll(p))));
  if (geometry.type === 'Polygon') rings = [geometry.coordinates[0]];
  else if (geometry.type === 'MultiPolygon') rings = geometry.coordinates.map((/** @type {number[][][]} */ poly) => poly[0]);
  else if (geometry.type === 'LineString') rings = [geometry.coordinates];
  else if (geometry.type === 'MultiLineString') rings = geometry.coordinates;
  let best = Infinity;
  for (const raw of rings) {
    const ring = raw.map(ll);
    // Inside (ray casting): no distance at all.
    if (geometry.type.endsWith('Polygon')) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return 0;
    }
    for (const p of ring) best = Math.min(best, metres(point, p));
  }
  return best;
}

/** Accents, case, hyphens aside: « Châtel-Guyon » = « chatel guyon ». @param {string} s */
const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-'’\s]+/g, ' ').trim();

/** « Forêt Domaniale de Fontainebleau » → « Forêt de Fontainebleau » (its everyday name). @param {string} name */
const everyday = name => name.trim()
  .replace(/^(Forêt|Bois)\s+(Domaniale|Communale|Intercommunale|Départementale|Régionale|Sectionn?ale|Indivise|Syndicale|Privée)\s+/i, (_, f) => f + ' ');

/** Words naming a kind of place, before its proper name, and how « à » goes with them (« en forêt », « au bois »…). */
const GENERIC = /** @type {Record<string, string>} */ ({
  forêt: 'en', bois: 'au', parc: 'au', jardin: 'au', square: 'au', puy: 'au', mont: 'au', col: 'au', pic: 'au', roc: 'au', rocher: 'au',
  signal: 'au', plateau: 'au', cirque: 'au', vallon: 'au', ravin: 'au', sentier: 'au', marais: 'au', massif: 'au', domaine: 'au', bec: 'au',
  vallée: 'à la', montagne: 'à la', crête: 'à la', gorge: 'à la', dune: 'à la', plage: 'à la', promenade: 'à la', roseraie: 'à la', coulée: 'à la',
  combe: 'à la', côte: 'à la', pointe: 'à la', dent: 'à la', cascade: 'à la', tourbière: 'à la', lande: 'à la', butte: 'à la', colline: 'à la',
  gorges: 'aux', rochers: 'aux', jardins: 'aux', monts: 'aux', puys: 'aux', landes: 'aux', étangs: 'aux',
  arboretum: 'à l’', étang: 'à l’', île: 'à l’', ile: 'à l’', aiguille: 'à l’', allée: 'à l’', espace: 'à l’',
  château: 'au', moulin: 'au', hameau: 'au', lac: 'au', prieuré: 'au', manoir: 'au', chalet: 'au', refuge: 'au', cimetière: 'au',
  ferme: 'à la', source: 'à la', fontaine: 'à la', chapelle: 'à la', grange: 'à la', abbaye: 'à l’', ermitage: 'à l’'
});

/**
 * « en forêt de Fontainebleau », « au bois de Vincennes », « au jardin des Plantes », « au puy de Dôme (Orcines) »,
 * « au Roc Errant (Châtel-Guyon) », « aux Ulis », « à La Bourboule » — the place after « Mon parcours botanique »:
 * the word naming its kind in lower case (French usage), « à » contracted; a lieu-dit, a hamlet, a summit with
 * their commune, unless their name says it. A commune's name is never touched but for « Le/Les » (« au Mont-Dore »).
 * @param {{ name: string, kind: string, commune: string }} place
 */
export function atPlace({ name, kind, commune }) {
  let n = name.trim(), at;
  const [first] = n.split(' ');
  const generic = kind !== 'commune' && GENERIC[first.toLowerCase()];
  if (generic) {
    n = first.toLowerCase() + n.slice(first.length);
    at = generic === 'à l’' ? 'à l’' + n : `${generic} ${n}`;
  } else if (/^le\s/i.test(n)) at = 'au ' + n.slice(3);
  else if (/^les\s/i.test(n)) at = 'aux ' + n.slice(4);
  else at = 'à ' + n;
  return ['spot', 'hamlet', 'relief'].includes(kind) && commune && !fold(n).includes(fold(commune)) ? `${at} (${commune})` : at;
}

/** How far around a point each kind of relief names it, metres (by its BD TOPO nature). @param {string} nature */
const reliefReach = nature => (/^(Vallée|Gorge|Cirque|Plaine|Dépression|Vallon)/i.test(nature) ? 700
  : /^(Montagne|Volcan|Crête|Dune|Plage|Cap|Ile|Île|Isthme|Plateau|Massif)/i.test(nature) ? 400 : 200);

/** How far a named wood (a point in the BD TOPO) names the place: as far as it is big (its `importance`, 3 = 2-5 km²… 6 = under 10 ha). @param {any} importance */
const woodReach = importance => ({ 3: 1200, 4: 800, 5: 300, 6: 150 })[Number(importance)] || 250;

/** A park, a garden, a square, an arboretum (a zone of activity or interest of the BD TOPO). @param {any} p */
const isPark = p => p.nature === 'Sentier de découverte' || p.nature === 'Parc zoologique'
  || /^(parcs?|jardins?|square|arboretum|promenade|roseraie|coulée verte|bois|forêt)\b/i.test(String(p.nature_detaillee || p.toponyme || ''));

/**
 * The finest name among what the IGN answered at `point` (`layers`: the features of each layer asked), and the
 * commune it lies in. In this order: a park or a garden you are in; a public forest you are in; a named wood near
 * enough for its size; a summit, a col, a valley; the nearest lieu-dit or hamlet (250 m); a neighbourhood you are
 * in; the commune. Historical names, unnamed or generic ones, and the commune's own name are left aside.
 * @param {{ parks?: any[], forests?: any[], woods?: any[], spots?: any[], relief?: any[], homes?: any[], communes?: any[] }} layers
 * @param {[number, number]} point [lon, lat]
 * @returns {{ name: string, kind: 'park' | 'forest' | 'wood' | 'relief' | 'spot' | 'hamlet' | 'commune', commune: string } | null}
 */
export function finestName(layers, point) {
  const c = (layers.communes || [])[0]?.properties || {};
  const commune = String(c.nom_officiel || c.nom || '');
  /** Named for good: a name of its own, still in use. @param {any} p */
  const named = p => {
    const t = String(p?.toponyme || '').trim();
    return t && p.statut_du_toponyme !== 'Historique' && fold(t) !== fold(String(p.nature || '')) && fold(t) !== fold(commune)
      && !/^(lieu dit (non )?habite|zone d habitation|detail orographique)$/.test(fold(t));
  };
  /** The features of `list` kept by `keep`, nearest first, each within its reach. @param {any[] | undefined} list @param {(p: any) => boolean} keep @param {(p: any) => number} reach */
  const near = (list, keep, reach) => (list || [])
    .filter(f => named(f.properties) && keep(f.properties))
    .map(f => ({ p: f.properties, d: distanceTo(f.geometry, point) }))
    .filter(x => x.d <= reach(x.p))
    .sort((a, b) => a.d - b.d || (Number(b.p.importance) || 0) - (Number(a.p.importance) || 0));
  /** Of the areas containing the point, the most local one (its `importance` the highest). @param {any[] | undefined} list @param {(p: any) => boolean} keep */
  const inside = (list, keep) => (list || []).map(f => f.properties).filter(p => named(p) && keep(p))
    .sort((a, b) => (Number(b.importance) || 0) - (Number(a.importance) || 0))[0];
  const all = (/** @type {any} */ _) => true;
  /** @param {string} name @param {any} kind */
  const found = (name, kind) => ({ name, kind, commune });

  const park = inside(layers.parks, isPark);
  if (park) return found(everyday(park.toponyme), 'park');
  const forest = inside(layers.forests, all);
  if (forest) return found(everyday(forest.toponyme), 'forest');
  const wood = near(layers.woods, p => /^(Bois|Forêt)$/i.test(p.nature || '') || /^(bois|forêt)\b/i.test(p.toponyme), p => woodReach(p.importance))[0];
  if (wood) return found(everyday(wood.p.toponyme), 'wood');
  const relief = near(layers.relief, all, p => reliefReach(String(p.nature || '')))[0];
  if (relief) return found(relief.p.toponyme, 'relief');
  const spot = near(layers.spots, p => p.nature === 'Lieu-dit non habité', p => (Number(p.importance) === 6 ? 150 : 250))[0];
  const hamlet = near(layers.homes, p => ['Lieu-dit habité', 'Hameau', 'Château', 'Moulin', 'Ruines', 'Grange', 'Habitat temporaire'].includes(p.nature), () => 250)[0];
  const local = [spot, hamlet].filter(Boolean).sort((a, b) => /** @type {any} */ (a).d - /** @type {any} */ (b).d)[0];
  if (local) return found(local.p.toponyme, local === spot ? 'spot' : 'hamlet');
  const quarter = near(layers.homes, p => p.nature === 'Quartier', () => 0)[0];
  if (quarter) return found(quarter.p.toponyme, 'hamlet');
  return commune ? found(commune, 'commune') : null;
}

/**
 * The finest name the IGN knows at a point, and its commune (see `finestName`): seven small WFS requests at once
 * (BD TOPO, ADMIN EXPRESS), kept a year. Null when nothing answers there; an error when the IGN is out of reach.
 * @param {[number, number]} point [lon, lat]
 * @returns {Promise<ReturnType<typeof finestName>>}
 */
export function placeNameAt(point) {
  if (!moduleOn('ignGeo')) return Promise.resolve(null);
  // A layer that failed (the commune answered): the name found is kept a few minutes only, not a year.
  let some = false;
  return cached('geo:name2:' + key5(point), async () => {
    const at = `POINT(${point[1]} ${point[0]})`;
    /** @type {[string, string, string, number][]} */
    const asked = [
      ['parks', 'BDTOPO_V3:zone_d_activite_ou_d_interet', `INTERSECTS(geometrie,${at})`, 10],
      ['forests', 'BDTOPO_V3:foret_publique', `INTERSECTS(geometrie,${at})`, 5],
      ['woods', 'BDTOPO_V3:lieu_dit_non_habite', `nature='Bois' AND DWITHIN(geometrie,${at},1500,meters)`, 30],
      ['spots', 'BDTOPO_V3:lieu_dit_non_habite', `DWITHIN(geometrie,${at},300,meters)`, 40],
      ['relief', 'BDTOPO_V3:detail_orographique', `DWITHIN(geometrie,${at},800,meters)`, 20],
      ['homes', 'BDTOPO_V3:zone_d_habitation', `DWITHIN(geometrie,${at},300,meters)`, 20],
      ['communes', 'ADMINEXPRESS-COG-CARTO.LATEST:commune', `INTERSECTS(geometrie,${at})`, 1]
    ];
    const answers = await Promise.allSettled(asked.map(([, type, filter, count]) => wfsFeatures(type, filter, count)));
    // Nothing at all: out of reach (not kept, asked again next time). The commune alone missing: not kept either.
    if (answers[6].status === 'rejected') throw answers[6].reason;
    some = answers.some(a => a.status === 'rejected');
    /** @type {Record<string, any[]>} */
    const layers = {};
    asked.forEach(([key], i) => { const a = answers[i]; layers[key] = a.status === 'fulfilled' ? a.value : []; });
    // The woods asked near the point (300 m) count too, should the wider request fail.
    layers.woods = [...layers.woods, ...layers.spots];
    return finestName(layers, point);
  }, () => some);
}
