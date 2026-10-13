// @ts-check
// The kinds of « réglementation » (REGL) among a plant's INPN statuses, so that one rule says what each means
// everywhere (badge, Prudence, Flore filter, statut block, toasts): only a harvest rule in metropolitan France is
// a « cueillette réglementée ». CITES annexes rule trade; overseas lists (PV97: départements d'outre-mer, New
// Caledonia, the SPAW protocol of the Caribbean) and invasive species lists (introduction banned) rule no picking
// here. Codes as the BDC Statuts writes them (scripts/enrich-statuses.mjs); an unknown code is read from its label.

/** @typedef {import('./territory.js').Status} Status */
/** @typedef {'harvest' | 'trade' | 'overseas' | 'invasive' | 'other'} RegulationKind */

/** Trade: CITES annexes A and B within the EU, EU import suspensions. */
const TRADE = new Set(['CCA', 'CCB', 'CCC', 'CCD', 'UEintro']);
/** Overseas only: PV97 (prefectoral rules in the départements d'outre-mer), New Caledonia, SPAW (Caribbean). */
const OVERSEAS = new Set(['PV97', 'NCPNEI', 'NCPSEVI', 'ISPAW3']);
/** Invasive species: introduction banned. */
const INVASIVE = new Set(['FRnoEEEV']);
/** Harvest in metropolitan France, nationally: PV1 (species open to prefectoral rules), NV3 (national list, article 3). */
const HARVEST = new Set(['PV1', 'NV3']);

/**
 * What a REGL status rules; null for any other type.
 * @param {Status} s @returns {RegulationKind | null}
 */
export function regulationKind(s) {
  if (s?.type !== 'REGL') return null;
  const code = String(s.code || '');
  if (TRADE.has(code)) return 'trade';
  if (OVERSEAS.has(code)) return 'overseas';
  if (INVASIVE.has(code)) return 'invasive';
  if (HARVEST.has(code)) return 'harvest';
  const label = String(s.label || '').toLowerCase();
  if (/outre-mer|nouvelle-cal[ée]donie|province (nord|sud)|spaw/.test(label)) return 'overseas';
  if (/cites|washington|commerce|introduction dans l.union/.test(label)) return 'trade';
  if (/envahissant/.test(label)) return 'invasive';
  // A department's order (iso FR-xx) or a label about picking.
  if (/^FR-\w/.test(s.iso || '') || /cueillette|r[ée]colte|ramassage|pr[ée]fectorale|esp[èe]ces v[ée]g[ée]tales/.test(label)) return 'harvest';
  return 'other';
}

/** The REGL statuses that rule picking in metropolitan France. @param {Status[] | undefined} statuses */
export const harvestRules = statuses => (statuses || []).filter(s => regulationKind(s) === 'harvest');

/** The REGL statuses that rule trade (CITES). @param {Status[] | undefined} statuses */
export const tradeRules = statuses => (statuses || []).filter(s => regulationKind(s) === 'trade');

/** A department's (or region's) harvest rule, as opposed to PV1 / NV3, national. @param {Status} s */
export const localRule = s => /^FR-\w/.test(s.iso || '');

/**
 * One line for « Cueillette réglementée », or null: a department's order, the national list (NV3), else the national
 * list of species whose picking a prefect may regulate (PV1).
 * @param {Status[] | undefined} statuses
 */
export function harvestRuleText(statuses) {
  const rules = harvestRules(statuses);
  if (!rules.length) return null;
  if (rules.some(localRule)) return 'Cueillette réglementée dans certains départements';
  if (rules.some(s => s.code !== 'PV1')) return 'Cueillette réglementée en France métropolitaine';
  return 'Cueillette pouvant être réglementée par arrêté préfectoral';
}
