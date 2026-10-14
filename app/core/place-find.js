// @ts-check
// A place typed as words (« mirabel, menetrol, 63 », « Fontainebleau 77 », « Paris ») found among the IGN geocoder's
// answers (core/geoservices.js#findPlace asks; here only pure functions, tested under Node):
//  - parsePlace: the words read — a name, then a commune after a comma, and a French département at the end (2 digits,
//    2A / 2B, 3 for overseas, or a postcode, alone after a comma or after a space: « Fontainebleau 77 »);
//  - candidateOf: a feature of the geocoder (its `poi` index: lieux-dits, summits, hills, forests…; its `address` index:
//    communes) as one shape: its name, its communes' codes and names, its point;
//  - rankPlaces: the best of them, or null. Rules, in order:
//      1. a département said: only places in it (a commune's INSEE code or postcode starting with it) — never a
//         far-away homonym;
//      2. a commune said (« mirabel, menetrol »): the commune found first (a commune of that name, in the
//         département); then a place whose name matches the first words, in that commune (its name among the place's
//         communes, or its INSEE code) or within NEAR_KM of its centre — the best match first (the same name, every
//         word of it, then a significant word of it), then in the commune, then the nearest, then the geocoder's score;
//         none: the commune itself; the commune not found either: a matching place in the département, as without one;
//      3. no commune said: a commune of exactly that name (« Ménétrol », « Paris »), else a place matching it (the best
//         match, then the geocoder's score), else a commune whose name holds every word.
//    Ties keep the geocoder's order (its score). The label found (« Puy de Mirabel (Ménétrol) », « Ménétrol (63) ») is
//    what the scope then shows, so a wrong guess is seen and can be corrected.

/**
 * @typedef {{ text: string, name: string, commune: string | null, dept: string | null }} PlaceQuery
 * @typedef {{ kind: 'poi' | 'municipality', name: string, citycodes: string[], postcodes: string[], cities: string[],
 *   coordinates: [number, number], score: number }} Candidate   coordinates: [lon, lat]
 * @typedef {{ label: string, coordinates: [number, number], kind: 'poi' | 'municipality' }} FoundPlace
 */

/** A place said in a commune: this far from its centre at most (km) when its own communes do not name it. */
export const NEAR_KM = 10;

/** A département code: 2 digits, 2A / 2B (Corsica), 3 digits overseas (971–976). */
const DEPT = /^(?:2[AB]|97[1-6]|\d{2})$/i;
const POSTCODE = /^\d{5}$/;

/** Words that do not tell a place from another (« Puy de Mirabel » and « Colline de Mirabel » share « mirabel » only). */
const GENERIC = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'en', 'sur', 'sous', 'et', 'au', 'aux', 'a',
  'puy', 'mont', 'colline', 'bois', 'foret', 'lac', 'etang', 'col', 'pic', 'roc', 'rocher', 'plateau', 'vallee', 'lieu', 'dit']);

