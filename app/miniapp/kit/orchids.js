// @ts-check
// Les orchidées de la colline de Mirabel (app/miniapps/orchidees.js): what is pure about them — the site, the orchids
// asked of the sources (Orchidaceae, in iNaturalist's and GBIF's numbers; every observation they give but plants
// grown, and those whose point is not where the plant was), each observation's orchid (the flora's plant, else its
// name without its author, however far it was named: the species, the genus only, above it), its genus, what protects
// it where the circle is (INPN: protected here, a red list, endemic), and the light filters — genus, protection and
// statuses, a name — applied to the map and the list together, each choice counted in observations. No DOM, no
// network: tested under Node (tests/unit/orchids.test.mjs).

import { fold } from '../../core/fold.js';
import { fullName, plantOfPoint } from '../../core/nearby.js';
import { appliesIn, isNational } from '../../core/territory.js';

/**
 * @typedef {import('../../core/observations.js').Obs} Obs
 * @typedef {import('../../core/observations.js').ObsFilters} ObsFilters
 * @typedef {import('../../core/nearby.js').NearbySpecies} NearbySpecies
 * @typedef {import('../../core/territory.js').Territory} Territory
 * @typedef {import('../../core/territory.js').Status} Status
 * @typedef {{ here: string | null, red: string | null, endemic: boolean }} Facts   `here`: protected where the circle is
 *   (where, as the INPN names it: « France », « Auvergne »); `red`: on a red list there, in words (« vulnérable (Auvergne) »)
 * @typedef {'species' | 'genus' | 'higher'} Rank   how far an observation was named: to the species (or below it, a
 *   hybrid too), to the genus only, above it (a family, a tribe: the genus not given)
 * @typedef {{ key: string, plant: any, name: string, common: string | null, genus: string | null, rank: Rank, inat: number, gbif: number,
 *   facts: Facts | null, words: string }} Orchid   `plant`: the flora's record (null: not in it, no sheet); `words`: its
 *   names folded, for the search
 * @typedef {Obs & { orchid: string }} OrchidPoint   an observation and its orchid's key
 * @typedef {{ points: OrchidPoint[], orchids: Orchid[] }} Orchids
 * @typedef {{ genera?: string[], marks?: string[], query?: string }} OrchidFilters
 * @typedef {{ value: string, label: string, count: number, title?: string }} Choice
 * @typedef {{ points: OrchidPoint[], orchids: Orchid[], genera: Choice[], marks: Choice[] }} Shown
 * @typedef {Orchids & { key: string, failed: import('../../core/observations.js').ObsFailure[], totals: { inat: number | null, gbif: number | null },
 *   vague: number, error: { text: string, retry: boolean, offline?: boolean } | null }} Found   what the sources gave for a
 *   circle (the manifest's data): `key` the circle and the attempt it answers (askedKey: the screen knows what is still
 *   coming), `vague` the observations of the circle left out (their point hidden, or rougher than the circle), `error`
 *   no source answered (`offline`: the device was, it is asked again when it is back)
 */

/** The colline de Mirabel, at Ménétrol (Puy-de-Dôme), [lon, lat]: the circle's centre as it starts. */
export const SITE = /** @type {[number, number]} */ (Object.freeze([3.111, 45.869]));
/** The circle's radius as it starts, in metres (one of the slider's stops, core/distance.js STOPS). */
export const RADIUS = 500;
/** The orchids in each source's numbers: iNaturalist's taxon, GBIF Backbone's key (core/observations.js ObsTaxon). */
export const ORCHIDACEAE = Object.freeze({ inat: 47217, gbif: 7689 });
/**
 * What is asked of the sources: every observation they give (any quality grade, any rank, with a photo or not) of both,
 * but the plants grown (iNaturalist's captive ones, GBIF's managed, cultivated, planted): wild orchids only. Their
 * points where the plants were only (core/observations.js `precise`): at 500 m, a hidden or rough one would be drawn
 * on the hill though seen elsewhere.
 */
export const ORCHID_FILTERS = /** @type {ObsFilters} */ (Object.freeze({ sources: ['inat', 'gbif'], qualite: ['recherche', 'aidentifier', 'occasionnelles'], taxon: 'tous', photos: 'toutes', sauvages: true, jeux: [], sansjeux: [] }));

/** What is asked of the sources, as one key: the circle and the attempt (« Réessayer »). @param {{ point: unknown, radius: unknown, retry: unknown }} c */
export const askedKey = c => JSON.stringify([c.point, c.radius, c.retry]);

/** The genus chip of the observations named above it (a family, a subfamily, a tribe: « Orchidaceae »). */
export const NO_GENUS = '?';
/** A rank above the genus: Orchidaceae, Orchidoideae, Orchideae, Orchidinae. */
const ABOVE_GENUS = /(aceae|oideae|eae|inae)$/i;

