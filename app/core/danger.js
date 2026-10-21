// @ts-check
// One verdict per plant: how careful to be with it, from what the app carries — the safety file (ANSM lists A and B,
// Agroscope's TPPT base), the confusions of the Anses and the Centres antipoison, the INPN statuses (protection at the
// point when it is known). Pure: the plant sheet (its Alertes badge, its Prudence), the cards of the games, « Noter
// ici » and the place editor all ask dangerLevel, so a plant has the same colour and the same word wherever it shows.
// Never « comestible », never « sans danger »: `none` only says our sources say nothing, and no chip draws it.
// Fail closed: a file that cannot be read is a reason of its own (`unread`, at the danger level), said first.

import { edibleFilter, gravest, severityNote, severityOf } from './lookalikes.js';
import { harvestRuleText } from './regulation.js';
import { appliesIn, isNational } from './territory.js';

/**
 * @typedef {'none' | 'info' | 'warn' | 'danger' | 'deadly'} Level
 * @typedef {'unread' | 'toxic-side' | 'tppt' | 'ansm-b' | 'ansm-a' | 'edible-side' | 'protected' | 'protected-elsewhere'
 *   | 'regulated' | 'threatened'} Kind
 * @typedef {{ level: Level, kind: Kind, word: string, text: string, more?: string, source: string }} Reason   `text`: the
 *   line (a card, a title); `more`: the parts it names, when the source names them; `source`: who says it
 * @typedef {{ level: Level, word: string, reasons: Reason[], unread: boolean, toxic: boolean, protected: boolean, eaten: string[] }} Verdict
 *   `toxic`: the plant itself, by our sources (ANSM list B or toxic parts, TPPT « toxique » or more, the toxic side of a
 *   confusion); `protected`: picking it is banned here (in France, or where it is when that is known); `eaten`: the parts
 *   a confusion says are picked, only for the species the source names (lookalikes.js#edibleFilter)
 * @typedef {import('./lookalikes.js').Lookalike} Lookalike
 * @typedef {import('./territory.js').Territory} Territory
 * @typedef {import('./territory.js').Status} Status
 */

/** The levels, from nothing said to deadly: a level's rank is its index. */
export const LEVELS = /** @type {const} */ (['none', 'info', 'warn', 'danger', 'deadly']);

/** @param {Level} level */
export const rank = level => LEVELS.indexOf(level);

/** The reason of a file that cannot be read (no full stop: a line among others). */
export const UNREAD = 'Données de toxicité indisponibles pour le moment : ne consommez aucune plante sans vérification';

const THREATENED = ['CR', 'EN', 'VU'];
const PROTECTION = ['PN', 'PR', 'PD'];
const CONFUSIONS = 'Anses, Centres antipoison';

/**
 * The level of one confusion, for this plant's side: « mortel » deadly; « très toxique » (grave) a danger; « toxique »
 * a danger on the toxic side (the plant itself), a warning on the edible side (its look-alike). The confusion chips of
 * the sheet and of Faux amis read it too.
 * @param {import('./lookalikes.js').Pair} pair @param {Lookalike['side']} side @returns {Level}
 */
export function confusionLevel(pair, side) {
  const sev = severityOf(pair);
  return sev.key === 'mortel' ? 'deadly' : sev.danger || side === 'toxic' ? 'danger' : 'warn';
}

/** A confusion's chip: its level, the pair's severity as its word. @param {import('./lookalikes.js').Pair} pair @param {Lookalike['side']} side */
export const confusionChip = (pair, side) => ({ level: confusionLevel(pair, side), word: severityOf(pair).tag });

/** A reason as one line, with the parts it names and its source: the harvest warning, a badge's title. @param {Reason} r */
export const reasonLine = r => r.text + (r.more ? ' — ' + r.more : '') + (r.source ? ` (${r.source})` : '');

/**
 * Its protection: banned here (in France — PN, or a national status —, or in the region or department of the point;
 * where the point is could not be read: any, fail closed), else protected elsewhere only (a warning).
 * @param {Status[]} statuses @param {Territory | null | 'unread' | undefined} territory @returns {Reason | null}
 */
function protection(statuses, territory) {
  const all = statuses.filter(s => PROTECTION.includes(s.type));
  if (!all.length) return null;
  const banned = (/** @type {string} */ text) => /** @type {Reason} */ ({ level: 'danger', kind: 'protected', word: 'Protégée', text, source: 'INPN' });
  if (all.some(s => s.type === 'PN' || isNational(s))) return banned('Espèce protégée en France : cueillette interdite');
  const areas = [...new Set(all.map(s => s.area || s.label).filter(Boolean))].slice(0, 3).join(', ');
  if (territory === 'unread') return banned(`Espèce protégée dans des régions ou départements (${areas}), peut-être ici : cueillette interdite là où elle l’est`);
  const here = territory ? all.find(s => appliesIn(s, territory)) : null;
  if (here) return banned(`Espèce protégée ici (${here.area || here.label}) : cueillette interdite`);
  return { level: 'warn', kind: 'protected-elsewhere', word: 'Protégée selon le lieu', text: `Protégée dans des régions ou départements (${areas}) : cueillette interdite là où elle l’est`, source: 'INPN' };
}

