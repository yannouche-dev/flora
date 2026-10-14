// @ts-check
// A cell said in a few French words (« Carte · Floraison du moment · 2 km »): its component, its block, its intent, the
// settings written in it — for the block picker (gf-block-picker.js: the cell's card, its groups' rows « Plan IGN ·
// 2D », the intents' cards). Read from the registry's schema (registry.js), never from a
// component by name. Pure, tested under Node (tests/unit/block-picker.test.mjs).

import { defaultOf, distanceLabel, readValue, resolve, same } from './registry.js';
import { parse } from './grammar.js';

/**
 * @typedef {import('./registry.js').ParamSpec} ParamSpec
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {Resolved & { known: true }} Known
 */

/** A label's first letter in lower case (« Vue 3D » → « vue 3D »). @param {string} s */
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * A value of a parameter in French, as short as it can be said: a distance « 2 km »; a choice its label; a yes « Vue
 * 3D », a no « sans vue 3D », or the parameter's first word for no (off: « 2D », « France »); a list its labels joined
 * by « + » (« aucune » when empty); words as written; a plant's number « plante n° 128268 ». null: as by default.
 * @param {ParamSpec} ps @param {unknown} v @returns {string | null}
 */
export function valueLabel(ps, v) {
  if (v === null || v === undefined) return null;
  switch (ps.kind) {
    case 'distance': return distanceLabel(/** @type {number} */ (v));
    case 'bool': {
      if (v) return ps.label;
      const off = ps.off?.[0];
      return !off ? 'sans ' + lower(ps.label) : off.length <= 3 ? off.toUpperCase() : off.charAt(0).toUpperCase() + off.slice(1);
    }
    case 'list': {
      const vs = /** @type {string[]} */ (v);
      return vs.length ? vs.map(x => ps.values?.[x] ?? x).join(' + ') : `${ps.label} : aucune`;
    }
    case 'id': return 'plante n° ' + v;
    case 'text': return String(v);
    default: return ps.values?.[/** @type {string} */ (v)] ?? String(v);
  }
}

/** The intent parameter of a component (its key), if it has one. @param {Known} r @returns {string | null} */
export const intentKey = r => Object.keys(r.spec.params).find(k => r.spec.params[k].kind === 'intent') ?? null;

/**
 * What a cell's intent gives (each parameter's value, read), when one is written; {} else.
 * @param {Known} r @param {string} [intent] another intent than the cell's @returns {Record<string, unknown>}
 */
export function bundleOf(r, intent) {
  const k = intentKey(r);
  if (!k) return {};
  const ps = r.spec.params;
  const v = intent ?? (r.given.has(k) ? r.params[k] : null);
  const bundle = v ? ps[k].bundles?.[v] ?? {} : {};
  return Object.fromEntries(Object.entries(bundle).filter(([p]) => ps[p]).map(([p, text]) => [p, readValue(ps[p], text)]));
}

/** Whether a parameter is written in the cell, beyond what its intent gives (the picker's dot ●). @param {Known} r @param {string} k */
export function changed(r, k) {
  const ps = r.spec.params[k];
  if (!r.given.has(k) || ps.kind === 'intent') return false;
  const b = bundleOf(r);
  return !(k in b && same(b[k], r.params[k]));
}

/**
 * A parameter's value as the cell has it: written, or given by its intent, or its default — the one the others make
 * (ctl: the controls of ui and the intent, registry.js#defaultOf). @param {Known} r @param {string} k @returns {unknown}
 */
export const valueOf = (r, k) => r.params[k] ?? defaultOf(r.spec.params[k], r.params);

/**
 * The chips that say a cell (« Carte », « Floraison du moment », « 2 km »): its component's title, its block's, its
 * intent (not the default one), then each setting written in it, in the component's order (those its intent gives are
 * the intent's). An unknown component: its name, « inconnu ».
 * @param {Resolved} r @returns {string[]}
 */
export function cellChips(r) {
  if (!r.known) return [r.title, 'inconnu'];
  const chips = [r.spec.title];
  if (r.view) chips.push(r.view.title);
  const ik = intentKey(r);
  if (ik && r.given.has(ik) && r.params[ik] !== r.spec.params[ik].def) chips.push(/** @type {string} */ (valueLabel(r.spec.params[ik], r.params[ik])));
  for (const k of Object.keys(r.spec.params)) {
    if (k === ik || !changed(r, k)) continue;
    const ps = r.spec.params[k];
    const label = valueLabel(ps, r.params[k]);
    if (label === null) continue;
    chips.push(ps.kind === 'text' && ps.frame ? `« ${label} »` : ps.kind === 'text' ? `${ps.label} : ${label}` : label);
  }
  return chips;
}

/** A cell written alone (« map(floraison,r=2km) »), its chips. @param {string} text @returns {string[]} */
export function textChips(text) {
  const cell = parse(text).tree.kids[0];
  return cell?.t === 'cell' ? cellChips(resolve(cell)) : [];
}

/**
 * One line for a group of settings: the values that are not the default (or the intent's: said too, they are what
 * the cell shows), joined by « · » — « Plan IGN · 2D » —, three at most then « … »; none: « Par défaut ».
 * @param {Known} r @param {string[]} keys @returns {string}
 */
export function groupSummary(r, keys) {
  const said = keys.filter(k => {
    const ps = r.spec.params[k];
    return ps.kind !== 'intent' && (r.given.has(k) || r.implied.has(k)) && !same(r.params[k], defaultOf(ps, r.params));
  }).map(k => valueLabel(r.spec.params[k], r.params[k])).filter(s => s !== null);
  if (!said.length) return 'Par défaut';
  return said.slice(0, 3).join(' · ') + (said.length > 3 ? ' · …' : '');
}
