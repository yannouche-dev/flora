// @ts-check
// Observations: one layer over the sources of plant observations — iNaturalist, GBIF, and through GBIF the datasets
// it gathers (Pl@ntNet, Observation.org, the national inventory, the botanical conservatories, herbaria…). A layout
// (layout/state.js) asks for a zone's observations with global filters, the same for every source: each one put in
// the source's own words where it has them, applied by the app where it has not (GBIF: the rank, a free photo, wild
// plants), or said not to apply (GBIF has no quality grade); every observation they give by default (both sources, every
// quality, every dataset: a map shows all that is there); the answers merged into one list of points — GBIF's copy
// of iNaturalist's left out, the same plant at the same spot on the same day once —, the most recent first. A source
// that fails is said, the others shown.
//   OBS_DEFAULTS, readObsFilters(params), obsParams(filters), obsKey(filters): the filters and the address (sources=,
//     qualite=, taxon=, photos=, sauvages=, jeux=, sansjeux=);
//   inatQuery(f), inatGrades(qualite), gbifQuery(f, periode), gbifKeep(record, f), APPLIES: what each source does of
//     each filter;
//   zoneObservations(center, radius, { filters, periode, taxon, precise, signal }) → { points, totals, failed, datasets }
//     (every source failing: an ObsError, which says each one's failure) — GBIF asked in two requests, its datasets
//     first, then their occurrences (never its copy of iNaturalist's, nor the datasets left out); `taxon`: one group of
//     plants only (a family:
//     Orchidaceae), in each source's own numbers; `precise`: only the points that are where the plant was, at this
//     radius (the others counted: `vague`); sourcesText(sources), failedText(failed), obsNotes(counts): in words.
// The filters and their translation are pure, tested under Node (tests/unit/observations.test.mjs).

import * as cache from './cache.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { binomial, floraPhotos, observationPointsMany, periodQuery } from './nearby.js';
import { GBIF_MAX, INAT_DATASET, gbifSource, inCircle, metres, sharePhotos } from './around3d.js';
import { FREE_MEDIA } from '../../lib/plant-sources.mjs';

/**
 * @typedef {'inat' | 'gbif'} ObsSource
 * @typedef {'recherche' | 'aidentifier' | 'occasionnelles'} ObsGrade  iNaturalist's quality grades: research (verified), needs
 *   ID, casual (cultivated or captive, without a photo, a date or a precise place)
 * @typedef {{ sources: ObsSource[], qualite: ObsGrade[], taxon: 'tous' | 'espece', photos: 'toutes' | 'avec' | 'libre', sauvages: boolean,
 *   jeux: string[], sansjeux: string[] }} ObsFilters
 *   `qualite`: the grades shown (one at least); `jeux`: GBIF's datasets asked alone (none: every one of the zone);
 *   `sansjeux`: those left out
 * @typedef {import('./around3d.js').Obs3d} Obs
 * @typedef {{ name: string, off: boolean }} ObsFailure  a source that did not answer (`off`: its module is)
 * @typedef {{ points: Obs[], totals: { inat: number | null, gbif: number | null }, failed: ObsFailure[], datasets: { key: string, count: number }[],
 *   vague?: number }} ObsResult   `vague` (asked `precise`): the points of the circle left out, their position hidden or too rough
 * @typedef {{ inat: number, gbif: number }} ObsTaxon  a group of plants in each source's numbers: iNaturalist's taxon, GBIF's
 *   Backbone key (Orchidaceae: 47217, 7689) — what is under it asked, nothing else
 */

/** The sources, in their order, and their names. */
export const SOURCES = /** @type {const} */ (['inat', 'gbif']);
export const SOURCE_NAMES = { inat: 'iNaturalist', gbif: 'GBIF' };

/** The sources named: « iNaturalist », « iNaturalist et GBIF ». @param {readonly ObsSource[]} sources */
export const sourcesText = sources => sources.map(s => SOURCE_NAMES[s]).join(' et ');