/**
 * The verdict on a plant: each reason with its level, the gravest first (in this order within a level: the data
 * unreadable, the toxic side of a confusion, TPPT, ANSM, the confusions it is the edible side of, protection, harvest
 * rules, the Red List); its level and its word are those of the first reason. Pure: the callers read the files.
 * @param {{ statuses?: Status[] | null, safety?: any, confusions?: Lookalike[] | null, unread?: boolean,
 *   territory?: Territory | null | 'unread' }} o `safety`: the safety file's entry (uses.js#safetyOf: null for none);
 *   `confusions`: lookalikes.js#lookalikesOf; `unread`: either file could not be read; `territory`: where the plant is
 *   (territory.js#territoryAt), null or none when unknown, 'unread' when it could not be read
 * @returns {Verdict}
 */
export function dangerLevel({ statuses, safety, confusions, unread = false, territory } = {}) {
  /** @type {Reason[]} */
  const reasons = [];
  const st = Array.isArray(statuses) ? statuses : [];
  const list = Array.isArray(confusions) ? confusions : [];
  if (unread) reasons.push({ level: 'danger', kind: 'unread', word: 'Toxicité inconnue', text: UNREAD, source: '' });
  // The toxic side: the dangerous plant itself, even without ANSM or TPPT data.
  const toxicSide = list.filter(l => l.side === 'toxic');
  if (toxicSide.length) {
    const sev = gravest(toxicSide);
    reasons.push({ level: sev.key === 'mortel' ? 'deadly' : 'danger', kind: 'toxic-side', word: sev.key === 'mortel' ? 'Mortelle' : sev.key === 'grave' ? 'Très toxique' : 'Toxique',
      text: `Plante ${sev.plant}, confondue avec ${[...new Set(toxicSide.flatMap(l => l.others.map(o => o.label)))].join(', ')}`, source: CONFUSIONS });
  }
  // TPPT: « toxique » (2) or more is a danger; below, a warning (level 0: listed, its toxicity to humans unknown).
  const tppt = safety?.tppt;
  if (tppt) {
    const level = Number(tppt.level) || 0;
    reasons.push({ level: level >= 2 ? 'danger' : 'warn', kind: 'tppt', word: level >= 3 ? 'Très toxique' : level >= 2 ? 'Toxique' : 'Prudence',
      text: level === 0 ? 'Toxicité pour l’humain inconnue' : 'Toxicité : ' + tppt.levelLabel,
      more: tppt.parts ? `${level >= 2 ? 'parties toxiques' : 'parties concernées'} : ${tppt.parts}` : undefined,
      source: tppt.reviewed ? 'genre toxique, revu à la main' : 'Agroscope, base TPPT' });
  }
  const ansm = /** @type {any[]} */ ([].concat(safety?.ansm || []));
  for (const b of ansm.filter(a => a.list === 'B')) {
    reasons.push({ level: 'danger', kind: 'ansm-b', word: 'Toxique', text: 'Pharmacopée française, liste B : effets indésirables supérieurs au bénéfice attendu',
      more: b.parts ? 'partie concernée : ' + b.parts : undefined, source: 'ANSM' });
  }
  // List A: a medicinal plant; only its toxic parts are a reason — named, never the whole plant.
  for (const a of ansm.filter(a => a.list === 'A' && a.toxicParts)) {
    reasons.push({ level: 'warn', kind: 'ansm-a', word: 'Parties toxiques', text: 'Parties toxiques : ' + a.toxicParts, source: 'ANSM, liste A' });
  }
  // The edible side: one reason per look-alike (its name, never « comestible »), at the pair's level.
  const seen = new Set();
  for (const l of list.filter(l => l.side === 'edible')) {
    for (const o of l.others) {
      const text = 'Ne pas confondre avec ' + o.label + severityNote(l.pair);
      if (seen.has(text)) continue;
      seen.add(text);
      reasons.push({ level: confusionLevel(l.pair, 'edible'), kind: 'edible-side', word: 'Sosie ' + severityOf(l.pair).tag, text, more: 'partie : ' + l.pair.part, source: CONFUSIONS });
    }
  }
  const prot = protection(st, territory);
  if (prot) reasons.push(prot);
  // A picking rule in metropolitan France only (regulation.js: never a CITES annex, an overseas or invasive species list).
  const rule = harvestRuleText(st);
  if (rule) reasons.push({ level: 'warn', kind: 'regulated', word: 'Réglementée', text: rule, source: 'INPN' });
  const red = st.find(s => s.type === 'LRN' && THREATENED.includes(s.code));
  if (red) reasons.push({ level: 'info', kind: 'threatened', word: 'Menacée', text: 'Menacée en France (' + String(red.label || red.code).toLowerCase() + ')', source: 'INPN, Liste rouge' });
  // The gravest first; a stable sort keeps the order above within a level.
  reasons.sort((a, b) => rank(b.level) - rank(a.level));
  const top = reasons[0];
  const toxic = ansm.some(a => a.list === 'B' || a.toxicParts) || (Number(tppt?.level) || 0) >= 2 || toxicSide.length > 0;
  // The one « comestible » filter: a part only for the species the source names, never through its genus.
  const eaten = [...new Set(list.map(l => edibleFilter(l).part).filter(/** @returns {p is string} */ p => Boolean(p)))];
  return { level: top?.level ?? 'none', word: top?.word ?? '', reasons, unread, toxic, protected: prot?.kind === 'protected', eaten };
}

/**
 * Before a harvest is noted: the warning must be answered when our sources say the plant is toxic, when they could not
 * be read, or when picking it is banned here. Not for the edible side of a confusion alone: noted, the plant's
 * look-alikes are said right after, whatever the mode (gf-capture's toast; the place editor's box).
 * @param {Verdict | null | undefined} v
 */
export const harvestStop = v => Boolean(v && (v.unread || v.toxic || v.protected));