/**
 * The genus an orchid is counted under: the flora's, else its name's first word (an intergeneric hybrid with its
 * sign: « × Dactylodenia »); none when the name is above the genus. @param {string | null | undefined} genus
 */
export const genusWord = genus => genus && !ABOVE_GENUS.test(genus) ? genus : null;

/**
 * A name outside the flora without its author, and how far it goes (Rank): its second word, the hybrid's sign aside,
 * is an epithet when it starts in lower case (« Ophrys aranifera », « Orchis × hybrida »: the species), else its
 * author (« Ophrys L. »: the genus only; « Orchidaceae Juss. »: above it) — as iNaturalist names the same group.
 * @param {string} name @returns {{ name: string, rank: Rank }}
 */
export function nameRank(name) {
  const words = String(name || '').replace(/×/g, ' × ').trim().split(/\s+/);
  const sign = words[0] === '×' || words[0] === 'x' ? '× ' : '';
  const [first = '', second = ''] = words.filter(w => w !== '×' && w !== 'x');
  if (/^[a-zà-ÿ]/.test(second)) return { name: String(name).trim(), rank: 'species' };
  return { name: sign + first, rank: genusWord(first) ? 'genus' : 'higher' };
}

const PROTECTION = ['PN', 'PR', 'PD'];
/** A red list's categories that say a plant is at risk, in words (« LC », « DD » do not). */
const RED = /** @type {Record<string, string>} */ ({ RE: 'disparue', CR: 'en danger critique', EN: 'en danger', VU: 'vulnérable', NT: 'quasi menacée' });
/** France's own lists named « France », whatever area the INPN writes (« France métropolitaine »). @param {Status} s */
const whereOf = s => isNational(s) ? 'France' : s.area || s.label;

/**
 * What protects a plant of the flora where the circle is (INPN, Base de connaissance Statuts): protected in France,
 * else by its region or department there — the circle's place unknown, any regional or departmental protection
 * counts (fail closed, as core/danger.js); on a red list of France, else of the region there; endemic (or
 * subendemic) of France (TAXREF). None for a plant outside the flora.
 * @param {any} record @param {Territory | null} territory @returns {Facts | null}
 */
export function factsOf(record, territory) {
  if (!record) return null;
  /** @type {Status[]} */
  const st = Array.isArray(record.statuses) ? record.statuses : [];
  const prot = st.filter(s => PROTECTION.includes(s.type));
  const national = prot.find(s => s.type === 'PN' || isNational(s));
  const local = prot.find(s => !isNational(s) && (!territory || appliesIn(s, territory)));
  const shield = national ?? local;
  const lists = st.filter(s => s.code in RED && (s.type === 'LRN' || (s.type === 'LRR' && territory && appliesIn(s, territory))));
  const red = lists.find(s => s.type === 'LRN') ?? lists[0];
  return {
    here: shield ? whereOf(shield) : null,
    red: red ? `${RED[red.code]} (${whereOf(red)})` : null,
    endemic: ['E', 'S'].includes(record.status?.france)
  };
}

/**
 * The key of an orchid among the observations: the flora's plant, else its name without its author (nameRank) — not
 * iNaturalist's taxon: GBIF's record of the same genus has none. @param {number | null | undefined} plantId @param {string} name
 */
const keyOf = (plantId, name) => plantId != null ? 'p' + plantId : 'n' + fullName(nameRank(name).name);

/**
 * The orchids of the observations (core/nearby.js speciesOf: each one once, whichever source saw it, matched to the
 * flora), the most observed first, each with its observations counted by source, its genus, how far it was named, its
 * record and what protects it here; each observation with its orchid's key. An observation the flora says is not an
 * orchid (a source that answered wider than asked) is left out; one the flora does not know is kept, without a sheet
 * — by its name, iNaturalist's and GBIF's of the same group as one (« Ophrys », « Ophrys L. »).
 * @param {Obs[]} points @param {NearbySpecies[]} list @param {Map<string, number>} plantOf
 * @param {Map<number, any>} records the flora's records of the plants found @param {Territory | null} territory
 * @returns {Orchids}
 */
