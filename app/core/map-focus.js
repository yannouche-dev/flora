// @ts-check
// The plant sheet's data talks to its maps. A value shown in a block (a région, a month, a kind of record,
// an occurrence near here, a herbarium sheet, a look-alike…) can be touched when the sheet has a map: the
// maps of the sheet (pinned or in the flow) then show it — GBIF occurrences filtered on it, a point to fly
// to, or a second plant to compare. Touching the same value again, or ✕ on the map's chip, clears it.

/**
 * @typedef {{ kind: 'filter', label: string, params: Record<string, string> }} FilterFocus
 *   GBIF occurrences filtered (gadmGid, month, year, basisOfRecord, datasetKey, country)
 * @typedef {{ kind: 'point', label: string, coordinates: [number, number], url?: string }} PointFocus
 * @typedef {{ kind: 'compare', label: string, taxon: string }} CompareFocus  a second plant, by its scientific name
 * @typedef {FilterFocus | PointFocus | CompareFocus} MapFocus
 * @typedef {{ filter: FilterFocus | null, point: PointFocus | null, compare: CompareFocus | null }} SheetFocus
 */

export const FOCUS_EVENT = 'gf-map-focus';

/** @returns {SheetFocus} */
export const noFocus = () => ({ filter: null, point: null, compare: null });

/** Same value (to toggle it off). @param {MapFocus | null | undefined} f */
export function focusId(f) {
  if (!f) return '';
  if (f.kind === 'filter') return 'filter:' + Object.entries(f.params).sort().map(([k, v]) => k + '=' + v).join('&');
  if (f.kind === 'point') return 'point:' + f.coordinates.map(v => v.toFixed(5)).join(',');
  return 'compare:' + f.taxon;
}

/** Is this value the one shown? @param {SheetFocus | null | undefined} focus @param {MapFocus} f */
export const isFocused = (focus, f) => Boolean(focus) && focusId(focus?.[f.kind]) === focusId(f);

/** The sheet's focus with this value set, or cleared when it was already the one. @param {SheetFocus} focus @param {MapFocus} f @returns {SheetFocus} */
export const toggleFocus = (focus, f) => ({ ...focus, [f.kind]: isFocused(focus, f) ? null : f });

/** Tells the sheet to show this value on its maps. @param {Element} from @param {MapFocus} f */
export function sendFocus(from, f) {
  from.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: f, bubbles: true, composed: true }));
}

/** Labels of GBIF filters, for the chip and the credit. */
export const FILTER_NAMES = { gadmGid: 'zone', month: 'mois', year: 'année', basisOfRecord: 'type de relevé', datasetKey: 'source', country: 'pays' };

/** Filters that are places: the map frames their occurrences (the others keep France). @param {Record<string, string>} params */
export const isPlaceFilter = params => 'gadmGid' in params || 'country' in params;