/**
 * Sources that failed, in words (a sentence's start): « iNaturalist ne répond pas », « Les modules iNaturalist et GBIF
 * sont désactivés », « Le module iNaturalist est désactivé et GBIF ne répond pas ». @param {readonly ObsFailure[]} failed
 */
export function failedText(failed) {
  const off = failed.filter(f => f.off).map(f => f.name), down = failed.filter(f => !f.off).map(f => f.name);
  // The modules first (« Le module… »): a source's name keeps its own case (iNaturalist).
  return [
    off.length > 1 ? `Les modules ${off.join(' et ')} sont désactivés` : off.length ? `Le module ${off[0]} est désactivé` : '',
    down.length ? `${down.join(' et ')} ${down.length > 1 ? 'ne répondent pas' : 'ne répond pas'}` : ''
  ].filter(Boolean).join(' et ');
}

/**
 * Each plant's observations in words (a layout's list: core/nearby.js plantCounts): « 12 obs. »; with both sources asked
 * « 12 obs. (9 iNat., 3 GBIF) », or the one alone that saw it (« 3 obs. GBIF ») — `detail` that part alone (a grid's
 * cell); its title « 12 observations dans la zone : 9 iNaturalist, 3 GBIF ».
 * @param {Map<number, { inat: number, gbif: number }>} counts @param {readonly ObsSource[]} sources
 * @returns {Map<number, { n: number, text: string, detail: string, title: string }>}
 */
export function obsNotes(counts, sources) {
  const both = sources.includes('inat') && sources.includes('gbif');
  const fr = (/** @type {number} */ n) => n.toLocaleString('fr-FR');
  /** @type {Map<number, { n: number, text: string, detail: string, title: string }>} */
  const out = new Map();
  for (const [id, c] of counts) {
    const n = c.inat + c.gbif;
    const detail = !both ? '' : c.inat && c.gbif ? `${fr(c.inat)} iNat., ${fr(c.gbif)} GBIF` : c.gbif ? 'GBIF' : 'iNat.';
    const parts = [c.inat ? `${fr(c.inat)} iNaturalist` : '', c.gbif ? `${fr(c.gbif)} GBIF` : ''].filter(Boolean);
    out.set(id, { n, detail, text: `${fr(n)} obs.${!detail ? '' : c.inat && c.gbif ? ` (${detail})` : ' ' + detail}`,
      title: `${fr(n)} observation${n > 1 ? 's' : ''} dans la zone : ${parts.join(', ')}` });
  }
  return out;
}

/** Every source asked failed (zoneObservations): each one's failure (`failed`), the first as its cause. */
export class ObsError extends Error {
  /** @param {ObsFailure[]} failed @param {unknown} cause */
  constructor(failed, cause) {
    super(failedText(failed) || 'Aucune source d’observations', { cause });
    this.name = 'ObsError';
    this.failed = failed;
  }
}

/** The filters' values, in their order. */
export const GRADES = /** @type {const} */ (['recherche', 'aidentifier', 'occasionnelles']);
export const TAXA = /** @type {const} */ (['tous', 'espece']);
export const PHOTOS = /** @type {const} */ (['toutes', 'avec', 'libre']);

/** Each grade in iNaturalist's words. */
const GRADE_WORDS = { recherche: 'research', aidentifier: 'needs_id', occasionnelles: 'casual' };

/**
 * The quality's words of before (one choice of three: verified; to identify too; all), each the grades it says — still
 * read, and written when the grades are theirs (an address keeps its old words).
 * @type {Readonly<Record<string, readonly ObsGrade[]>>}
 */
const QUALITY_WORDS = Object.freeze({ recherche: ['recherche'], verifiables: ['recherche', 'aidentifier'], toutes: GRADES });

/**
 * Every observation available: both sources, every quality grade, rank, photo and dataset, cultivated plants too —
 * what a map shows unless told otherwise (the games' cards ask for verified ones on their own).
 */
export const OBS_DEFAULTS = /** @type {Readonly<ObsFilters>} */ (Object.freeze({ sources: ['inat', 'gbif'], qualite: [...GRADES], taxon: 'tous', photos: 'toutes', sauvages: false, jeux: [], sansjeux: [] }));

