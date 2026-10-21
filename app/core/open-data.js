// @ts-check
// Open data crossed with the flora, from APIs a browser can call without a key (checked from the deployed
// origin): GloBI (interactions between species), Open-Meteo (pollens, climate from ERA5), IGN API Carto
// (natural zones at a point). Each one is a module (Réglages › Modules); answers are cached in IndexedDB.

import * as cache from './cache.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';

const DAY = 24 * 3600 * 1000;

/** @param {string} url @param {AbortSignal} [signal] @param {(data: any) => boolean} [expect] */
const json = (url, signal, expect) => fetchJson(url, { signal, expect });

/**
 * Cached for `ttl` (core/cache.js: a failure is never stored, an older copy is used offline); `partial`: the answer is
 * degraded, kept a few minutes only.
 * @template T @param {string} key @param {number} ttl @param {() => Promise<T>} load @param {(value: T) => boolean} [partial] @returns {Promise<T>}
 */
const cached = (key, ttl, load, partial) => cache.cached(key, load, { ttl, partial });

/** @param {import('./modules.js').ModuleKey} key */
function need(key) {
  if (!moduleOn(key)) throw new ModuleOffError(key);
}

/** Coordinates rounded for cache keys and requests (~100 m): the exact position is not needed. @param {[number, number]} p */
const at = ([lon, lat]) => [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000];

// ── GloBI: interactions ──────────────────────────────────────────────────────────────────────────────────

/**
 * Roles of the partners, from the plant's side (GloBI gives the types seen from the taxon asked for).
 * @type {{ key: string, label: string, types: string[] }[]}
 */
export const ROLES = [
  { key: 'pollination', short: 'Pollinisateurs', label: 'Pollinisateurs et visiteurs des fleurs', types: ['pollinatedBy', 'flowersVisitedBy', 'visitedBy'] },
  { key: 'herbivores', short: 'Consommateurs', label: 'Mangée ou parasitée par', types: ['eatenBy', 'hostOf', 'hasParasite', 'hasParasitoid', 'hasPathogen', 'hasEctoparasite', 'hasEndoparasite', 'preyedUponBy', 'killedBy', 'hasVector'] },
  { key: 'symbioses', short: 'Symbioses', label: 'Symbioses (mycorhizes, mutualismes)', types: ['mutualistOf', 'symbiontOf', 'ectomycorrhizalHostOf', 'arbuscularMycorrhizalHostOf', 'hasEctomycorrhizalHost', 'hasArbuscularMycorrhizalHost', 'commensalistOf', 'hasEpiphyte', 'createsHabitatFor', 'hasDispersalVector', 'providesNutrientsFor'] },
  { key: 'consumer', short: 'Hôtes et proies', label: 'Elle-même parasite ou se nourrit de', types: ['parasiteOf', 'hemiparasiteOf', 'rootparasiteOf', 'eats', 'acquiresNutrientsFrom', 'epiphyteOf', 'hasHost', 'pathogenOf', 'kills', 'preysOn', 'visitsFlowersOf', 'pollinates', 'visits'] },
  { key: 'other', short: 'Autres', label: 'Autres interactions signalées', types: [] }
];

/** Groups of partners, by a name in their classification (the first that matches). */
const GROUPS = [
  ['Apoidea', 'Abeilles et bourdons'], ['Anthophila', 'Abeilles et bourdons'], ['Syrphidae', 'Syrphes'], ['Lepidoptera', 'Papillons'],
  ['Coleoptera', 'Coléoptères'], ['Hemiptera', 'Punaises et pucerons'], ['Hymenoptera', 'Guêpes, fourmis et tenthrèdes'],
  ['Diptera', 'Mouches'], ['Orthoptera', 'Criquets et sauterelles'], ['Thysanoptera', 'Thrips'], ['Acari', 'Acariens'], ['Arachnida', 'Araignées et acariens'],
  ['Insecta', 'Autres insectes'], ['Gastropoda', 'Escargots et limaces'], ['Nematoda', 'Nématodes'], ['Aves', 'Oiseaux'], ['Mammalia', 'Mammifères'],
  ['Fungi', 'Champignons'], ['Oomycota', 'Oomycètes'], ['Chromista', 'Oomycètes'], ['Bacteria', 'Bactéries'], ['Viruses', 'Virus'], ['Plantae', 'Plantes'],
  ['Animalia', 'Autres animaux']
];

