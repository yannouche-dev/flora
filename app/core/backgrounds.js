// @ts-check
// The maps' backgrounds (« Fond », one at a time): the IGN plan, the aerial photos — the most recent, or those of one
// year, of a period, the historical ones —, the SPOT satellite images of one year; whether « Noms et réseaux » are
// drawn over them (the look's `landmarks`, core/map-layers.js: over the photos and SPOT's images — the plan has its
// own). Pure, without import: the start of the app checks a stored background with it (core/map-settings.js), the 2D
// maps draw it (core/ign.js), the 3D ones know it in the 2D map's layers (core/gl-style.js), the panel ▦ offers it
// (components/gf-map-options.js), a free layout's cell writes it (base=, annee=: layout/registry.js).
// Each layer's identifier, format, style and native zooms are the Géoplateforme catalogue's (data/ign-catalog.json:
// tests/unit/backgrounds.test.mjs); tools/api-health.mjs and scripts/build-ign-catalog.mjs check them against the
// service's GetCapabilities (everyBaseLayer()).
//
// A background's key (BaseKey), as the maps' look keeps it (geoflora.mapLayer, a map's own look):
//   'plan' · 'photo' (the most recent photos) · 'photo:<quand>' (a year « 2020 », a period « 2016-2020 », historical
//   ones « 1950-1965 ») · 'spot:<année>' (2013 … 2025).
// The photos of a year or of a period cover the départements flown then: under them, the most recent photos, greyed
// and pale (`grey`: map.css in 2D, raster-saturation, -contrast and -brightness-min in 3D — never mistaken for the black
// and white historical ones), fill the others. Any other key is none (parseBase: null), never one an object inherits
// (« constructor »).

/**
 * @typedef {'plan' | 'photo' | `photo:${string}` | `spot:${string}`} BaseKey
 * @typedef {'plan' | 'photo' | 'spot'} BaseKind
 * @typedef {{ id: string, format: string, style?: string, minNative?: number, maxNative?: number, grey?: boolean }} BaseLayer
 *   a WMTS layer (core/ign-layers.js WmtsLayer); `grey`: drawn without its colours (the most recent photos under a year's)
 * @typedef {object} Background
 * @property {BaseKey} key
 * @property {BaseKind} kind
 * @property {string | null} when   its year or its years (« 2020 », « 2016-2020 »); null: the most recent (and the plan)
 * @property {string} label          in French (« Photos aériennes de 2016 à 2020 »)
 * @property {BaseLayer[]} layers    the WMTS layers drawn, bottom first
 */