/**
 * The grades as the address writes them: the word of before when they are its (recherche, verifiables, toutes), else
 * their list (« aidentifier,occasionnelles »). @param {readonly ObsGrade[]} grades
 */
export function qualityWord(grades) {
  const list = GRADES.filter(g => grades.includes(g)).join(',');
  return Object.keys(QUALITY_WORDS).find(w => QUALITY_WORDS[w].join(',') === list) ?? list;
}

/** A GBIF dataset's key (a UUID), or the like. */
const DATASET = /^[\w-]{1,64}$/;

/**
 * The filters an address' query says (a group's keys, its letter already taken off: layout/state.js groupParams),
 * those wrong left out; none: null. Lists are written with commas (sources=inat,gbif), as the search's are.
 * @param {URLSearchParams} params @returns {Readonly<Partial<ObsFilters>> | null}
 */
export function readObsFilters(params) {
  /** @type {Partial<ObsFilters>} */
  const f = {};
  const list = (/** @type {string} */ k) => (params.get(k) || '').split(',').map(s => s.trim()).filter(Boolean);
  const sources = list('sources').filter(s => /** @type {readonly string[]} */ (SOURCES).includes(s));
  if (sources.length) f.sources = /** @type {ObsSource[]} */ ([...new Set(sources)].sort((a, b) => SOURCES.indexOf(/** @type {ObsSource} */ (a)) - SOURCES.indexOf(/** @type {ObsSource} */ (b))));
  // The quality: a word of before, or a list of grades (each word its grades).
  const grades = list('qualite').flatMap(w => /** @type {readonly string[]} */ (Object.hasOwn(QUALITY_WORDS, w) ? QUALITY_WORDS[w] : GRADES.filter(g => g === w)));
  if (grades.length) f.qualite = GRADES.filter(g => grades.includes(g));
  const taxon = params.get('taxon');
  if (taxon && /** @type {readonly string[]} */ (TAXA).includes(taxon)) f.taxon = /** @type {ObsFilters['taxon']} */ (taxon);
  const photos = params.get('photos');
  if (photos && /** @type {readonly string[]} */ (PHOTOS).includes(photos)) f.photos = /** @type {ObsFilters['photos']} */ (photos);
  const sauvages = params.get('sauvages');
  if (sauvages === '1' || sauvages === '0') f.sauvages = sauvages === '1';
  const jeux = list('jeux').filter(k => DATASET.test(k));
  if (jeux.length) f.jeux = [...new Set(jeux)].sort();
  const sansjeux = list('sansjeux').filter(k => DATASET.test(k));
  if (sansjeux.length) f.sansjeux = [...new Set(sansjeux)].sort();
  return Object.keys(f).length ? Object.freeze(f) : null;
}

/**
 * The address' keys and values of these filters (those given only), in a fixed order. @param {Partial<ObsFilters> | null | undefined} f
 * @returns {[string, string][]}
 */
export function obsParams(f) {
  if (!f) return [];
  /** @type {[string, string][]} */
  const out = [];
  if (f.sources?.length) out.push(['sources', f.sources.join(',')]);
  if (f.qualite?.length) out.push(['qualite', qualityWord(f.qualite)]);
  if (f.taxon) out.push(['taxon', f.taxon]);
  if (f.photos) out.push(['photos', f.photos]);
  if (f.sauvages != null) out.push(['sauvages', f.sauvages ? '1' : '0']);
  if (f.jeux?.length) out.push(['jeux', f.jeux.join(',')]);
  if (f.sansjeux?.length) out.push(['sansjeux', f.sansjeux.join(',')]);
  return out;
}

/** The filters as one key (two the same, the same key). @param {Partial<ObsFilters> | null | undefined} f */
export const obsKey = f => obsParams(f).map(([k, v]) => k + '=' + v).join('&');

/**
 * The filters given against the defaults (a layout's sources: its maps'): only what differs, null when nothing does —
 * what the address keeps. @param {ObsFilters} f @param {ObsFilters} defaults @returns {Readonly<Partial<ObsFilters>> | null}
 */
