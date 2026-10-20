// @ts-check
// The alerts of a plant, as counts for the rubric icons (like a message count): one per kind of alert, from
// the data the app carries (TAXREF statuses, the safety file, the look-alikes file — all offline).
//  - « Protection et risques »: protected (France; a region or a department), threatened in France (red list
//    CR / EN / VU), picking regulated, toxic (ANSM list, TPPT), mistaken for an edible plant (the toxic side, by name).
//  - Edible: what this edible plant can be mistaken for (the toxic plants of its confusions), and the parts concerned.
// A data file that cannot be read is an alert of its own, at the danger level: the count never falls silently to 0.

import { gravest, lookalikesOf, severityNote } from './lookalikes.js';
import { harvestRuleText } from './regulation.js';
import { safetyOf } from './uses.js';

/** @typedef {{ count: number, tone: 'danger' | 'warn', text: string[], parts?: string[] }} Alert */

/** The alert when the safety file or the look-alikes file cannot be read (no full stop: a line among others). */
export const UNREAD = 'Données de toxicité indisponibles pour le moment : ne consommez aucune plante sans vérification';

const THREATENED = ['CR', 'EN', 'VU'];

/** @param {string[]} text @param {boolean} danger @returns {Alert | null} */
const alert = (text, danger) => text.length ? { count: text.length, tone: danger ? 'danger' : 'warn', text } : null;

/**
 * `toxic`: ANSM list B or toxic parts (list A), TPPT level 2 or more, or the toxic side of a confusion. `unread`: a
 * file could not be read (then `safety` says so first).
 * @param {any} plant TAXREF record (with `statuses`)
 * @returns {Promise<{ safety: Alert | null, edible: Alert | null, toxic: boolean, unread: boolean }>}
 */
export async function alertsOf(plant) {
  const statuses = /** @type {any[]} */ (plant?.statuses || []);
  let unread = false;
  const [safety, confusions] = await Promise.all([
    safetyOf(plant).catch(() => { unread = true; return null; }),
    lookalikesOf(plant).catch(() => { unread = true; return /** @type {import('./lookalikes.js').Lookalike[]} */ ([]); })
  ]);
  /** @type {string[]} */
  const risks = unread ? [UNREAD] : [];
  let danger = unread;
  if (statuses.some(s => s.type === 'PN')) risks.push('Protégée en France');
  if (statuses.some(s => s.type === 'PR' || s.type === 'PD')) risks.push('Protégée dans des régions ou départements');
  const red = statuses.find(s => s.type === 'LRN' && THREATENED.includes(s.code));
  if (red) risks.push('Menacée en France (' + red.label.toLowerCase() + ')');
  // A picking rule in metropolitan France only (regulation.js: never a CITES annex, an overseas or invasive species list).
  const rule = harvestRuleText(statuses);
  if (rule) risks.push(rule);
  const ansm = [].concat(safety?.ansm || []);
  if (ansm.some(a => a.list === 'B')) { risks.push('Liste B de l’ANSM : toxicité de la plante'); danger = true; }
  else if (ansm.some(a => a.toxicParts)) risks.push('Liste A de l’ANSM : parties toxiques');
  if (safety?.tppt) {
    risks.push(safety.tppt.level === 0 ? 'Base TPPT : toxicité pour l’humain inconnue' : 'Toxicité : ' + safety.tppt.levelLabel);
    danger ||= safety.tppt.level >= 2;
  }
  // The toxic side: what it is mistaken for, by name (never « comestible »).
  const toxicSide = confusions.filter(c => c.side === 'toxic');
  if (toxicSide.length) {
    const sev = gravest(toxicSide).plant;
    risks.push(`${sev.charAt(0).toUpperCase() + sev.slice(1)}, confondue avec ${[...new Set(toxicSide.flatMap(c => c.others.map(o => o.label)))].join(', ')}`);
    danger = true;
  }
  const edible = confusions.filter(c => c.side === 'edible');
  const others = [...new Set(edible.flatMap(c => c.others.map(o => o.label + severityNote(c.pair))))];
  const mistaken = alert(others.map(o => 'Ne pas confondre avec ' + o), gravest(edible).danger);
  // The part the Anses says is picked (and mistaken): what Découvrir names, never « comestible ».
  if (mistaken) mistaken.parts = [...new Set(edible.map(c => c.pair.part))];
  const toxic = ansm.some(a => a.list === 'B' || a.toxicParts) || (safety?.tppt?.level ?? 0) >= 2 || toxicSide.length > 0;
  return { safety: alert(risks, danger), edible: mistaken, toxic, unread };
}

/**
 * Before a harvest is noted (« Noter ici », a place's « Récolté aujourd’hui » and « Ajouter une récolte »): why this
 * plant should not be picked to eat — ANSM list B or toxic parts, TPPT level 2 or more, the toxic side of a
 * confusion — or that the data could not be read (then it is no « nothing to say » either). Null when our sources
 * say nothing: which never means the plant is edible.
 * @param {any} plant TAXREF record
 * @returns {Promise<{ reasons: string[], unread: boolean } | null>}
 */
export async function harvestRisk(plant) {
  let unread = false;
  const [safety, confusions] = await Promise.all([
    safetyOf(plant).catch(() => { unread = true; return null; }),
    lookalikesOf(plant).catch(() => { unread = true; return /** @type {import('./lookalikes.js').Lookalike[]} */ ([]); })
  ]);
  /** @type {string[]} */
  const reasons = unread ? [UNREAD] : [];
  const ansm = /** @type {any[]} */ ([].concat(safety?.ansm || []));
  if (ansm.some(a => a.list === 'B')) reasons.push('Pharmacopée française, liste B (ANSM) : effets indésirables supérieurs au bénéfice attendu');
  for (const a of ansm.filter(a => a.list === 'A' && a.toxicParts)) reasons.push(`Parties toxiques : ${a.toxicParts} (ANSM, liste A)`);
  const tppt = safety?.tppt;
  if ((tppt?.level ?? 0) >= 2) reasons.push(`Toxicité : ${tppt.levelLabel}${tppt.parts ? ` — parties toxiques : ${tppt.parts}` : ''} (${tppt.reviewed ? 'genre toxique, revu à la main' : 'Agroscope, base TPPT'})`);
  const toxicSide = confusions.filter(c => c.side === 'toxic');
  if (toxicSide.length) reasons.push(`Plante ${gravest(toxicSide).plant}, confondue avec ${[...new Set(toxicSide.flatMap(c => c.others.map(o => o.label)))].join(', ')} (Anses, Centres antipoison)`);
  return reasons.length ? { reasons, unread } : null;
}
