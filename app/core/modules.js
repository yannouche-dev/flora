// @ts-check
// Modules: the online services the app may call. Each one can be switched off in Réglages; a module
// that is off is never called (its data and photos are not shown, cached copies included).
// Everything works offline with the local flora; modules only add data.

import { config } from '../config.js';
import { modeKeys } from './modes.js';

/**
 * @typedef {'ignMaps' | 'ignGeo' | 'ignProtected' | 'ignNature' | 'voice' | 'globi' | 'openmeteo' | 'wikibooks' | 'inaturalist' | 'gbif' | 'wikidata' | 'wikipedia' | 'commons' | 'trefle' | 'photos'} ModuleKey
 * @typedef {{ key: ModuleKey, category: import('./categories.js').CategoryKey, also: import('./categories.js').CategoryKey[], name: string, provides: string, hosts: string, needsToken?: boolean }} ModuleInfo
 */

/** @type {ModuleInfo[]} */
export const MODULES = [
  { key: 'ignMaps', category: 'territory', also: [], name: 'IGN – fonds de carte', hosts: 'data.geopf.fr (WMTS)',
    provides: 'Photos aériennes, plan IGN, cadastre, courbes de niveau, forêts publiques, espaces protégés. Désactivé : seules les zones déjà vues restent affichées.' },
  { key: 'ignGeo', category: 'territory', also: [], name: 'IGN – adresses et altitudes', hosts: 'data.geopf.fr (géocodage, altimétrie)',
    provides: 'Recherche d’adresse sur la carte, adresse et altitude d’un point ou d’un lieu.' },
  { key: 'ignProtected', category: 'territory', also: ['safety'], name: 'IGN – espaces protégés', hosts: 'data.geopf.fr (WFS, couches INPN / PatriNat)',
    provides: 'Bandeau sur les cartes quand la vue touche un parc national, une réserve naturelle ou un arrêté de biotope (dès le zoom 11).' },
  { key: 'ignNature', category: 'territory', also: ['ecology'], name: 'IGN – zones naturelles au point', hosts: 'apicarto.ign.fr (API Carto, module nature)',
    provides: 'Pour un lieu ou un point de la carte : les ZNIEFF, sites Natura 2000, parcs et réserves qui le contiennent, avec leur fiche INPN. Envoie les coordonnées du point.' },
  { key: 'inaturalist', category: 'distribution', also: ['seasons', 'images'], name: 'iNaturalist', hosts: 'api.inaturalist.org',
    provides: 'Autour (plantes observées dans un cercle), courbes de floraison et fructification, nombre d’observations, photos de repli.' },
  { key: 'gbif', category: 'distribution', also: ['names', 'images', 'knowledge', 'ecology', 'safety'], name: 'GBIF', hosts: 'api.gbif.org',
    provides: 'Descriptions, noms dans d’autres langues, occurrences en France (carte de répartition, mois, années, départements, sources), photos d’observation et planches d’herbier, habitat, synonymes, statut UICN, publications. « Près d’ici » envoie votre position à GBIF, seulement quand vous le demandez.' },
  { key: 'globi', category: 'ecology', also: [], name: 'GloBI (interactions)', hosts: 'api.globalbioticinteractions.org',
    provides: 'Pollinisateurs, visiteurs, insectes hôtes, parasites et autres interactions de la plante (Global Biotic Interactions), avec leurs sources.' },
  { key: 'openmeteo', category: 'ecology', also: ['seasons'], name: 'Open-Meteo (climat, pollens)', hosts: 'archive-api.open-meteo.com, air-quality-api.open-meteo.com',
    provides: 'Pollens du jour (CAMS, Europe), climat d’un lieu (températures et pluies par mois, ERA5) et niche climatique d’une espèce (climat de ses occurrences GBIF). Envoie les coordonnées des points.' },
  { key: 'wikidata', category: 'names', also: ['knowledge', 'safety'], name: 'Wikidata', hosts: 'www.wikidata.org',
    provides: 'Classification, statut UICN, identifiants (Tela Botanica, IPNI, POWO) ; donne aussi l’article Wikipédia.' },
  { key: 'wikipedia', category: 'knowledge', also: [], name: 'Wikipédia', hosts: 'fr.wikipedia.org',
    provides: 'L’article en français : son résumé, et ses sections (description, écologie, toxicité, alimentation, usages, noms…) chacune dans le bloc de la fiche qui en parle ; sans article français, le lien vers l’anglais (nécessite Wikidata).' },
  { key: 'wikibooks', category: 'knowledge', also: [], name: 'Wikibooks (recettes)', hosts: 'fr.wikibooks.org, en.wikibooks.org',
    provides: 'Recettes de cuisine sauvage citant la plante (livres de recettes de Wikibooks, en français et en anglais), dans le bloc « Usages et cuisine sauvage ».' },
  { key: 'commons', category: 'images', also: [], name: 'Wikimedia Commons', hosts: 'commons.wikimedia.org',
    provides: 'Galerie de photos sous licence libre, vignettes de repli.' },
  { key: 'trefle', category: 'knowledge', also: [], name: 'Trefle', hosts: 'trefle.io', needsToken: true,
    provides: 'Données de culture et descriptions (en anglais), avec votre jeton personnel.' },
  { key: 'photos', category: 'images', also: [], name: 'Photos en ligne', hosts: 'thumb.wikimedia.org, inaturalist-open-data, herbiers…',
    provides: 'Vignettes et photos des plantes (liste, carte, fiche). Désactivé : une fleur à la place des photos.' },
  { key: 'voice', category: 'tools', also: [], name: 'Dictée vocale (navigateur)', hosts: 'reconnaissance vocale du navigateur',
    provides: 'Bouton micro pour chercher une plante à la voix (Flore, Noter ici). Sur Chrome, l’audio est traité par les serveurs de Google ; sur Safari, par Apple ou sur l’appareil.' }
];

