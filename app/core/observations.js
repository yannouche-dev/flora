// @ts-check
// Observations: one layer over the sources of plant observations — iNaturalist, GBIF, and through GBIF the datasets
// it gathers (Pl@ntNet, Observation.org, the national inventory, the botanical conservatories, herbaria…). A layout
// (layout/state.js) asks for a zone's observations with global filters, the same for every source: each one put in
// the source's own words where it has them, applied by the app where it has not (GBIF: the rank, a free photo, wild
// plants), or said not to apply (GBIF has no quality grade); the answers merged into one list of points — GBIF's copy
// of iNaturalist's left out, the same plant at the same spot on the same day once —, the most recent first. A source
// that fails is said, the others shown.
//   OBS_DEFAULTS, readObsFilters(params), obsParams(filters), obsKey(filters): the filters and the address (sources=,
//     qualite=, taxon=, photos=, sauvages=, jeux=);
//   inatQuery(f), gbifQuery(f, periode), gbifKeep(record, f), APPLIES: what each source does of each filter;
//   zoneObservations(center, radius, { filters, periode, signal }) → { points, totals, failed, datasets } (every source
//     failing: an ObsError, which says each one's failure); sourcesText(sources), failedText(failed): in words.
// The filters and their translation are pure, tested under Node (tests/unit/observations.test.mjs).

import * as cache from './cache.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { binomial, floraPhotos, observationPointsMany, periodQuery } from './nearby.js';
import { GBIF_MAX, INAT_DATASET, gbifSource, inCircle, metres, sharePhotos } from './around3d.js';
import { FREE_MEDIA } from '../../lib/plant-sources.mjs';

/**
 * @typedef {'inat' | 'gbif'} ObsSource
 * @typedef {'recherche' | 'verifiables' | 'toutes'} ObsQuality
 * @typedef {{ sources: ObsSource[], qualite: ObsQuality, taxon: 'tous' | 'espece', photos: 'toutes' | 'avec' | 'libre', sauvages: boolean, jeux: string[] }} ObsFilters
 * @typedef {import('./around3d.js').Obs3d} Obs
 * @typedef {{ name: string, off: boolean }} ObsFailure  a source that did not answer (`off`: its module is)
 * @typedef {{ points: Obs[], totals: { inat: number | null, gbif: number | null }, failed: ObsFailure[], datasets: { key: string, count: number }[] }} ObsResult
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
export const QUALITIES = /** @type {const} */ (['recherche', 'verifiables', 'toutes']);
export const TAXA = /** @type {const} */ (['tous', 'espece']);
export const PHOTOS = /** @type {const} */ (['toutes', 'avec', 'libre']);

/** Every filter as the app has always shown observations: iNaturalist's research grade, whatever its rank and photos. */
export const OBS_DEFAULTS = /** @type {Readonly<ObsFilters>} */ (Object.freeze({ sources: ['inat'], qualite: 'recherche', taxon: 'tous', photos: 'toutes', sauvages: false, jeux: [] }));

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
  const qualite = params.get('qualite');
  if (qualite && /** @type {readonly string[]} */ (QUALITIES).includes(qualite)) f.qualite = /** @type {ObsQuality} */ (qualite);
  const taxon = params.get('taxon');
  if (taxon && /** @type {readonly string[]} */ (TAXA).includes(taxon)) f.taxon = /** @type {ObsFilters['taxon']} */ (taxon);
  const photos = params.get('photos');
  if (photos && /** @type {readonly string[]} */ (PHOTOS).includes(photos)) f.photos = /** @type {ObsFilters['photos']} */ (photos);
  const sauvages = params.get('sauvages');
  if (sauvages === '1' || sauvages === '0') f.sauvages = sauvages === '1';
  const jeux = list('jeux').filter(k => DATASET.test(k));
  if (jeux.length) f.jeux = [...new Set(jeux)].sort();
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
  if (f.qualite) out.push(['qualite', f.qualite]);
  if (f.taxon) out.push(['taxon', f.taxon]);
  if (f.photos) out.push(['photos', f.photos]);
  if (f.sauvages != null) out.push(['sauvages', f.sauvages ? '1' : '0']);
  if (f.jeux?.length) out.push(['jeux', f.jeux.join(',')]);
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
  if (f.qualite !== defaults.qualite) out.qualite = f.qualite;
  if (f.taxon !== defaults.taxon) out.taxon = f.taxon;
  if (f.photos !== defaults.photos) out.photos = f.photos;
  if (f.sauvages !== defaults.sauvages) out.sauvages = f.sauvages;
  if (f.jeux.join() !== defaults.jeux.join()) out.jeux = f.jeux;
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
 * The filters in iNaturalist's words (API v1 /observations), after the circle and `iconic_taxa=Plantae`: its quality
 * grade (research; research and needs ID; any), the rank (species or lower: `hrank`), a photo (any; under a free
 * licence: CC0, CC BY, CC BY-SA), wild only (`captive=false` — research grade is wild already).
 * @param {ObsFilters} f @returns {string}
 */
