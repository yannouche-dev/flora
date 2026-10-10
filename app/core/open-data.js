// @ts-check
// Open data crossed with the flora, from APIs a browser can call without a key (checked from the deployed
// origin): GloBI (interactions between species), Open-Meteo (pollens, climate from ERA5), IGN API Carto
// (natural zones at a point). Each one is a module (Réglages › Modules); answers are cached in IndexedDB.

import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';

/** @typedef {import('./modules.js').Mode} Mode */

const DAY = 24 * 3600 * 1000;

/** @param {string} url @param {AbortSignal} [signal] */
async function json(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
  return response.json();
}

/** Cached for `ttl`; an older copy is used offline. @template T @param {string} key @param {number} ttl @param {() => Promise<T>} load @returns {Promise<T>} */
async function cached(key, ttl, load) {
  const hit = await db.get('plantDetails', key).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt < ttl) return hit.value;
  try {
    const value = await load();
    await db.put('plantDetails', { key, fetchedAt: Date.now(), value }).catch(() => {});
    return value;
  } catch (error) {
    if (hit && /** @type {Error} */ (error).name !== 'AbortError') return hit.value;
    throw error;
  }
}

/** @param {import('./modules.js').ModuleKey} key @param {Mode} [mode] */
function need(key, mode) {
  if (!moduleOn(key, mode)) throw new ModuleOffError(key);
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
 * @param {string} name scientific name @param {AbortSignal} [signal] @param {Mode} [mode] @returns {Promise<Interactions>}
 */
export async function interactions(name, signal, mode) {
  need('globi', mode);
  const taxon = String(name).split(/\s+/).slice(0, 2).join(' ');
  return cached('globi2:' + taxon, 7 * DAY, async () => {
    const fields = ['interaction_type', 'target_taxon_name', 'target_taxon_path', 'study_citation'].map(f => 'fields=' + f).join('&');
    const data = await json(`https://api.globalbioticinteractions.org/interaction?sourceTaxon=${encodeURIComponent(taxon)}&limit=3000&${fields}`, signal);
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

/** French names of GloBI's interaction types, from the plant's side. */
export const TYPE_LABELS = {
  pollinatedBy: 'pollinisée par', flowersVisitedBy: 'fleurs visitées par', visitedBy: 'visitée par', eatenBy: 'mangée par', hostOf: 'hôte de',
  hasParasite: 'parasitée par', hasParasitoid: 'hôte du parasitoïde', hasPathogen: 'maladie', hasVector: 'vecteur', mutualistOf: 'mutualiste',
  symbiontOf: 'symbiote', ectomycorrhizalHostOf: 'ectomycorhize', arbuscularMycorrhizalHostOf: 'mycorhize à arbuscules', interactsWith: 'interagit avec',
  parasiteOf: 'parasite de', hemiparasiteOf: 'hémiparasite de', eats: 'se nourrit de', hasHost: 'a pour hôte', createsHabitatFor: 'abrite',
  hasDispersalVector: 'dispersée par', epiphyteOf: 'épiphyte de', pathogenOf: 'pathogène de', visitsFlowersOf: 'visite les fleurs de', pollinates: 'pollinise'
};

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
    const data = await json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=${vars}&forecast_days=1&timezone=auto`, signal);
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
    const data = await json(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}-01-01&end_date=${end}-12-31&daily=temperature_2m_mean,precipitation_sum`, signal);
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
 * years) of up to 24 of its GBIF occurrences in France, spread over the country.
 * @param {number} gbifKey @param {AbortSignal} [signal] @param {Mode} [mode]
 * @returns {Promise<{ points: { coordinates: [number, number], temp: number, precip: number }[], years: string } | null>}
 */
export async function climateNiche(gbifKey, signal, mode) {
  need('openmeteo', mode);
  need('gbif', mode);
  const end = new Date().getFullYear() - 1;
  return cached(`niche:${end}:${gbifKey}`, 90 * DAY, async () => {
    const occ = await json(`https://api.gbif.org/v1/occurrence/search?taxonKey=${gbifKey}&country=FR&occurrenceStatus=PRESENT&hasGeospatialIssue=false&hasCoordinate=true&limit=300`, signal);
    /** @type {[number, number][]} */
    const all = (occ.results || []).filter((/** @type {any} */ o) => typeof o.decimalLatitude === 'number' && typeof o.decimalLongitude === 'number')
      .map((/** @type {any} */ o) => [Math.round(o.decimalLongitude * 100) / 100, Math.round(o.decimalLatitude * 100) / 100]);
    // Spread: one per 0.5° cell first, then the rest, at most 24 points.
    const cells = new Map();
    for (const p of all) { const k = Math.round(p[0] * 2) + ':' + Math.round(p[1] * 2); if (!cells.has(k)) cells.set(k, p); }
    const picked = [...cells.values()].slice(0, 24);
    if (!picked.length) return null;
    const data = await json(`https://archive-api.open-meteo.com/v1/archive?latitude=${picked.map(p => p[1]).join(',')}&longitude=${picked.map(p => p[0]).join(',')}&start_date=${end - 1}-01-01&end_date=${end}-12-31&daily=temperature_2m_mean,precipitation_sum`, signal);
    const list = Array.isArray(data) ? data : [data];
    const points = list.map((d, i) => {
      const m = monthly(d.daily, 2);
      return { coordinates: picked[i], temp: m.annualTemp, precip: m.annualPrecip };
    }).filter(p => Number.isFinite(p.temp));
    return { points, years: `${end - 1}–${end}` };
  });
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
  return cached(`zones:${lon},${lat}`, 30 * DAY, async () => {
    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
    const answers = await Promise.all(ZONES.map(z => json(`https://apicarto.ign.fr/api/nature/${z.key}?geom=${geom}`, signal)
      .then(d => (d.features || []).map((/** @type {any} */ f) => {
        const p = f.properties || {};
        const name = p.nom || p.sitename || p.nom_site || p.id_mnhn || p.sitecode || '';
        const url = p.url || (z.key.startsWith('znieff') && p.id_mnhn ? 'https://inpn.mnhn.fr/zone/znieff/' + p.id_mnhn : null);
        return { kind: z.key, label: z.label, name, url };
      }))
      .catch(() => [])));
    return answers.flat().filter(z => z.name);
  });
}