/** A module is switched off: its data is not available. */
export class ModuleOffError extends Error {
  /** @param {ModuleKey} key */
  constructor(key) {
    super('Module désactivé : ' + (MODULES.find(m => m.key === key)?.name || key));
    this.name = 'ModuleOffError';
    this.module = key;
  }
}

/** @typedef {import('./modes.js').Mode} Mode */

/**
 * Only the exceptions are stored: { gbif: { epure: false } } = GBIF off in Épuré, on elsewhere.
 * @returns {Partial<Record<ModuleKey, Partial<Record<Mode, boolean>>>>}
 */
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(config.storageKeys.modules) || '{}');
    if (!value || typeof value !== 'object') return {};
    // A module switched off everywhere was stored as `false`.
    for (const [k, v] of Object.entries(value)) if (v === false) value[k] = { epure: false, standard: false, scientific: false };
    return value;
  } catch { return {}; }
}

let state = read();

/** The mode a call happens in when the caller does not say (the app-wide mode); set by the store. */
let currentMode = () => /** @type {Mode} */ ('standard');
/** @param {() => Mode} source */
export function useModeSource(source) { currentMode = source; }
/** The mode modules follow when a caller does not give one. */
export const appMode = () => currentMode();

/** Fires `change` when a module is switched on or off, or when the mode modules follow changes. */
export const moduleEvents = new EventTarget();

/**
 * Is this service used in this mode? The plant sheet asks with its own view, the results grid with its own,
 * everything else (maps, Autour, lists) with the app mode.
 * @param {ModuleKey} key @param {Mode} [mode]
 */
export const moduleOn = (key, mode = currentMode()) => state[key]?.[mode] !== false;

/** Modules off in a mode, as a short stable string: part of cache keys, so their data never shows. @param {Mode} [mode] */
export const modulesSignature = (mode = currentMode()) => MODULES.filter(m => !moduleOn(m.key, mode)).map(m => m.key).join(',');

/** Every module × mode. @returns {Record<ModuleKey, Record<Mode, boolean>>} */
export const modulesState = () => /** @type {any} */ (Object.fromEntries(MODULES.map(m =>
  [m.key, Object.fromEntries(modeKeys().map(mode => [mode, moduleOn(m.key, mode)]))])));

/** @param {ModuleKey} key @param {Mode} mode @param {boolean} on */
export function setModule(key, mode, on) {
  const modes = { ...state[key] };
  if (on) delete modes[mode]; else modes[mode] = false;
  const next = { ...state };
  if (Object.keys(modes).length) next[key] = modes; else delete next[key];
  state = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(config.storageKeys.modules, JSON.stringify(next));
    else localStorage.removeItem(config.storageKeys.modules);
  } catch { /* not persisted */ }
  moduleEvents.dispatchEvent(new CustomEvent('change', { detail: { key, mode, on } }));
}

/** Store the exceptions of every module at once. @param {typeof state} next */
function writeAll(next) {
  state = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(config.storageKeys.modules, JSON.stringify(next));
    else localStorage.removeItem(config.storageKeys.modules);
  } catch { /* not persisted */ }
  moduleEvents.dispatchEvent(new CustomEvent('change', { detail: {} }));
}

/** A new mode uses the services of its model. @param {Mode} from @param {Mode} to */
export function copyModules(from, to) {
  const next = { ...state };
  for (const m of MODULES) {
    const modes = { ...next[m.key] };
    if (moduleOn(m.key, from)) delete modes[to]; else modes[to] = false;
    if (Object.keys(modes).length) next[m.key] = modes; else delete next[m.key];
  }
  writeAll(next);
}

/** A mode deleted: its choices go. @param {Mode} mode */
export function dropModules(mode) {
  const next = { ...state };
  for (const [k, modes] of Object.entries(next)) {
    if (!modes || !(mode in modes)) continue;
    const rest = { ...modes };
    delete rest[mode];
    if (Object.keys(rest).length) next[/** @type {ModuleKey} */ (k)] = rest; else delete next[/** @type {ModuleKey} */ (k)];
  }
  writeAll(next);
}