export function obsChanges(f, defaults) {
  /** @type {Partial<ObsFilters>} */
  const out = {};
  if (f.sources.join() !== defaults.sources.join()) out.sources = f.sources;
  if (qualityWord(f.qualite) !== qualityWord(defaults.qualite)) out.qualite = GRADES.filter(g => f.qualite.includes(g));
  if (f.taxon !== defaults.taxon) out.taxon = f.taxon;
  if (f.photos !== defaults.photos) out.photos = f.photos;
  if (f.sauvages !== defaults.sauvages) out.sauvages = f.sauvages;
  if (f.jeux.join() !== defaults.jeux.join()) out.jeux = f.jeux;
  if (f.sansjeux.join() !== defaults.sansjeux.join()) out.sansjeux = f.sansjeux;
  return Object.keys(out).length ? Object.freeze(out) : null;
}

// ── What each source does of each filter ────────────────────────────────────────────────────────

/**
 * Each filter, for each source: `api` (asked of the source), `app` (the source cannot: the app keeps the records that
 * pass), `non` (no sense there: said), and why in a few words (the section « Observations » says them).
 */
export const APPLIES = Object.freeze({
  qualite: { inat: 'api', gbif: 'non', why: 'GBIF n’a pas de note de qualité : ses données telles que leurs producteurs les publient' },
  taxon: { inat: 'api', gbif: 'app', why: 'GBIF : le rang vérifié par l’app' },
  photos: { inat: 'api', gbif: 'api', why: 'GBIF : la licence de la photo vérifiée par l’app' },
  sauvages: { inat: 'api', gbif: 'app', why: 'GBIF : les plantes gérées, cultivées ou captives écartées par l’app' },
  jeux: { inat: 'non', gbif: 'api', why: 'Jeux de données : ceux de GBIF' }
});

/**
 * The quality grades in iNaturalist's words: none when every one is shown (or none said), else their list
 * (« &quality_grade=research,casual »): its tiles take it too (layout/map-options.js inatTiles).
 * @param {readonly ObsGrade[]} qualite @returns {string}
 */
export function inatGrades(qualite) {
  const grades = GRADES.filter(g => qualite.includes(g));
  return grades.length && grades.length < GRADES.length ? '&quality_grade=' + grades.map(g => GRADE_WORDS[g]).join(',') : '';
}

/**
 * The filters in iNaturalist's words (API v1 /observations), after the circle and `iconic_taxa=Plantae`: its quality
 * grades (inatGrades: every one, none said), the rank (species or lower: `hrank`), a photo (any; under a free licence:
 * CC0, CC BY, CC BY-SA), wild only (`captive=false` — research grade is wild already).
 * @param {ObsFilters} f @returns {string}
 */
export function inatQuery(f) {
  const q = [inatGrades(f.qualite).replace(/^&/, '')].filter(Boolean);
  if (f.taxon === 'espece') q.push('hrank=species');
  if (f.photos === 'avec') q.push('photos=true');
  else if (f.photos === 'libre') q.push('photo_license=cc0,cc-by,cc-by-sa');
  if (f.sauvages) q.push('captive=false');
  return q.map(s => '&' + s).join('');
}

/**
 * The filters in GBIF's words (/v1/occurrence/search), after the circle and the plants: the period (`year`, `month`),
 * a photo (`mediaType=StillImage`; its licence checked by gbifKeep), the datasets chosen (`datasetKey`, repeated) —
 * and the datasets of the zone counted (a facet, as if none were chosen: `facetMultiselect`). GBIF has no word to
 * leave a dataset out: those left out (`sansjeux`) are not asked for their occurrences (gbifZone).
 * @param {ObsFilters} f @param {string | null} [periode] @returns {string}
 */
export function gbifQuery(f, periode = null) {
  const q = [periodQuery(periode).replace(/^&/, '')].filter(Boolean);
  if (f.photos !== 'toutes') q.push('mediaType=StillImage');
  for (const key of f.jeux) q.push('datasetKey=' + encodeURIComponent(key));
  return q.map(s => '&' + s).join('');
}