/** @param {string} path */
export function partnerGroup(path) {
  const parts = String(path || '').split('|').map(s => s.trim());
  for (const [name, label] of GROUPS) if (parts.includes(name)) return label;
  return 'Autres';
}

/**
 * @typedef {{ name: string, group: string, count: number, types: string[] }} Partner
 * @typedef {{ key: string, short?: string, label: string, partners: Partner[], count: number }} RoleGroup
 * @typedef {{ total: number, studies: number, roles: RoleGroup[], url: string }} Interactions
 */

/**
 * What GloBI knows of the plant's interactions, grouped by role, partners by number of mentions.
 * @param {string} name scientific name @param {AbortSignal} [signal] @returns {Promise<Interactions>}
 */
export async function interactions(name, signal) {
  need('globi');
  const taxon = String(name).split(/\s+/).slice(0, 2).join(' ');
  return cached('globi2:' + taxon, 7 * DAY, async () => {
    const fields = ['interaction_type', 'target_taxon_name', 'target_taxon_path', 'study_citation'].map(f => 'fields=' + f).join('&');
    const data = await json(`https://api.globalbioticinteractions.org/interaction?sourceTaxon=${encodeURIComponent(taxon)}&limit=3000&${fields}`, signal, d => Array.isArray(d.data));
    const cols = /** @type {string[]} */ (data.columns || []);
    const ix = (/** @type {string} */ c) => cols.indexOf(c);
    const [ti, ni, pi, si] = [ix('interaction_type'), ix('target_taxon_name'), ix('target_taxon_path'), ix('study_citation')];
    /** @type {Map<string, Map<string, Partner>>} */ const byRole = new Map(ROLES.map(r => [r.key, new Map()]));
    const studies = new Set();
    let total = 0;
    for (const row of data.data || []) {
      const type = row[ti], partner = row[ni];
      // The plant itself, or a partner without a name: nothing to show.
      if (!partner || partner === taxon || type === 'coOccursWith' || type === 'adjacentTo') continue;
      total++;
      if (row[si]) studies.add(row[si]);
      const role = ROLES.find(r => r.types.includes(type))?.key || 'other';
      const partners = /** @type {Map<string, Partner>} */ (byRole.get(role));
      const p = partners.get(partner) || { name: partner, group: partnerGroup(row[pi]), count: 0, types: [] };
      p.count++;
      if (!p.types.includes(type)) p.types.push(type);
      partners.set(partner, p);
    }
    const roles = ROLES.map(r => {
      const partners = [...(/** @type {Map<string, Partner>} */ (byRole.get(r.key))).values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { key: r.key, short: r.short, label: r.label, partners: partners.slice(0, 80), count: partners.length };
    }).filter(r => r.count);
    return { total, studies: studies.size, roles, url: 'https://www.globalbioticinteractions.org/?interactionType=interactsWith&sourceTaxon=' + encodeURIComponent(taxon) };
  });
}

// ── Open-Meteo: pollens and climate ──────────────────────────────────────────────────────────────────────

/** Pollens forecast by CAMS (via Open-Meteo), and the plants that make them. */
export const POLLENS = [
  { key: 'alder', label: 'Aulne', genus: ['Alnus'] },
  { key: 'birch', label: 'Bouleau', genus: ['Betula'] },
  { key: 'grass', label: 'Graminées', family: ['Poaceae'] },
  { key: 'mugwort', label: 'Armoise', genus: ['Artemisia'] },
  { key: 'olive', label: 'Olivier', genus: ['Olea'] },
  { key: 'ragweed', label: 'Ambroisie', genus: ['Ambrosia'] }
];

/** The pollen a plant makes, if CAMS forecasts it. @param {{ genus?: string, family?: string }} plant */
export const pollenOf = plant => POLLENS.find(p => p.genus?.includes(plant.genus || '') || p.family?.includes(plant.family || '')) || null;

/** Levels of a pollen count (grains/m³), as the RNSA reads them roughly. @param {number} v */
export const pollenLevel = v => v >= 80 ? { level: 4, label: 'très élevé' } : v >= 30 ? { level: 3, label: 'élevé' } : v >= 10 ? { level: 2, label: 'moyen' } : v > 1 ? { level: 1, label: 'faible' } : { level: 0, label: 'nul' };

/**
 * Today's pollens at a point: the highest hourly count of each (grains/m³), and the hour of that peak.
 * @param {[number, number]} point @param {AbortSignal} [signal]
 * @returns {Promise<{ day: string, values: Record<string, number | null> }>}
 */
export async function pollensAt(point, signal) {
  need('openmeteo');
  const [lon, lat] = at(point);
  const day = new Date().toISOString().slice(0, 10);
  return cached(`pollen:${day}:${lon},${lat}`, 3 * 3600 * 1000, async () => {
    const vars = POLLENS.map(p => p.key + '_pollen').join(',');
    const data = await json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=${vars}&forecast_days=1&timezone=auto`, signal, d => Boolean(d.hourly));
    /** @type {Record<string, number | null>} */ const values = {};
    for (const p of POLLENS) {
      const list = (data.hourly?.[p.key + '_pollen'] || []).filter((/** @type {any} */ v) => typeof v === 'number');
      values[p.key] = list.length ? Math.max(...list) : null;
    }
    return { day, values };
  });
}

/**
 * Climate of a point from ERA5 (Open-Meteo archive), ten full years: monthly mean temperature (°C) and
 * precipitation (mm), annual mean and total. @param {[number, number]} point @param {AbortSignal} [signal]
 * @returns {Promise<{ temp: number[], precip: number[], annualTemp: number, annualPrecip: number, years: string, elevation: number | null }>}
 */
export async function climateAt(point, signal) {
  need('openmeteo');
  const [lon, lat] = at(point);
  const end = new Date().getFullYear() - 1;
  const start = end - 9;
  return cached(`climate:${start}-${end}:${lon},${lat}`, 365 * DAY, async () => {
    const data = await json(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}-01-01&end_date=${end}-12-31&daily=temperature_2m_mean,precipitation_sum`, signal, d => Boolean(d.daily));
    return { ...monthly(data.daily, end - start + 1), years: `${start}–${end}`, elevation: data.elevation ?? null };
  });
}

