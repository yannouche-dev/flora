// @ts-check
// Modules: the online services the app may call. Each one can be switched off in Réglages, for the whole device
// (a permission, whatever the display mode); a module that is off is never called (its data and photos are not
// shown, cached copies included). Hiding a block of the plant sheet never switches one.
// Everything works offline with the local flora; modules only add data.

import { config } from '../config.js';
import { definePref } from './prefs.js';

/**
 * @typedef {'ignMaps' | 'ignGeo' | 'ignProtected' | 'ignNature' | 'relief3d' | 'voice' | 'globi' | 'openmeteo' | 'wikibooks' | 'inaturalist' | 'gbif' | 'wikidata' | 'wikipedia' | 'commons' | 'trefle' | 'photos'} ModuleKey
 * @typedef {{ key: ModuleKey, category: import('./categories.js').CategoryKey, also: import('./categories.js').CategoryKey[], name: string, provides: string, hosts: string, needsToken?: boolean }} ModuleInfo
 */

/** @type {ModuleInfo[]} */
export const MODULES = [
  { key: 'ignMaps', category: 'territory', also: [], name: 'IGN – fonds de carte', hosts: 'data.geopf.fr (WMTS)',
    provides: 'Photos aériennes, plan IGN, cadastre, courbes de niveau, forêts publiques, espaces protégés. Désactivé : seules les zones déjà vues restent affichées.' },
  { key: 'ignGeo', category: 'territory', also: [], name: 'IGN – adresses et altitudes', hosts: 'data.geopf.fr (géocodage, altimétrie, toponymes BD TOPO)',
    provides: 'Recherche d’adresse sur la carte, adresse et altitude d’un point ou d’un lieu, nom du lieu où commence un parcours botanique, commune de Découvrir. Envoie les coordonnées du point, ou votre position quand c’est elle qui est cherchée.' },
  { key: 'ignProtected', category: 'territory', also: ['safety'], name: 'IGN – espaces protégés', hosts: 'data.geopf.fr (WFS, couches INPN / PatriNat)',
    provides: 'Bandeau sur les cartes quand la vue touche un parc national, une réserve naturelle ou un arrêté de biotope (dès le zoom 11).' },
  { key: 'ignNature', category: 'territory', also: ['ecology'], name: 'IGN – zones naturelles au point', hosts: 'apicarto.ign.fr (API Carto, module nature)',
    provides: 'Pour un lieu ou un point de la carte : les ZNIEFF, sites Natura 2000, parcs et réserves qui le contiennent, avec leur fiche INPN. Envoie les coordonnées du point.' },
  { key: 'relief3d', category: 'territory', also: [], name: 'Vue 3D (relief)', hosts: 's3.amazonaws.com (tuiles de relief AWS Terrain Tiles)',
    provides: 'Le relief des cartes en 3D (Réglages › Cartes) et la « Vue 3D » du récapitulatif d’un parcours et des lieux de Mes plantes : leurs plantes sur le relief (Terrain Tiles d’AWS : Mapzen, EU-DEM © Copernicus, environ 25 à 30 m de résolution). Envoie la zone de carte affichée. Désactivé : pas de « Vue 3D », et les cartes en 3D restent à plat (inclinées, sans relief).' },
  { key: 'inaturalist', category: 'distribution', also: ['seasons', 'images'], name: 'iNaturalist', hosts: 'api.inaturalist.org',
    provides: 'Autour (plantes observées dans un cercle), Découvrir, courbes de floraison et fructification, nombre d’observations, photos de repli. Autour et Découvrir envoient le centre du cercle : votre position précise quand vous touchez « Autour de moi », sinon le lieu ou la commune choisis.' },
  { key: 'gbif', category: 'distribution', also: ['names', 'images', 'knowledge', 'ecology', 'safety'], name: 'GBIF', hosts: 'api.gbif.org',
    provides: 'Descriptions, noms dans d’autres langues, occurrences en France (carte de répartition, mois, années, départements, sources), photos d’observation et planches d’herbier, habitat, synonymes, statut UICN, publications. « Près d’ici » envoie votre position à GBIF, seulement quand vous le demandez.' },
  { key: 'globi', category: 'ecology', also: [], name: 'GloBI (interactions)', hosts: 'api.globalbioticinteractions.org',
    provides: 'Pollinisateurs, visiteurs, insectes hôtes, parasites et autres interactions de la plante (Global Biotic Interactions), avec leurs sources.' },
  { key: 'openmeteo', category: 'ecology', also: ['seasons'], name: 'Open-Meteo (climat, pollens)', hosts: 'archive-api.open-meteo.com, air-quality-api.open-meteo.com',
    provides: 'Pollens du jour (CAMS, Europe), climat d’un lieu (températures et pluies par mois, ERA5) et niche climatique d’une espèce (climat de ses occurrences GBIF). Envoie les coordonnées des points.' },
  { key: 'wikidata', category: 'names', also: ['knowledge', 'safety'], name: 'Wikidata', hosts: 'www.wikidata.org, query.wikidata.org',
    provides: 'Classification, statut UICN, identifiants (Tela Botanica, IPNI, POWO) ; donne aussi l’article Wikipédia.' },
  { key: 'wikipedia', category: 'knowledge', also: [], name: 'Wikipédia', hosts: 'fr.wikipedia.org',
    provides: 'L’article en français : son résumé, et ses sections (description, écologie, toxicité, alimentation, usages, noms…) chacune dans le bloc de la fiche qui en parle ; sans article français, le lien vers l’anglais (nécessite Wikidata).' },
  { key: 'wikibooks', category: 'uses', also: [], name: 'Wikibooks (recettes)', hosts: 'fr.wikibooks.org, en.wikibooks.org',
    provides: 'Recettes de cuisine sauvage citant la plante (livres de recettes de Wikibooks, en français et en anglais), dans le bloc « Usages et cuisine sauvage ».' },
  { key: 'commons', category: 'images', also: [], name: 'Wikimedia Commons', hosts: 'commons.wikimedia.org',
    provides: 'Galerie de photos sous licence libre, vignettes de repli.' },
  { key: 'trefle', category: 'knowledge', also: [], name: 'Trefle', hosts: 'trefle.io', needsToken: true,
    provides: 'Données de culture et descriptions (en anglais), avec votre jeton personnel.' },
  { key: 'photos', category: 'images', also: [], name: 'Photos en ligne', hosts: 'thumb.wikimedia.org, upload.wikimedia.org, inaturalist-open-data.s3.amazonaws.com, static.inaturalist.org, api.gbif.org, serveurs d’images des herbiers cités par GBIF',
    provides: 'Vignettes et photos des plantes (liste, carte, fiche, Découvrir, Parcours, Mes plantes). Chaque image est demandée au serveur qui l’héberge, qui voit votre adresse IP. Désactivé : une fleur à la place des photos.' },
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

/**
 * Only the modules switched off are stored: { gbif: false }. Earlier versions kept a choice per display mode
 * ({ gbif: { epure: false } }): a module off in any mode is off everywhere — the strictest, so a service cut
 * somewhere is never called again without the user saying so.
 * @param {any} value @returns {Partial<Record<ModuleKey, false>>}
 */
function cleanModules(value) {
  /** @type {Record<string, false>} */
  const off = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return off;
  for (const [k, v] of Object.entries(value)) {
    if (v === false || (v && typeof v === 'object' && Object.values(v).includes(false))) off[k] = false;
  }
  return off;
}

// Switched on or off in another tab: this one follows (a refusal made there is never undone from here).
const pref = definePref({ key: config.storageKeys.modules, fallback: {}, clean: cleanModules,
  store: next => Object.keys(next).length ? next : null });

/** Fires `change` when a module is switched on or off (here or in another tab). */
export const moduleEvents = pref.events;

/** Is this service used on this device? @param {ModuleKey} key */
export const moduleOn = key => pref.get()[key] !== false;

/** Modules off, as a short stable string: part of cache keys, so their data never shows. */
export const modulesSignature = () => MODULES.filter(m => !moduleOn(m.key)).map(m => m.key).join(',');

/** Every module, on or off. @returns {Record<ModuleKey, boolean>} */
export const modulesState = () => /** @type {Record<ModuleKey, boolean>} */ (Object.fromEntries(MODULES.map(m => [m.key, moduleOn(m.key)])));

/** @param {ModuleKey} key @param {boolean} on */
export function setModule(key, on) {
  // From what is stored now, not this tab's copy: another tab's choices since are kept (read, changed, written
  // at once — localStorage is synchronous: nothing comes in between).
  const next = { ...pref.fresh() };
  if (on) delete next[key]; else next[key] = false;
  pref.set(next);
}