/** @type {BaseLayer} */
const PLAN = { id: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', maxNative: 19 };
/** The most recent photos of each place (the whole country, kept up to date). @type {BaseLayer} */
const PHOTO = { id: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', maxNative: 19 };

/**
 * The photos of one year, of a period (the catalogue's « Photographies aériennes par année »: ORTHOIMAGERY.ORTHOPHOTOS
 * then the year, JPEG), the historical ones (« … historiques »: ORTHOIMAGERY.ORTHOPHOTOS. then the years, PNG, a style
 * of their own), the SPOT images of one year (« Images SPOT 6-7 »: ORTHOIMAGERY.ORTHO-SAT.SPOT. then the year, JPEG):
 * each with its native zooms [min, max], the most recent first.
 * @type {[string, number, number][]}
 */
const YEARS = [
  ['2024', 6, 19], ['2023', 6, 19], ['2022', 6, 19], ['2021', 6, 19], ['2020', 6, 19], ['2019', 6, 18], ['2018', 0, 18],
  ['2017', 0, 18], ['2016', 0, 18], ['2015', 0, 18], ['2014', 0, 18], ['2013', 0, 18], ['2012', 6, 18], ['2011', 6, 18],
  ['2010', 6, 18], ['2009', 6, 18], ['2008', 6, 18], ['2007', 6, 18], ['2006', 6, 18], ['2005', 6, 18], ['2004', 6, 18],
  ['2003', 6, 18], ['2002', 6, 18], ['2001', 6, 18], ['2000', 6, 18]
];
/** @type {[string, number, number][]} */
const PERIODS = [['2021-2023', 6, 19], ['2016-2020', 6, 19], ['2011-2015', 6, 18], ['2006-2010', 6, 18], ['2000-2005', 6, 18]];
/** @type {[string, number, number][]} */
const HISTORIC = [['1980-1995', 3, 18], ['1965-1980', 3, 18], ['1950-1965', 0, 18]];
const SPOT = ['2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015', '2014', '2013'];

/** What the panel ▦ offers (the most recent first): the photos' years, periods and historical ones; SPOT's years. */
export const PHOTO_YEARS = YEARS.map(([w]) => w);
export const PHOTO_PERIODS = PERIODS.map(([w]) => w);
export const PHOTO_HISTORIC = HISTORIC.map(([w]) => w);
export const SPOT_YEARS = [...SPOT];
/** The latest SPOT images: what « Satellite » shows without a year. */
export const LATEST_SPOT = SPOT[0];

/** A year or years, short: « 2020 », « 2016 – 2020 ». @param {string} when */
export const whenLabel = when => when.replace('-', ' – ');

/** « en 2020 », « de 2016 à 2020 ». @param {string} when */
const whenWords = when => /^(\d{4})-(\d{4})$/.test(when) ? when.replace(/^(\d{4})-(\d{4})$/, 'de $1 à $2') : 'en ' + when;

/** « de 2020 », « de 2016 à 2020 ». @param {string} when */
const ofWhen = when => whenWords(when).replace(/^en /, 'de ');

/** Every background, by its key (a Map: never a key an object inherits). @type {Map<string, Background>} */
const ALL = new Map();
/** @param {BaseKey} key @param {BaseKind} kind @param {string | null} when @param {string} label @param {BaseLayer[]} layers */
const add = (key, kind, when, label, layers) => { ALL.set(key, { key, kind, when, label, layers }); };

add('plan', 'plan', null, 'Plan IGN', [PLAN]);
add('photo', 'photo', null, 'Photos aériennes', [PHOTO]);
// Under a year's, a period's or the historical photos: the most recent ones, greyed, where they have none.
const FILLER = { ...PHOTO, grey: true };
for (const [when, minNative, maxNative] of [...YEARS, ...PERIODS]) {
  add(`photo:${when}`, 'photo', when, 'Photos aériennes ' + ofWhen(when), [FILLER, { id: 'ORTHOIMAGERY.ORTHOPHOTOS' + when, format: 'image/jpeg', minNative, maxNative }]);
}
for (const [when, minNative, maxNative] of HISTORIC) {
  add(`photo:${when}`, 'photo', when, 'Photos aériennes historiques ' + ofWhen(when),
    [FILLER, { id: 'ORTHOIMAGERY.ORTHOPHOTOS.' + when, format: 'image/png', style: 'BDORTHOHISTORIQUE', minNative, maxNative }]);
}
for (const year of SPOT) add(`spot:${year}`, 'spot', year, 'Images satellite SPOT ' + ofWhen(year), [{ id: 'ORTHOIMAGERY.ORTHO-SAT.SPOT.' + year, format: 'image/jpeg', minNative: 0, maxNative: 17 }]);

/** A background from its key; null: none (anything else — a key of another version, a typing error, « constructor »). @param {unknown} key @returns {Background | null} */
export const parseBase = key => typeof key === 'string' ? ALL.get(key) ?? null : null;

/** One of the backgrounds. @param {unknown} key @returns {key is BaseKey} */
export const isBaseKey = key => parseBase(key) !== null;

/** Its WMTS layers, bottom first ([]: not a background). Never written to. @param {unknown} key @returns {BaseLayer[]} */
export const baseLayers = key => parseBase(key)?.layers ?? [];

/** Its name in French (« Images satellite SPOT de 2020 »); '' for none. @param {unknown} key */
export const baseLabel = key => parseBase(key)?.label ?? '';

/** Its kind — plan, aerial photos, satellite —, null for none. @param {unknown} key @returns {BaseKind | null} */
export const baseKind = key => parseBase(key)?.kind ?? null;

/**
 * What a background under a year's photos says (the panel ▦, below its choice): where those are missing, the most
 * recent ones, greyed — and from very far too when those start at a closer zoom (most: their first native zoom 6, shown
 * in 2D from 5, core/ign.js; in 3D from its own). null: nothing to say (one layer). @param {unknown} key @returns {string | null}
 */
export function fillerNote(key) {
  const b = parseBase(key);
  if (!b?.when || !b.layers.some(l => l.grey)) return null;
  const far = (b.layers.at(-1)?.minNative ?? 0) > 0 ? ` De très loin aussi : celles ${ofWhen(b.when)} apparaissent en s’approchant.` : '';
  return `Là où l’IGN n’a pas photographié ${whenWords(b.when)} : les photos les plus récentes, en gris pâle.${far}`;
}

/**
 * The background a free layout's cell says (base=, annee=): a kind without a year, its most recent (SPOT: its latest
 * year); a year without a kind, the photos' (else SPOT's). null: none — a year that kind has not, the plan with a year.
 * @param {string | null | undefined} kind @param {string | null | undefined} when @returns {BaseKey | null}
 */
export function baseKeyOf(kind, when) {
  if (!when) return kind === 'spot' ? `spot:${LATEST_SPOT}` : kind === 'photo' || kind === 'plan' ? kind : null;
  if (kind === 'plan') return null;
  if (kind !== 'spot' && ALL.has(`photo:${when}`)) return `photo:${when}`;
  if (kind !== 'photo' && ALL.has(`spot:${when}`)) return `spot:${when}`;
  return null;
}

/**
 * A background as a cell's address writes it: its kind (base=), its year or years (annee=; null: the most recent, SPOT's
 * latest too — the address says « spot » alone). @param {unknown} key @returns {{ base: BaseKind | null, annee: string | null }}
 */
export function addressOf(key) {
  const b = parseBase(key);
  if (!b) return { base: null, annee: null };
  return { base: b.kind, annee: b.kind === 'spot' && b.when === LATEST_SPOT ? null : b.when };
}

/** Every year or period a cell's annee= takes (SPOT's and the photos' years, then the periods, the historical ones), the most recent first. */
export const ALL_WHENS = [...new Set([...SPOT, ...PHOTO_YEARS, ...PHOTO_PERIODS, ...PHOTO_HISTORIC])];

/**
 * Whether « Noms et réseaux » are drawn over this background (those the look says: core/map-layers.js LANDMARKS): the
 * photos' and SPOT's; the plan has its own. @param {unknown} key
 */
export const takesLandmarks = key => { const kind = baseKind(key); return kind === 'photo' || kind === 'spot'; };

/** Every WMTS layer of the backgrounds, once each (the tools check each is still served). @returns {BaseLayer[]} */
export const everyBaseLayer = () => [...new Map([...ALL.values()].flatMap(b => b.layers).map(l => [l.id, l])).values()];