/** Monthly normals from Open-Meteo daily series over `years` years. @param {any} daily @param {number} years */
function monthly(daily, years) {
  const t = Array.from({ length: 12 }, () => [0, 0]), p = Array(12).fill(0);
  (daily?.time || []).forEach((/** @type {string} */ d, /** @type {number} */ i) => {
    const m = Number(d.slice(5, 7)) - 1;
    const temp = daily.temperature_2m_mean?.[i], rain = daily.precipitation_sum?.[i];
    if (typeof temp === 'number') { t[m][0] += temp; t[m][1]++; }
    if (typeof rain === 'number') p[m] += rain;
  });
  const temp = t.map(([sum, n]) => n ? Math.round(sum / n * 10) / 10 : NaN);
  const precip = p.map(v => Math.round(v / years));
  return { temp, precip, annualTemp: Math.round(temp.reduce((a, b) => a + b, 0) / 12 * 10) / 10, annualPrecip: precip.reduce((a, b) => a + b, 0) };
}

/**
 * Climate niche of a species: the climate (annual mean temperature, annual precipitation, from ERA5 over two
 * years) of up to 24 of its GBIF occurrences in France, spread over the country; and the altitudes at which they
 * were observed (those of the 300 occurrences that give one: most of them, 10th–90th percentile, and the extremes).
 * @param {number} gbifKey @param {AbortSignal} [signal]
 * @returns {Promise<{ points: { coordinates: [number, number], temp: number, precip: number }[], years: string, altitudes: Altitudes | null } | null>}
 */