/** The ranks of a species, or below it (GBIF's words). */
const SPECIES_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM']);
/** What a wild plant is not (GBIF's establishment means, degree of establishment). */
const NOT_WILD = new Set(['MANAGED', 'CULTIVATED', 'CAPTIVE', 'RELEASED']);

/**
 * A GBIF record kept by the filters GBIF cannot apply itself: its rank (species or lower), a photo under a free
 * licence (CC0, CC BY, CC BY-SA), a wild plant (not managed, cultivated, captive nor released).
 * @param {{ taxonRank?: string, media?: { type?: string, license?: string }[], establishmentMeans?: string, degreeOfEstablishment?: string }} o
 * @param {ObsFilters} f
 */
export function gbifKeep(o, f) {
  if (f.taxon === 'espece' && !SPECIES_RANKS.has(String(o.taxonRank || '').toUpperCase())) return false;
  if (f.photos === 'libre' && !(o.media || []).some(m => (!m.type || m.type === 'StillImage') && FREE_MEDIA.test(String(m.license || '')))) return false;
  if (f.sauvages && (NOT_WILD.has(String(o.establishmentMeans || '').toUpperCase()) || NOT_WILD.has(String(o.degreeOfEstablishment || '').toUpperCase()))) return false;
  return true;
}

// ── GBIF ────────────────────────────────────────────────────────────────────────────────────────

/** A record's free text, shown as text on a card: one line, `max` characters at most. @param {unknown} v @param {number} max */
const clip = (v, max) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** GBIF's datasets of a zone counted at most (the facet of its first request): those past them are never asked. */
const GBIF_DATASETS = 50;

/**
 * A record's name: its species' (GBIF's `species`, without its author), else a genus or a family by its own name
 * (« Ophrys », not « Ophrys L. »: as iNaturalist names it, one group whichever source saw it), else GBIF's.
 * @param {{ species?: string, genus?: string, family?: string, taxonRank?: string, scientificName?: string }} o
 */
const gbifName = o => o.species || (o.taxonRank === 'GENUS' && o.genus) || (o.taxonRank === 'FAMILY' && o.family) || o.scientificName || '';

/**
 * GBIF's plant occurrences in the circle, as the filters say, cached a day — in two requests: the zone's count and its
 * datasets first (counted as if none were chosen), then the occurrences of the datasets chosen, else of every one of
 * the zone but GBIF's copy of iNaturalist's (never its records in GBIF's page of 300: they are iNaturalist's own, asked
 * of it) — those left out (`sansjeux`) never, their records not counted. An answer without the facet (an older GBIF):
 * one page as before, the copy and those left out taken off after. What the filters
 * need of each record is kept (rank, media, establishment), and how far its point may be from where the plant was (its
 * coordinate uncertainty), the rest left. `taxon`: the plants under GBIF's key only (else every plant: taxonKey=6).
 * @param {[number, number]} center @param {number} radius @param {ObsFilters} f @param {string | null} periode @param {AbortSignal} [signal]
 * @param {ObsTaxon | null} [taxon]
 * @returns {Promise<{ points: Obs[], total: number, datasets: { key: string, count: number }[] }>}
 */