export function inatQuery(f) {
  const q = [];
  if (f.qualite === 'recherche') q.push('quality_grade=research');
  else if (f.qualite === 'verifiables') q.push('quality_grade=research,needs_id');
  if (f.taxon === 'espece') q.push('hrank=species');
  if (f.photos === 'avec') q.push('photos=true');
  else if (f.photos === 'libre') q.push('photo_license=cc0,cc-by,cc-by-sa');
  if (f.sauvages) q.push('captive=false');
  return q.map(s => '&' + s).join('');
}

/**
 * The filters in GBIF's words (/v1/occurrence/search), after the circle and the plants: the period (`year`, `month`),
 * a photo (`mediaType=StillImage`; its licence checked by gbifKeep), the datasets chosen (`datasetKey`, repeated) —
 * and the datasets of the zone counted (a facet, as if none were chosen: `facetMultiselect`).
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

/**
 * GBIF's plant occurrences in the circle, as the filters say (iNaturalist's copy left out, and from its count), cached
 * a day; the datasets of the zone, counted. What the filters need of each record is kept (rank, media, establishment),
 * the rest left.
 * @param {[number, number]} center @param {number} radius @param {ObsFilters} f @param {string | null} periode @param {AbortSignal} [signal]
 * @returns {Promise<{ points: Obs[], total: number, datasets: { key: string, count: number }[] }>}
 */
async function gbifZone([lon, lat], radius, f, periode, signal) {
  if (!moduleOn('gbif')) throw new ModuleOffError('gbif');
  const where = `${lat.toFixed(4)},${lon.toFixed(4)},${(radius / 1000).toFixed(2)}km`;
  const query = gbifQuery(f, periode);
  // « around-zone… »: forgotten with the zone's other failures (layout/state.js retryScope).
  const found = await cache.cached(`around-zone-gbif1:${where}${query}`, async () => {
    const url = 'https://api.gbif.org/v1/occurrence/search?taxonKey=6&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT'
      + `&geoDistance=${encodeURIComponent(where)}${query}&limit=${GBIF_MAX}&facet=datasetKey&facetMultiselect=true&datasetKey.facetLimit=30`;
    const data = await fetchJson(url, { signal, expect: d => Array.isArray(d.results) });
    const records = [];
    for (const o of data.results) {
      if (typeof o.decimalLatitude !== 'number' || typeof o.decimalLongitude !== 'number' || o.datasetKey === INAT_DATASET) continue;
      records.push({
        key: o.key, coordinates: [o.decimalLongitude, o.decimalLatitude], sci: clip(o.species || o.scientificName, 120), common: clip(o.vernacularName, 80) || null,
        taxonRank: o.taxonRank || null, establishmentMeans: o.establishmentMeans || null, degreeOfEstablishment: o.degreeOfEstablishment || null,
        media: (Array.isArray(o.media) ? o.media : []).slice(0, 6).map((/** @type {any} */ m) => ({ type: m?.type || null, license: m?.license || null })),
        date: o.eventDate ? String(o.eventDate).slice(0, 10) : null, place: clip(o.locality || o.municipality || o.county, 80) || null,
        source: gbifSource(o.datasetName || o.institutionCode)
      });
    }
    const facet = (Array.isArray(data.facets) ? data.facets : []).find((/** @type {any} */ x) => /dataset/i.test(String(x?.field)));
    const counts = (facet?.counts || []).filter((/** @type {any} */ c) => DATASET.test(String(c?.name)))
      .map((/** @type {any} */ c) => ({ key: String(c.name), count: Number(c.count) || 0 }));
    // GBIF's count holds its copy of iNaturalist's (its dataset's, as the facet counts it): not GBIF's own.
    const copies = !f.jeux.length || f.jeux.includes(INAT_DATASET) ? counts.find(c => c.key === INAT_DATASET)?.count ?? 0 : 0;
    const total = typeof data.count === 'number' ? Math.max(records.length, data.count - copies) : records.length;
    return { records, total, datasets: counts.filter(c => c.key !== INAT_DATASET) };
  }, { ttl: 24 * 3600 * 1000, signal });
  /** @type {Obs[]} */
  const points = found.records.filter(r => gbifKeep(/** @type {any} */ (r), f)).map(r => ({
    id: 'g' + r.key, kind: 'gbif', coordinates: /** @type {[number, number]} */ (r.coordinates), title: r.common || r.sci || 'Plante', common: r.common, sci: r.sci,
    taxonId: null, photo: null, credit: null, date: r.date, place: r.place, source: r.source, url: r.key ? `https://www.gbif.org/occurrence/${r.key}` : null
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
 * (`failed`); every one failing, an ObsError thrown (each one's failure).
 * @param {[number, number]} center @param {number} radius
 * @param {{ filters: ObsFilters, periode?: string | null, max?: number, signal?: AbortSignal }} o
 * @returns {Promise<ObsResult>}
 */
export async function zoneObservations(center, radius, { filters: f, periode = null, max = 1000, signal }) {
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
    useInat ? observationPointsMany(center, radius, max, signal, periode, inatQuery(f)).catch(fail('inat')) : null,
    useGbif ? gbifZone(center, radius, f, periode, signal).catch(fail('gbif')) : null
  ]);
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
  return {
    points: inCircle(points, center, radius),
    totals: { inat: inat ? inat.total : null, gbif: gbif ? gbif.total : null },
    failed,
    datasets: gbif?.datasets ?? []
  };
}