export async function climateNiche(gbifKey, signal) {
  need('openmeteo');
  need('gbif');
  const end = new Date().getFullYear() - 1;
  return cached(`niche2:${end}:${gbifKey}`, 90 * DAY, async () => {
    const occ = await json(`https://api.gbif.org/v1/occurrence/search?taxonKey=${gbifKey}&country=FR&occurrenceStatus=PRESENT&hasGeospatialIssue=false&hasCoordinate=true&limit=300`, signal, d => Array.isArray(d.results));
    /** @type {[number, number][]} */
    const all = (occ.results || []).filter((/** @type {any} */ o) => typeof o.decimalLatitude === 'number' && typeof o.decimalLongitude === 'number')
      .map((/** @type {any} */ o) => [Math.round(o.decimalLongitude * 100) / 100, Math.round(o.decimalLatitude * 100) / 100]);
    // Spread: one per 0.5° cell first, then the rest, at most 24 points.
    const cells = new Map();
    for (const p of all) { const k = Math.round(p[0] * 2) + ':' + Math.round(p[1] * 2); if (!cells.has(k)) cells.set(k, p); }
    const picked = [...cells.values()].slice(0, 24);
    if (!picked.length) return null;
    const altitudes = altitudesOf(occ.results || []);
    const data = await json(`https://archive-api.open-meteo.com/v1/archive?latitude=${picked.map(p => p[1]).join(',')}&longitude=${picked.map(p => p[0]).join(',')}&start_date=${end - 1}-01-01&end_date=${end}-12-31&daily=temperature_2m_mean,precipitation_sum`, signal, d => Array.isArray(d) || Boolean(d.daily));
    const list = Array.isArray(data) ? data : [data];
    const points = list.map((d, i) => {
      const m = monthly(d.daily, 2);
      return { coordinates: picked[i], temp: m.annualTemp, precip: m.annualPrecip };
    }).filter(p => Number.isFinite(p.temp));
    return { points, years: `${end - 1}–${end}`, altitudes };
  });
}

/** @typedef {{ low: number, high: number, min: number, max: number, n: number, of: number }} Altitudes */

/**
 * The altitudes of occurrences (GBIF's `elevation`, metres): most of them (10th–90th percentile) and the extremes,
 * when at least 5 give one. @param {any[]} results @returns {Altitudes | null}
 */
export function altitudesOf(results) {
  const z = results.map(o => o?.elevation).filter(v => typeof v === 'number' && Number.isFinite(v) && v > -500 && v < 9000).sort((a, b) => a - b);
  if (z.length < 5) return null;
  const at = (/** @type {number} */ q) => Math.round(z[Math.min(z.length - 1, Math.max(0, Math.round(q * (z.length - 1))))]);
  return { low: at(0.1), high: at(0.9), min: Math.round(z[0]), max: Math.round(z[z.length - 1]), n: z.length, of: results.length };
}

// ── IGN API Carto: natural zones at a point ──────────────────────────────────────────────────────────────

/** Kinds of zones, as API Carto's nature module names them. */
export const ZONES = [
  { key: 'pn', label: 'Parc national' },
  { key: 'pnr', label: 'Parc naturel régional' },
  { key: 'rnn', label: 'Réserve naturelle nationale' },
  { key: 'rnc', label: 'Réserve naturelle de Corse' },
  { key: 'natura-habitat', label: 'Natura 2000 (habitats)' },
  { key: 'natura-oiseaux', label: 'Natura 2000 (oiseaux)' },
  { key: 'znieff1', label: 'ZNIEFF de type I' },
  { key: 'znieff2', label: 'ZNIEFF de type II' }
];

/**
 * The natural zones containing a point, with their INPN fiche.
 * @param {[number, number]} point @param {AbortSignal} [signal]
 * @returns {Promise<{ kind: string, label: string, name: string, url: string | null }[]>}
 */
export async function zonesAt(point, signal) {
  need('ignNature');
  const [lon, lat] = at(point);
  // A kind of zone that failed is not « none of that kind »: all failing is an error, some a degraded answer.
  /** @type {unknown[]} */
  const errors = [];
  return cached(`zones:${lon},${lat}`, 30 * DAY, async () => {
    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
    const answers = await Promise.all(ZONES.map(z => json(`https://apicarto.ign.fr/api/nature/${z.key}?geom=${geom}`, signal, d => Array.isArray(d.features))
      .then(d => d.features.map((/** @type {any} */ f) => {
        const p = f.properties || {};
        const name = p.nom || p.sitename || p.nom_site || p.id_mnhn || p.sitecode || '';
        const url = p.url || (z.key.startsWith('znieff') && p.id_mnhn ? 'https://inpn.mnhn.fr/zone/znieff/' + p.id_mnhn : null);
        return { kind: z.key, label: z.label, name, url };
      }))
      .catch(error => { if (/** @type {Error} */ (error)?.name === 'AbortError') throw error; errors.push(error); return []; })));
    if (errors.length === ZONES.length) throw errors[0];
    return answers.flat().filter(z => z.name);
  }, () => errors.length > 0);
}