async function gbifZone([lon, lat], radius, f, periode, signal, taxon = null) {
  if (!moduleOn('gbif')) throw new ModuleOffError('gbif');
  const where = `${lat.toFixed(4)},${lon.toFixed(4)},${(radius / 1000).toFixed(2)}km`;
  const query = gbifQuery(f, periode);
  const base = `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxon?.gbif ?? 6}&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT`
    + `&geoDistance=${encodeURIComponent(where)}`;
  /** The datasets left out; one asked (none chosen: every one, else those chosen). */
  const left = new Set(f.sansjeux), asked = (/** @type {string} */ k) => !f.jeux.length || f.jeux.includes(k);
  // « around-zone… »: forgotten with the zone's other failures (layout/state.js retryScope); « gbif2 »: in two requests;
  // a group of plants, its key in it (the plants' answer kept apart); the datasets left out, theirs.
  const found = await cache.cached(`around-zone-gbif2:${where}${query}${taxon ? '|t' + taxon.gbif : ''}${left.size ? '|sans=' + f.sansjeux.join(',') : ''}`, async () => {
    const head = await fetchJson(`${base}${query}&limit=0&facet=datasetKey&facetMultiselect=true&datasetKey.facetLimit=${GBIF_DATASETS}`,
      { signal, expect: d => typeof d.count === 'number' });
    const facet = (Array.isArray(head.facets) ? head.facets : []).find((/** @type {any} */ x) => /dataset/i.test(String(x?.field)));
    const counts = (facet?.counts || []).filter((/** @type {any} */ c) => DATASET.test(String(c?.name)))
      .map((/** @type {any} */ c) => ({ key: String(c.name), count: Number(c.count) || 0 }));
    const datasets = counts.filter(c => c.key !== INAT_DATASET);
    // The datasets whose occurrences are asked: those chosen, else the zone's — never GBIF's copy of iNaturalist's,
    // nor one left out.
    const keys = (f.jeux.length ? f.jeux : datasets.map(d => d.key)).filter(k => k !== INAT_DATASET && !left.has(k));
    const url = !facet ? `${base}${query}&limit=${GBIF_MAX}`
      : head.count > 0 && keys.length ? `${base}${gbifQuery({ ...f, jeux: keys }, periode)}&limit=${GBIF_MAX}` : null;
    const data = url ? await fetchJson(url, { signal, expect: d => Array.isArray(d.results) }) : { results: [], count: 0 };
    const records = [];
    for (const o of data.results) {
      if (typeof o.decimalLatitude !== 'number' || typeof o.decimalLongitude !== 'number' || o.datasetKey === INAT_DATASET || left.has(o.datasetKey)) continue;
      records.push({
        key: o.key, coordinates: [o.decimalLongitude, o.decimalLatitude], sci: clip(gbifName(o), 120), common: clip(o.vernacularName, 80) || null,
        uncertainty: Number(o.coordinateUncertaintyInMeters) > 0 ? Number(o.coordinateUncertaintyInMeters) : null,
        taxonRank: o.taxonRank || null, establishmentMeans: o.establishmentMeans || null, degreeOfEstablishment: o.degreeOfEstablishment || null,
        media: (Array.isArray(o.media) ? o.media : []).slice(0, 6).map((/** @type {any} */ m) => ({ type: m?.type || null, license: m?.license || null })),
        date: o.eventDate ? String(o.eventDate).slice(0, 10) : null, place: clip(o.locality || o.municipality || o.county, 80) || null,
        source: gbifSource(o.datasetName || o.institutionCode)
      });
    }
    // GBIF's count holds its copy of iNaturalist's (its dataset's, as the facet counts it): not GBIF's own; nor are
    // the records of the datasets left out (as the facet counts them: those past its 50 never are).
    const copies = asked(INAT_DATASET) ? counts.find(c => c.key === INAT_DATASET)?.count ?? 0 : 0;
    const out = counts.filter(c => left.has(c.key) && c.key !== INAT_DATASET && asked(c.key)).reduce((n, c) => n + c.count, 0);
    const count = facet ? head.count - out : typeof data.count === 'number' ? data.count : records.length;
    return { records, total: Math.max(records.length, count - copies), datasets };
  }, { ttl: 24 * 3600 * 1000, signal });
  /** @type {Obs[]} */
  const points = found.records.filter(r => gbifKeep(/** @type {any} */ (r), f)).map(r => ({
    id: 'g' + r.key, kind: 'gbif', coordinates: /** @type {[number, number]} */ (r.coordinates), title: r.common || r.sci || 'Plante', common: r.common, sci: r.sci,
    taxonId: null, photo: null, credit: null, date: r.date, place: r.place, source: r.source, url: r.key ? `https://www.gbif.org/occurrence/${r.key}` : null,
    ...(r.uncertainty ? { accuracy: r.uncertainty } : {})
  }));
  return { points, total: found.total, datasets: found.datasets };
}