/** Lower case, without accents, hyphens and apostrophes as spaces, « st » as « saint ». @param {string} s */
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`\-_.,/()]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b(st|ste)\b/g, w => w === 'st' ? 'saint' : 'sainte');
}

/** A département from a code or a postcode (« 63 », « 2a », « 63200 » → « 63 », « 97411 » → « 974 », « 20000 » → « 20 »). @param {string} code */
function deptOf(code) {
  const c = code.toUpperCase();
  if (POSTCODE.test(c)) return c.startsWith('97') ? c.slice(0, 3) : c.slice(0, 2);
  return c;
}

/**
 * The words typed, read: a name, a commune, a département. Null when there is no name.
 * @param {string} text @returns {PlaceQuery | null}
 */
export function parsePlace(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
  /** @type {string | null} */
  let dept = null;
  const last = parts[parts.length - 1] ?? '';
  if (parts.length > 1 && (DEPT.test(last) || POSTCODE.test(last))) { dept = deptOf(last); parts.pop(); }
  else {
    // « Fontainebleau 77 », « Ménétrol 63200 »: the code after a space (a name left before it).
    const m = /^(.+?)\s+(\d{5}|2[AB]|97[1-6]|\d{2})$/i.exec(last);
    if (m) { dept = deptOf(m[2]); parts[parts.length - 1] = m[1]; }
  }
  const name = parts[0] ?? '';
  if (!normalize(name)) return null;
  return { text: clean, name, commune: parts[1] || null, dept };
}

/** The first value of a field that may be a list. @param {any} v @returns {string[]} */
const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String).filter(Boolean);

/**
 * A feature of the geocoder (GeoJSON, /geocodage/search) as a candidate; null when it has no point or no name.
 * @param {any} f @returns {Candidate | null}
 */
export function candidateOf(f) {
  const p = f?.properties ?? {};
  const c = f?.geometry?.coordinates;
  const coordinates = /** @type {[number, number]} */ ([Number(c?.[0] ?? p.x), Number(c?.[1] ?? p.y)]);
  if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return null;
  const poi = p._type === 'poi' || (p._type == null && p.toponym != null);
  const name = poi ? (p.toponym ?? list(p.name)[0] ?? '') : (p.name ?? p.city ?? p.label ?? '');
  if (!String(name).trim()) return null;
  return {
    kind: poi ? 'poi' : 'municipality',
    name: String(name).trim(),
    citycodes: list(p.citycode ?? (poi ? null : p.id)),
    postcodes: list(p.postcode),
    cities: list(p.city ?? (poi ? null : p.name)),
    coordinates,
    score: Number(p.score) || 0
  };
}

/** Whether a candidate lies in a département (its INSEE code or postcode). @param {Candidate} c @param {string} dept */
function inDept(c, dept) {
  const d = dept.toUpperCase();
  // Corsica: INSEE 2A / 2B, postcodes 20xxx (« 20 » said: either).
  const corse = d === '20' || d === '2A' || d === '2B';
  if (c.citycodes.length) return c.citycodes.some(code => { const k = code.toUpperCase(); return d === '20' ? /^(2A|2B|20)/.test(k) : k.startsWith(d); });
  return c.postcodes.some(code => code.startsWith(corse ? '20' : d));
}

/**
 * How well a name matches what was typed: 3 the same, 2 every word of it, 1 a significant word of it, 0 none.
 * @param {string} typed @param {string} name
 */
export function matchLevel(typed, name) {
  const a = normalize(typed), b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 3;
  const words = new Set(b.split(' '));
  const typedWords = a.split(' ');
  if (typedWords.every(w => words.has(w))) return 2;
  return typedWords.some(w => w.length >= 3 && !GENERIC.has(w) && words.has(w)) ? 1 : 0;
}

/** Distance between two points (km, haversine). @param {[number, number]} a @param {[number, number]} b */
function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A candidate's département, for a commune's label: its INSEE code's first digits. @param {Candidate} c */
function deptLabel(c) {
  const code = c.citycodes[0] ?? c.postcodes[0] ?? '';
  return code ? (code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2)) : '';
}

/** What the scope shows of a candidate. @param {Candidate} c @returns {FoundPlace} */
export function foundOf(c) {
  const city = c.cities.find(x => normalize(x) !== normalize(c.name));
  const d = deptLabel(c);
  const label = c.kind === 'poi' ? (city ? `${c.name} (${city})` : c.name) : d ? `${c.name} (${d})` : c.name;
  return { label: label.slice(0, 80), coordinates: c.coordinates, kind: c.kind };
}

/**
 * The commune said, among the geocoder's communes: the same name first, then every word; in the département.
 * @param {string} typed @param {Candidate[]} communes @param {string | null} dept @returns {Candidate | null}
 */
export function pickCommune(typed, communes, dept) {
  return communes
    .map((c, i) => ({ c, i, m: matchLevel(typed, c.name) }))
    .filter(x => x.c.kind === 'municipality' && x.m >= 2 && (!dept || inDept(x.c, dept)))
    .sort((x, y) => y.m - x.m || y.c.score - x.c.score || x.i - y.i)[0]?.c ?? null;
}

/**
 * The best place for what was typed (the rules at the head of this file), or null.
 * @param {PlaceQuery} q
 * @param {{ pois?: Candidate[], communes?: Candidate[], commune?: Candidate | null }} found
 *   pois: the geocoder's places for q.name; communes: its communes for q.name (no commune said); commune: the commune
 *   said, found (pickCommune)
 * @returns {FoundPlace | null}
 */
export function rankPlaces(q, { pois = [], communes = [], commune = null }) {
  const dept = q.dept;
  const ok = (/** @type {Candidate} */ c) => !dept || inDept(c, dept);
  const scored = pois.map((c, i) => ({ c, i, m: matchLevel(q.name, c.name) })).filter(x => x.c.kind === 'poi' && x.m >= 1 && ok(x.c));
  if (q.commune && commune) {
    const town = normalize(commune.name);
    const near = scored.map(x => ({ ...x, own: x.c.cities.some(n => normalize(n) === town) || x.c.citycodes.some(k => commune.citycodes.includes(k)), d: km(x.c.coordinates, commune.coordinates) }))
      .filter(x => x.own || x.d <= NEAR_KM)
      .sort((x, y) => y.m - x.m || Number(y.own) - Number(x.own) || x.d - y.d || y.c.score - x.c.score || x.i - y.i);
    return foundOf(near[0]?.c ?? commune);
  }
  const best = (/** @type {typeof scored} */ xs) => xs.sort((x, y) => y.m - x.m || y.c.score - x.c.score || x.i - y.i)[0]?.c ?? null;
  if (!q.commune) {
    const towns = communes.map((c, i) => ({ c, i, m: matchLevel(q.name, c.name) })).filter(x => x.c.kind === 'municipality' && ok(x.c));
    const exact = best(towns.filter(x => x.m === 3));
    if (exact) return foundOf(exact);
    const place = best(scored);
    if (place) return foundOf(place);
    const town = best(towns.filter(x => x.m === 2));
    return town ? foundOf(town) : null;
  }
  // A commune said but not found: a matching place in the département, as without one.
  const place = best(scored);
  return place ? foundOf(place) : null;
}