export function gatherOrchids(points, list, plantOf, records, territory) {
  /** @type {Map<string, Orchid>} */
  const by = new Map();
  /** @type {Set<string>} */
  const other = new Set();
  for (const s of list) {
    const key = keyOf(s.plantId, s.name);
    if (s.family && s.family !== 'Orchidaceae') { other.add(key); continue; }
    const had = by.get(key);
    // The same group named by both sources: once, the French name of either.
    if (had) { had.common ??= s.common; had.words = fold(`${had.words} ${s.common ?? ''}`); continue; }
    const plant = s.plantId != null ? records.get(s.plantId) ?? null : null;
    const own = nameRank(s.name);
    // The flora's French name first: the one its sheet says.
    const common = plant?.vernacularNames?.[0] || s.common || null;
    const genus = genusWord(plant?.genus || s.genus);
    by.set(key, { key, plant, name: plant?.scientificName || own.name, common, genus, rank: plant ? 'species' : own.rank, inat: 0, gbif: 0, facts: factsOf(plant, territory),
      words: fold([common, own.name, plant?.scientificName, genus, ...(plant?.vernacularNames ?? [])].filter(Boolean).join(' ')) });
  }
  /** @type {OrchidPoint[]} */
  const out = [];
  for (const p of points) {
    if (!p.sci) continue;
    const key = keyOf(plantOfPoint(plantOf, p), p.sci);
    const o = by.get(key);
    if (!o || other.has(key)) continue;
    if (p.kind === 'gbif') o.gbif++; else o.inat++;
    out.push({ ...p, orchid: key });
  }
  const orchids = [...by.values()].filter(o => o.inat + o.gbif > 0)
    .sort((a, b) => (b.inat + b.gbif) - (a.inat + a.gbif) || (a.common || a.name).localeCompare(b.common || b.name, 'fr'));
  return { points: out, orchids };
}

/** The protection and statuses an orchid may have, in their order: its chip's words, and what it means. */
export const MARKS = /** @type {const} */ ([
  { value: 'protegee', label: 'Protégée ici', title: 'Protection nationale, ou de la région ou du département du lieu (INPN)' },
  { value: 'liste-rouge', label: 'Liste rouge', title: 'Sur la liste rouge de France ou de la région du lieu : disparue, en danger critique, en danger, vulnérable ou quasi menacée (INPN)' },
  { value: 'endemique', label: 'Endémique', title: 'Endémique ou subendémique de France (TAXREF)' }
]);

/** An orchid has this protection or status. @param {Orchid} o @param {string} mark */
export const hasMark = (o, mark) => Boolean(o.facts && (mark === 'protegee' ? o.facts.here : mark === 'liste-rouge' ? o.facts.red : mark === 'endemique' && o.facts.endemic));

/**
 * The observations and orchids the filters keep, and the choices of each filter counted in observations among those
 * the other filters keep (as the app's facets count): the genera (the most observed first; « Genre non précisé »
 * last), the protection and statuses (in their order). A choice none of the observations has is left out, unless
 * chosen. Within a filter, any choice; between them, all: a name (each of its words in one of the orchid's names,
 * case and accents aside), one of the genera, one of the protections or statuses. An orchid outside the flora has
 * no status: it goes as soon as one is chosen.
 * @param {Orchids} found @param {OrchidFilters} [f] @returns {Shown}
 */
export function filterOrchids(found, { genera = [], marks = [], query = '' } = {}) {
  const words = fold(query).split(' ').filter(Boolean);
  const named = (/** @type {Orchid} */ o) => words.every(w => o.words.includes(w));
  const inGenus = (/** @type {Orchid} */ o) => !genera.length || genera.includes(o.genus ?? NO_GENUS);
  const marked = (/** @type {Orchid} */ o) => !marks.length || marks.some(m => hasMark(o, m));
  const byKey = new Map(found.orchids.map(o => [o.key, o]));
  /** @type {Map<string, number>} */ const perGenus = new Map();
  /** @type {Map<string, number>} */ const perMark = new Map();
  /** @type {OrchidPoint[]} */ const points = [];
  for (const p of found.points) {
    const o = byKey.get(p.orchid);
    if (!o || !named(o)) continue;
    const g = inGenus(o), m = marked(o);
    if (m) perGenus.set(o.genus ?? NO_GENUS, (perGenus.get(o.genus ?? NO_GENUS) ?? 0) + 1);
    if (g) for (const { value } of MARKS) if (hasMark(o, value)) perMark.set(value, (perMark.get(value) ?? 0) + 1);
    if (g && m) points.push(p);
  }
  const shown = new Set(points.map(p => p.orchid));
  /** @type {Choice[]} */
  const genusChoices = [...new Set([...perGenus.keys(), ...genera])]
    .map(value => ({ value, label: value === NO_GENUS ? 'Genre non précisé' : value, count: perGenus.get(value) ?? 0 }))
    .sort((a, b) => Number(a.value === NO_GENUS) - Number(b.value === NO_GENUS) || b.count - a.count || a.label.localeCompare(b.label, 'fr'));
  return {
    points,
    orchids: found.orchids.filter(o => shown.has(o.key)),
    genera: genusChoices,
    marks: MARKS.filter(x => perMark.has(x.value) || marks.includes(x.value)).map(x => ({ ...x, count: perMark.get(x.value) ?? 0 }))
  };
}

/** Any filter on. @param {OrchidFilters} f */
export const filtering = f => Boolean(f.genera?.length || f.marks?.length || fold(f.query ?? ''));

/** The same point, within a metre or so (a long press on the map, the circle's centre). @param {unknown} a @param {[number, number]} b */
export const sameSpot = (a, b) => Array.isArray(a) && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