// ── The zone's observations ─────────────────────────────────────────────────────────────────────

/** Two records of the same plant this close, the same day, are one observation (seen twice). */
const SAME_SPOT = 25;

/**
 * The zone's observations from the sources the filters keep (each with its module on), merged: iNaturalist's `max`
 * most recent, GBIF's (300) — its copy of iNaturalist's left out, and any of its records that is an iNaturalist
 * observation already (the same plant, the same day, within 25 m) —, GBIF's given the photo and name its plant has on
 * iNaturalist here (else the flora's), all in the circle, the most recent first. A source that fails is said
 * (`failed`); every one failing, an ObsError thrown (each one's failure). `taxon`: one group of plants only (an
 * activity's: the orchids of a site), each source asked for it in its own numbers. `precise` (a small circle: a site):
 * only the points that are where the plant was — iNaturalist's hidden ones (obscured: drawn at random in a cell of some
 * 20 km, wherever the plant was) and any whose accuracy is wider than the circle left out, counted (`vague`); a point
 * that says nothing of it kept.
 * @param {[number, number]} center @param {number} radius
 * @param {{ filters: ObsFilters, periode?: string | null, max?: number, taxon?: ObsTaxon | null, precise?: boolean, signal?: AbortSignal }} o
 * @returns {Promise<ObsResult>}
 */
export async function zoneObservations(center, radius, { filters: f, periode = null, max = 1000, taxon = null, precise = false, signal }) {
  const useInat = f.sources.includes('inat'), useGbif = f.sources.includes('gbif');
  /** @type {ObsFailure[]} */ const failed = [];
  /** @type {unknown} */ let first;
  const fail = (/** @type {ObsSource} */ s) => (/** @type {any} */ error) => {
    if (error?.name === 'AbortError') throw error;
    failed.push({ name: SOURCE_NAMES[s], off: error?.name === 'ModuleOffError' });
    first ??= error;
    return null;
  };
  const [inat, gbif] = await Promise.all([
    useInat ? observationPointsMany(center, radius, max, signal, periode, inatQuery(f) + (taxon ? '&taxon_id=' + taxon.inat : '')).catch(fail('inat')) : null,
    useGbif ? gbifZone(center, radius, f, periode, signal, taxon).catch(fail('gbif')) : null
  ]);
  // Said in the sources' order, whichever failed first (« iNaturalist et GBIF ne répondent pas »).
  const order = SOURCES.map(x => /** @type {string} */ (SOURCE_NAMES[x]));
  failed.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  if (!inat && !gbif) throw new ObsError(failed, first);
  /** @type {Obs[]} */
  const points = (inat?.points || []).map((p, i) => ({ ...p, id: 'i' + (p.url?.match(/(\d+)$/)?.[1] ?? i), kind: /** @type {const} */ ('inat'), url: p.url || null, source: 'iNaturalist' }));
  if (gbif) {
    // An iNaturalist observation already (the same plant, day and spot): once.
    /** @type {Map<string, [number, number][]>} */
    const seen = new Map();
    for (const p of points) {
      const k = binomial(p.sci) + '|' + p.date;
      seen.set(k, [...(seen.get(k) || []), p.coordinates]);
    }
    const own = gbif.points.filter(p => !(seen.get(binomial(p.sci) + '|' + p.date) || []).some(c => metres(c, p.coordinates) <= SAME_SPOT));
    /** @type {Obs[]} */
    const shared = sharePhotos(own, points);
    points.push(...await floraPhotos(shared, { names: true }));
  }
  points.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  const all = inCircle(points, center, radius);
  const kept = precise ? all.filter(p => !p.obscured && !((p.accuracy ?? 0) > radius)) : all;
  return {
    points: kept,
    totals: { inat: inat ? inat.total : null, gbif: gbif ? gbif.total : null },
    failed,
    datasets: gbif?.datasets ?? [],
    ...(precise ? { vague: all.length - kept.length } : {})
  };
}
