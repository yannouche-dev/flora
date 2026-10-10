// @ts-check
// The alerts of a plant, as counts for the rubric icons (like a message count): one per kind of alert, from
// the data the app carries (TAXREF statuses, the safety file, the look-alikes file — all offline).
//  - « Protection et risques »: protected (France; a region or a department), threatened in France (red list
//    CR / EN / VU), picking regulated, toxic (ANSM list, TPPT), mistaken for an edible plant (the toxic side).
//  - Edible: what this edible plant can be mistaken for (the toxic plants of its confusions).

import { lookalikesOf } from './lookalikes.js';
import { safetyOf } from './uses.js';

/** @typedef {{ count: number, tone: 'danger' | 'warn', text: string[] }} Alert */

const THREATENED = ['CR', 'EN', 'VU'];

/** @param {string[]} text @param {boolean} danger @returns {Alert | null} */
const alert = (text, danger) => text.length ? { count: text.length, tone: danger ? 'danger' : 'warn', text } : null;

/**
 * @param {any} plant TAXREF record (with `statuses`)
 * @returns {Promise<{ safety: Alert | null, edible: Alert | null }>}
 */
export async function alertsOf(plant) {
  const statuses = /** @type {any[]} */ (plant?.statuses || []);
  const [safety, confusions] = await Promise.all([safetyOf(plant).catch(() => null), lookalikesOf(plant).catch(() => [])]);
  /** @type {string[]} */
  const risks = [];
  let danger = false;
  if (statuses.some(s => s.type === 'PN')) risks.push('Protégée en France');
  if (statuses.some(s => s.type === 'PR' || s.type === 'PD')) risks.push('Protégée dans des régions ou départements');
  const red = statuses.find(s => s.type === 'LRN' && THREATENED.includes(s.code));
  if (red) risks.push('Menacée en France (' + red.label.toLowerCase() + ')');
  if (statuses.some(s => s.type === 'REGL')) risks.push('Cueillette réglementée');
  const ansm = [].concat(safety?.ansm || []);
  if (ansm.some(a => a.list === 'B')) { risks.push('Liste B de l’ANSM : toxicité de la plante'); danger = true; }
  else if (ansm.some(a => a.toxicParts)) risks.push('Liste A de l’ANSM : parties toxiques');
  if (safety?.tppt) { risks.push('Toxicité : ' + safety.tppt.levelLabel); danger ||= safety.tppt.level >= 2; }
  const toxicSide = confusions.find(c => c.side === 'toxic');
  if (toxicSide) { risks.push(`${toxicSide.pair.severity === 'mortel' ? 'Mortelle' : 'Toxique'}, confondue avec une plante comestible`); danger = true; }
  const edible = confusions.filter(c => c.side === 'edible');
  const others = [...new Set(edible.flatMap(c => c.others.map(o => o.label + (c.pair.severity === 'mortel' ? ' (mortel)' : ''))))];
  return {
    safety: alert(risks, danger),
    edible: alert(others.map(o => 'Ne pas confondre avec ' + o), edible.some(c => c.pair.severity === 'mortel'))
  };
}
