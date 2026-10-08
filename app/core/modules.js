// @ts-check
// Modules: the online services the app may call. Each one can be switched off in Réglages; a module
// that is off is never called (its data and photos are not shown, cached copies included).
// Everything works offline with the local flora; modules only add data.

import { config } from '../config.js';

/**
 * @typedef {'ignMaps' | 'ignGeo' | 'inaturalist' | 'gbif' | 'wikidata' | 'wikipedia' | 'commons' | 'trefle' | 'photos'} ModuleKey
 * @typedef {{ key: ModuleKey, name: string, provides: string, hosts: string, needsToken?: boolean }} ModuleInfo
 */

/** @type {ModuleInfo[]} */
export const MODULES = [
  { key: 'ignMaps', name: 'IGN – fonds de carte', hosts: 'data.geopf.fr (WMTS)',
    provides: 'Photos aériennes, plan IGN, cadastre, courbes de niveau, forêts publiques, espaces protégés. Désactivé : seules les zones déjà vues restent affichées.' },
  { key: 'ignGeo', name: 'IGN – adresses et altitudes', hosts: 'data.geopf.fr (géocodage, altimétrie)',
    provides: 'Recherche d’adresse sur la carte, adresse et altitude d’un point ou d’un lieu.' },
  { key: 'inaturalist', name: 'iNaturalist', hosts: 'api.inaturalist.org',
    provides: 'Autour (plantes observées dans un cercle), courbes de floraison et fructification, nombre d’observations, photos de repli.' },
  { key: 'gbif', name: 'GBIF', hosts: 'api.gbif.org',
    provides: 'Descriptions, noms dans d’autres langues, répartition, médias, occurrences en France.' },
  { key: 'wikidata', name: 'Wikidata', hosts: 'www.wikidata.org',
    provides: 'Classification, statut UICN, identifiants (Tela Botanica, IPNI, POWO) ; donne aussi l’article Wikipédia.' },
  { key: 'wikipedia', name: 'Wikipédia', hosts: 'fr.wikipedia.org',
    provides: 'Résumé de l’article en français (nécessite Wikidata).' },
  { key: 'commons', name: 'Wikimedia Commons', hosts: 'commons.wikimedia.org',
    provides: 'Galerie de photos sous licence libre, vignettes de repli.' },
  { key: 'trefle', name: 'Trefle', hosts: 'trefle.io', needsToken: true,
    provides: 'Données de culture et descriptions (en anglais), avec votre jeton personnel.' },
  { key: 'photos', name: 'Photos en ligne', hosts: 'thumb.wikimedia.org, inaturalist-open-data, herbiers…',
    provides: 'Vignettes et photos des plantes (liste, carte, fiche). Désactivé : 🌿 à la place des photos.' }
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

/** @returns {Partial<Record<ModuleKey, boolean>>} only the switched-off modules are stored */
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(config.storageKeys.modules) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

let state = read();

/** Fires `change` when a module is switched on or off. */
export const moduleEvents = new EventTarget();

/** @param {ModuleKey} key */
export const moduleOn = key => state[key] !== false;

/** Off modules, as a short stable string: part of cache keys, so data of a module switched off never shows. */
export const modulesSignature = () => MODULES.filter(m => !moduleOn(m.key)).map(m => m.key).join(',');

/** @returns {Record<ModuleKey, boolean>} */
export const modulesState = () => /** @type {any} */ (Object.fromEntries(MODULES.map(m => [m.key, moduleOn(m.key)])));

/** @param {ModuleKey} key @param {boolean} on */
export function setModule(key, on) {
  const next = { ...state };
  if (on) delete next[key]; else next[key] = false;
  state = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(config.storageKeys.modules, JSON.stringify(next));
    else localStorage.removeItem(config.storageKeys.modules);
  } catch { /* not persisted */ }
  moduleEvents.dispatchEvent(new CustomEvent('change', { detail: { key, on } }));
}
