// @ts-check
// What a plant's sheet and a block alone share: the plant read and its errors, its data loaded block by block (details,
// Wikipédia, Wikidata, GBIF, open data, safety files), and each block's content as a view shows it. gf-plant-detail.js
// lays the blocks out (rubrics, panes, King, the action bar); gf-sheet-block.js draws one alone.

import { LitElement, html, css, nothing } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { commonOf, nameOf } from '../core/plants.js';
import { StoreController, whenReady } from '../core/store.js';
import { formatDistance, getMembership, promoteFavorites } from '../core/collections.js';
import { lastFix, oneFix } from '../core/geo.js';
import { savedRadius } from '../core/nearby.js';
import { href } from '../core/router.js';
import * as sources from '../core/sources.js';
import { moduleOn, modulesSignature } from '../core/modules.js';
import { baseOf } from '../core/modes.js';
import './gf-attribution.js';
import './gf-plant-spots.js';
import './gf-calendar.js';
import './gf-status.js';
import './gf-lookalikes.js';
import { emergency } from '../core/poison.js';
import './gf-sheet-map.js';
import { ONE_GL_PER_SHEET } from './map3d-options.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import {
  isMap, mapConfig, setMapConfig, blockOrder, blockStyle, blockTitle, isTitleShown, isHidden, isNote, isSubHidden, noteText, setNoteText, shownSubs, paneOf
} from '../core/sheet-blocks.js';
import { gripStyles } from '../core/split-grip.js';
import { FOCUS_EVENT, isFocused, noFocus, toggleFocus } from '../core/map-focus.js';
import * as openData from '../core/open-data.js';
import * as usesData from '../core/uses.js';
import { gravest, lookalikesOf, severityNote } from '../core/lookalikes.js';
import { harvestRuleText } from '../core/regulation.js';
import { dangerLevel, rank } from '../core/danger.js';
import { photosOffLine, severityChip, severityStyles } from './ui-kit.js';
import { formatAltitude } from '../core/altitude.js';
import { chartStyles, climateChart, groupColor, groupLegend, networkChart, nicheChart } from '../core/charts.js';
import { unsafeCSS } from 'lit';
import './gf-media-viewer.js';
import './gf-web-pane.js';
import { notesEvents } from '../core/sheet-notes.js';
import { sheetSession } from '../core/sheet-session.js';
import { openModal } from '../core/history.js';
import { hideImg, dropFigure, showImg } from '../core/img.js';
import { safeUrl } from '../core/safe-url.js';
import { forgetFailures } from '../core/cache.js';
import { isUnavailable } from '../core/net.js';
import { sourceDown } from '../core/source-state.js';

/** Remote text is untrusted HTML: keep only its text content (DOMParser never runs scripts). */
function toText(/** @type {string} */ value) {
  const { body } = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  body.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  return body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

/** The safety file or the look-alikes file could not be read (_open.safety, _open.confusions): never « nothing known ». */
const UNREAD = Object.freeze({ unread: true });

/** A plant in none of our confusions: said so, without reassuring. */
export const NO_CONFUSION = 'Aucune confusion de notre liste (Anses, Centres antipoison) ne concerne cette plante : cela ne garantit pas l’absence de risque.';

/**
 * The loads each block reads (#loadExtras, #loadGbif; 'details:<service>': a service the details could not reach):
 * one that failed makes the block say « Source indisponible — Réessayer » (audit STO-8), not « aucune donnée ».
 * @type {Record<string, string[]>}
 */
const BLOCK_LOADS = {
  wikipedia: ['wiki', 'details:wikidata'],
  descriptions: ['gbif:descriptions', 'details:gbif'],
  names: ['gbif:vernacularNames', 'details:gbif'],
  occurrences: ['gbif:stats', 'gbif:distributions', 'details:gbif'],
  gbifMedia: ['gbif:photos', 'gbif:herbarium', 'details:gbif'],
  gbifProfile: ['gbif:speciesProfiles', 'details:gbif'],
  literature: ['gbif:literature', 'details:gbif'],
  interactions: ['globi'],
  climate: ['niche', 'details:gbif'],
  uses: ['uses:wikidata', 'uses:recipes', 'details:wikidata'],
  taxonomy: ['science', 'gbif:synonyms', 'details:wikidata', 'details:gbif'],
  status: ['science', 'gbif:iucn'],
  ids: ['science', 'details:gbif', 'details:inaturalist', 'details:wikidata'],
  photos: ['details:commons', 'details:inaturalist'],
  trefle: ['details:trefle']
};

/** Loads whose value is in _open, by load key. @type {Record<string, string>} */
const OPEN_KEYS = { globi: 'interactions', niche: 'niche', 'uses:wikidata': 'wdUses', 'uses:recipes': 'recipes' };

const truncate = (/** @type {string} */ text, max = 900) =>
  text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text;

const commonsKey = (/** @type {string | undefined} */ url) => {
  try { return decodeURIComponent(url || '').replace(/_/g, ' ').toLowerCase(); } catch { return url || ''; }
};

/**
 * Builds the gallery: the dataset thumbnail first, then free-licensed Commons images,
 * then the iNaturalist default photo; deduplicated by Commons page.
 */
function gallery(plant, details) {
  const images = [];
  const seen = new Set();
  const add = (/** @type {any} */ image) => {
    const key = commonsKey(image.sourceUrl || image.pageUrl || image.url);
    if (!image.url || seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };

  if (plant.thumbnail?.url) add(plant.thumbnail);
  for (const image of details?.commons || []) {
    add({ ...image, url: image.thumbnail || image.url, source: 'Wikimedia Commons' });
  }
  const inat = details?.identifiers?.inaturalist;
  if (inat?.photo?.url) {
    add({
      url: inat.photo.url,
      attribution: inat.photo.attribution,
      license: inat.photo.license,
      source: 'iNaturalist',
      sourceUrl: 'https://www.inaturalist.org/taxa/' + inat.id
    });
  }
  return images;
}

/** GBIF descriptions, French first, then English; one per type. @param {any} gbif the sheet's GBIF data */
function descriptions(gbif) {
  const rows = gbif?.descriptions?.results || [];
  const order = { fra: 0, fre: 0, fr: 0, eng: 1, en: 1 };
  const byType = new Map();
  rows
    .filter(row => row.description && row.language in order)
    .sort((a, b) => order[a.language] - order[b.language])
    .forEach(row => {
      const type = row.type || 'description';
      if (!byType.has(type)) byType.set(type, { ...row, text: truncate(toText(row.description)) });
    });
  return [...byType.values()].filter(row => row.text).slice(0, 4);
}

/** @param {any} gbif */
function distributions(gbif) {
  const rows = gbif?.distributions?.results || [];
  const seen = new Set();
  return rows
    .map(row => ({
      place: row.locality || row.country || row.locationId,
      means: row.establishmentMeans,
      // An ISO country code (some checklists): the map can show the occurrences there.
      country: /^[A-Z]{2}$/.test(row.country || '') ? row.country : /^ISO3166:[A-Z]{2}$/i.test(row.locationId || '') ? row.locationId.slice(-2).toUpperCase() : null
    }))
    .filter(row => row.place && !seen.has(row.place) && seen.add(row.place))
    .slice(0, 24);
}

/** @param {any} plant @param {any} gbif */
function gbifFrenchNames(plant, gbif) {
  const known = new Set((plant.vernacularNames || []).map(name => name.toLowerCase()));
  const names = (gbif?.vernacularNames?.results || [])
    .filter(row => /^(fra|fre|fr)$/.test(row.language || ''))
    .map(row => row.vernacularName)
    .filter(name => name && !known.has(name.toLowerCase()) && known.add(name.toLowerCase()));
  return names.slice(0, 12);
}

/**
 * Wikipédia's sections by theme: their name, and the block of the sheet that shows them beside its own data
 * (none: they stay in the Wikipédia block).
 */
export const WIKI_THEMES = /** @type {Record<string, [string, string | null]>} */ ({
  description: ['Description', 'descriptions'], biology: ['Biologie et floraison', 'calendar'], ecology: ['Habitat et écologie', 'gbifProfile'],
  distribution: ['Répartition', 'occurrences'], toxicity: ['Toxicité et confusions', 'uses'], food: ['Alimentation', 'uses'], uses: ['Usages', 'uses'],
  names: ['Noms et étymologie', 'names'], history: ['Histoire et symbolique', null], taxonomy: ['Taxonomie', null], other: ['Autres sujets', null]
});
/** A section's text: at first, its beginning only. */
const WIKI_SHORT = 600;

/**
 * A name's key, for the duplicates written differently: case, accents, hyphens and apostrophes, an article in
 * front (« la », « l’ »), plurals (« Orties »), spaces. @param {string} name
 */
function nameKey(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-‐‑’'`´_.]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(le|la|les|l|the|der|die|das|el|il|lo|los|las)\s+/, '')
    .split(' ').map(w => w.length > 3 ? w.replace(/(s|x)$/, '') : w).join(' ');
}

/** How well a name is written: its accents (the first letter gets its capital anyway). @param {string} name */
const nameCare = name => name.normalize('NFD').length - name.length;

/**
 * Names without their duplicates: lists split (« grande ortie, ortie dioïque »), the same name written
 * differently counted once — its best-written form kept, at the place of its first one; the first letter in
 * capital. `except`: names already shown elsewhere (the title).
 * @param {(string | null | undefined)[]} names @param {(string | null | undefined)[]} [except] @returns {string[]}
 */
export function dedupNames(names, except = []) {
  const skip = new Set(except.filter(Boolean).map(n => nameKey(String(n))));
  /** @type {Map<string, string>} */
  const kept = new Map();
  for (const raw of names) {
    for (const part of String(raw || '').split(/\s*[,;/]\s*|\s+ou\s+/)) {
      const name = part.replace(/\s+/g, ' ').trim();
      if (name.length < 2) continue;
      const key = nameKey(name);
      if (!key || skip.has(key)) continue;
      const had = kept.get(key);
      if (!had || nameCare(name) > nameCare(had)) kept.set(key, name);
    }
  }
  return [...kept.values()].map(n => n.charAt(0).toLocaleUpperCase('fr') + n.slice(1));
}

const STATUS_TYPES = {
  PN: 'Protection nationale',
  PR: 'Protection régionale',
  PD: 'Protection départementale',
  REGL: 'Réglementation (cueillette, commerce)',
  LRN: 'Liste rouge nationale',
  LRR: 'Liste rouge régionale'
};

/** « 12 % » of a total. @param {number} n @param {number} total */
const percent = (n, total) => total ? (n / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: n / total < 0.1 ? 1 : 0 }) + ' %' : '';

/** « Près d’ici » was asked once in this visit: later sheets look around without asking again. */
let nearAllowed = false;
/** My position used for pollen and climate once in this visit: later sheets show them without asking. */
let hereAllowed = false;

/** Kinds of GBIF records, in French. */
const BASIS_LABELS = {
  HUMAN_OBSERVATION: 'Observations', OBSERVATION: 'Observations (autres)', MACHINE_OBSERVATION: 'Observations automatiques',
  PRESERVED_SPECIMEN: 'Spécimens d’herbier', LIVING_SPECIMEN: 'Spécimens vivants (jardins)', MATERIAL_SAMPLE: 'Échantillons',
  MATERIAL_CITATION: 'Citations de publications', FOSSIL_SPECIMEN: 'Fossiles', OCCURRENCE: 'Non précisé'
};

/** IUCN Red List categories, in French. */
const IUCN_LABELS = {
  EX: 'Éteinte', EW: 'Éteinte à l’état sauvage', CR: 'En danger critique', EN: 'En danger', VU: 'Vulnérable',
  NT: 'Quasi menacée', LC: 'Préoccupation mineure', DD: 'Données insuffisantes', NE: 'Non évaluée'
};

/** Habitats and life forms of GBIF species profiles that read the same in any checklist, in French. */
/** @type {[RegExp, string][]} */
const HABITATS = [[/terrestr|terr[ií]cola/i, 'terrestre'], [/fresh|dulce|douce|dulcícola/i, 'eau douce'], [/brackish|saumâtre|salobre/i, 'eau saumâtre'], [/marine|marin/i, 'marin']];
/** @type {[RegExp, string][]} */
const LIFE_FORMS = [
  [/^(herb|herbaceous|hierba|erva|herbacée)s?$/i, 'herbacée'], [/^(shrub|arbusto|arbuste)s?$/i, 'arbuste'], [/^(subshrub|subarbusto|sous-arbrisseau)s?$/i, 'sous-arbrisseau'],
  [/^(tree|árbol|arbre|árvore)s?$/i, 'arbre'], [/climb|vine|liana|trepadeira|grimpante/i, 'grimpante'],
  [/geophyt/i, 'géophyte'], [/hemicryptophyt/i, 'hémicryptophyte'], [/chamaephyt/i, 'chaméphyte'], [/therophyt/i, 'thérophyte'], [/phanerophyt/i, 'phanérophyte']
];

/**
 * What GBIF species profiles agree on: habitats and life forms (only values that translate cleanly), and the
 * checklists that flag the plant as invasive somewhere. @param {any} gbif
 */
function profile(gbif) {
  const rows = gbif?.speciesProfiles?.results || [];
  /** @type {Map<string, number>} */ const habitats = new Map();
  /** @type {Map<string, number>} */ const forms = new Map();
  /** @type {string[]} */ const invasive = [];
  const count = (/** @type {Map<string, number>} */ m, /** @type {string} */ k) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of rows) {
    const found = new Set();
    for (const [re, label] of HABITATS) if (re.test(String(r.habitat || ''))) found.add(label);
    if (r.terrestrial) found.add('terrestre');
    if (r.freshwater) found.add('eau douce');
    if (r.marine) found.add('marin');
    found.forEach(h => count(habitats, h));
    const lifeForm = String(r.lifeForm || '');
    if (lifeForm && !lifeForm.startsWith('{')) for (const part of lifeForm.split(/[,;|/]/)) {
      const label = LIFE_FORMS.find(([re]) => re.test(part.trim()))?.[1];
      if (label) count(forms, label);
    }
    if (r.isInvasive === true && r.source && !invasive.includes(r.source)) invasive.push(r.source);
  }
  const sorted = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1]);
  return { habitats: sorted(habitats), forms: sorted(forms), invasive, sources: rows.length };
}

/** GBIF synonyms that TAXREF does not list (names compared without authors). @param {any} plant @param {any} gbif */
function gbifSynonyms(plant, gbif) {
  const known = (plant.synonyms || []).map((/** @type {string} */ n) => n.toLowerCase());
  /** @type {string[]} */ const out = [];
  for (const r of gbif?.synonyms?.results || []) {
    const canonical = r.canonicalName || r.scientificName;
    // Shown with its rank and author (« Urtica dioica subsp. eudioica Selander »), compared without them.
    const name = r.scientificName || canonical;
    if (!canonical || out.includes(name)) continue;
    const lower = canonical.toLowerCase();
    if (lower === String(plant.scientificName).toLowerCase() || known.some((/** @type {string} */ k) => k === lower || k.startsWith(lower + ' '))) continue;
    out.push(name);
  }
  return out.slice(0, 30);
}

/** Vernacular names in other languages (GBIF), grouped by language. @param {any} gbif */
function otherNames(gbif) {
  const byLang = new Map();
  for (const row of gbif?.vernacularNames?.results || []) {
    const lang = row.language || '';
    if (!row.vernacularName || /^(fra|fre|fr)$/.test(lang)) continue;
    byLang.set(lang, [...byLang.get(lang) || [], row.vernacularName]);
  }
  return [...byLang].map(([lang, list]) => [lang, dedupNames(list).slice(0, 4)]).slice(0, 12);
}

/** Trefle species record (user's own token): its scalar facts, flattened. */
function trefleFacts(details) {
  const t = details?.trefle;
  if (!t) return [];
  const facts = [];
  const add = (/** @type {string} */ label, /** @type {any} */ value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('cm' in value || 'mm' in value) return add(label, value.cm != null ? value.cm + ' cm' : value.mm != null ? value.mm + ' mm' : null);
      for (const [k, v] of Object.entries(value)) add(label + ' · ' + k.replace(/_/g, ' '), v);
      return;
    }
    facts.push([label, Array.isArray(value) ? value.join(', ') : String(value)]);
  };
  add('common name', t.common_name);
  add('observations', t.observations);
  add('duration', t.duration);
  add('edible', t.edible);
  add('edible part', t.edible_part);
  add('vegetable', t.vegetable);
  for (const key of ['specifications', 'growth', 'flower', 'foliage', 'fruit_or_seed']) add(key.replace(/_/g, ' '), t[key]);
  return facts.slice(0, 60);
}

/**
 * A place reached (a rubric, a block, a theme of the article) is kept in place while the plant's data still arrives
 * above it — until the hand moves the sheet, another place is reached, or at the latest after this long (ms).
 */
export const KEEP_MAX_MS = 15000;

export const sheetStyles = [ui, severityStyles, css`
    :host {
      display: block;
      overflow-y: auto;
      /* No vertical padding: what is stuck (the rubrics) sticks to the very top, the action bar to the very bottom
         (the article keeps the space). */
      padding: 0 16px;
      /* A rubric's header, stuck while it is read (one line, whatever its text). */
      --rub-h: 30px;
    }
    article { padding: 16px 0 24px; }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 0 14px; }
    :host([embedded]) article { padding-top: 4px; }
    :host([embedded]) :is(h1, h2.h1) { margin-top: 4px; }
    /* The name, an h1, or an h2 under a screen's own title that looks the same (not as a block's title). */
    :is(h1, h2.h1) { margin: 8px 0 0; font-size: 1.6rem; line-height: 1.2; font-weight: 700; text-transform: none; letter-spacing: normal; color: var(--gf-text); }
    .sci { font-family: var(--gf-font-serif); font-size: 1.2rem; }
    .sci i { font-style: italic; }
    .author { color: var(--gf-text-muted); font-size: 0.9em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; padding: 0; list-style: none; }
    .tags li {
      background: var(--gf-accent-soft);
      border-radius: var(--gf-radius-pill);
      padding: 2px 10px;
      font-size: 0.8rem;
    }
    section { margin-top: 24px; }
    /* Blocks below the header: a title (drag it to move the block) with its grip and trash / revive icon, then the content. */
    .blocks { display: flex; flex-direction: column; }
    .block { margin-top: 20px; border-radius: var(--gf-radius); transition: box-shadow 0.15s, background 0.15s, opacity 0.15s; }
    .block-title { display: flex; align-items: center; gap: 2px; margin: 0 0 8px; }
    /* Personalised: the title is a handle for the mouse; a finger drags by the grip ⠿ only (on the title it scrolls the
       sheet, #press). Its tools wrap under the name when the row is short. */
    .king .block-title { position: relative; flex-wrap: wrap; row-gap: 2px; margin-left: -6px; cursor: grab; user-select: none; -webkit-user-select: none; }
    .king .grip { touch-action: none; }
    /* Its rows are as narrow as the list (a sheet squeezed by its panes, a pane's column), not as the whole sheet. */
    .blocks.king, .edge.king .edge-body { container-type: inline-size; }
    /* « Déplacer vers… » hangs from the end of the title row: a picker wrapped to its start would push the menu out. */
    .king .block-title .place-pick { position: static; }
    .block-title .name { flex: 1; min-width: 0; }
    .king .block-title .name { min-width: min(11em, calc(100% - 52px)); }
    /* King: the block's category (what the data says about the plant). */
    .block-title .cat { flex: none; padding: 0 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); font-size: 0.66rem; font-weight: 600; text-transform: none; letter-spacing: 0; margin-right: 2px; }
    @container (max-width: 420px) { .block-title .cat { display: none; } }
    .off-note { flex: none; font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .grip, .block-title .tool {
      flex: none;
      width: 26px;
      height: 26px;
      min-height: 0;
      padding: 0;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: var(--gf-radius-sm);
      background: none;
      color: var(--gf-text-muted);
      font-size: 0.95rem;
      opacity: 0.6;
    }
    .grip { cursor: grab; }
    .block-title .tool { cursor: pointer; }
    .grip:hover, .grip:focus-visible, .block-title .tool:hover, .block-title .tool:focus-visible { opacity: 1; background: var(--gf-surface-2); color: var(--gf-text); }
    .grip:focus-visible, .block-title .tool:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* A safety block's padlock (no trash): touched, it says why, under the title. */
    .block-title .tool.lock { cursor: help; font-size: 0.85rem; }
    .lock-tip { margin: -4px 0 8px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .lock-tip:empty { display: none; }
    /* The action bar: docked at the bottom of the sheet (above the tab bar on a phone), equal buttons. */
    .action-bar {
      position: sticky;
      bottom: 0;
      z-index: 6;
      margin: 0 -16px;
      padding: 6px 8px;
      background: var(--gf-surface);
      border-top: 1px solid var(--gf-border);
      box-shadow: 0 -4px 14px rgb(0 0 0 / 0.06);
    }
    :host([embedded]) .action-bar { margin: 0 -14px; }
    .action-bar .acts { display: flex; gap: 4px; max-width: 920px; margin: 0 auto; }
    .action-bar .act { position: relative; flex: 1; min-width: 0; display: flex; }
    .action-bar .act > button, .action-bar .act > a.button {
      flex: 1;
      min-width: 0;
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 4px;
      min-height: 0;
      border: 0;
      border-radius: var(--gf-radius);
      background: none;
      color: var(--gf-text);
      font-size: 0.72rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: none;
    }
    .action-bar .act svg { font-size: 1.2rem; }
    .action-bar .act span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .action-bar .act > button:hover, .action-bar .act > a.button:hover { background: var(--gf-surface-2); }
    .action-bar .fav[aria-pressed='true'] { color: var(--gf-fav); }
    .action-bar .share-note { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); margin: 0; padding: 4px 10px; border-radius: var(--gf-radius-pill); background: var(--gf-text); color: var(--gf-surface); white-space: nowrap; }
    /* King: every action, each with its ☑ — the one target there, the action inert under it until « Terminé » (no two
       targets on top of each other: WCAG 2.5.8); an action hidden in this view is faded too. */
    .action-bar .act-toggle { position: absolute; top: 0; right: 2px; display: grid; place-items: center; width: 22px; height: 22px; cursor: pointer; }
    .action-bar .act-toggle input { margin: 0; width: 16px; height: 16px; }
    .action-bar .act.off > button, .action-bar .act.off > a.button { opacity: 0.4; text-decoration: line-through; pointer-events: none; }
    /* « Personnaliser la fiche »: the crown, last, an icon at a finger's size; gold while open. */
    .action-bar .act.crown { flex: none; width: 44px; }
    .action-bar .act.crown > button { min-height: 44px; place-content: center; color: var(--gf-text-muted); }
    .action-bar .act.crown > button[aria-pressed='true'] { color: var(--gf-crown); background: color-mix(in srgb, #f5c518 18%, var(--gf-surface)); }
    /* « Mise en page de la fiche »: the mode arranged and its tools, stuck at the top (above the panes when there are). */
    .king-bar { position: sticky; top: 0; z-index: 8; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 -16px; padding: 6px 16px;
      border-bottom: 2px solid #d4a017; background: color-mix(in srgb, #f5c518 10%, var(--gf-surface)); font-size: 0.85rem; }
    :host([embedded]) .king-bar { margin: 0 -14px; padding: 6px 14px; }
    :host([edged]) .king-bar { position: static; flex: none; margin: 0; }
    /* Stuck over a sheet without panes: a block reached, or read, is the one right below it (#offset), never beneath it. */
    :host(:not([edged])) .blocks.king > .block { scroll-margin-top: var(--kb-h, 0px); }
    .king-bar .kb-mode { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .king-bar .kb-mode > svg:first-child { color: #b8860b; font-size: 1.1rem; }
    .king-bar .kb-tools { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    /* « Barre d’actions »: its list on a line of its own, scrolling when tall (the sheet stays in view). */
    .king-actions { flex: 1 1 100%; max-height: min(45vh, 360px); overflow-y: auto; overscroll-behavior: contain; padding: 6px 8px; border: 1px dashed var(--gf-border);
      border-radius: var(--gf-radius); background: var(--gf-surface); }
    .king-actions p { margin: 0 0 6px; color: var(--gf-text-muted); font-size: 0.8rem; }
    /* The name and the actions read without a title (King titles them, to move them like the others). */
    .block.headless { margin-top: 8px; }
    .block.headless:first-child { margin-top: 0; }
    .block[data-key='name'] :is(h1, h2.h1) { margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    /* Other names: a quiet list, in italics. */
    .names-list, .names { margin: 0; font-style: italic; font-size: 0.88rem; color: var(--gf-text-muted); line-height: 1.5; }
    .names-list .sep, .names .sep { font-style: normal; opacity: 0.5; padding: 0 0.3em; }
    .block-title input.rename { flex: 1; min-width: 0; font: inherit; text-transform: none; letter-spacing: 0; padding: 2px 6px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .block-title .tool[aria-expanded='true'], .block-title .tool[aria-pressed='true'] { opacity: 1; color: var(--gf-accent); }
    /* King: a title hidden when read is drawn struck and slanted (not faded: its contrast kept). */
    .block.untitled > .block-title .name { font-style: italic; text-decoration: line-through; }
    .block-title .styles { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; margin-right: 4px; }
    .block-title .styles button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .block-title .styles button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .block-title .styles button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .map-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 0 0 10px; padding: 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font-size: 0.85rem; }
    .map-form fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; align-content: start; }
    .map-form legend { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); padding: 0; margin-bottom: 2px; }
    .map-form label { display: grid; gap: 2px; }
    .map-form label.check { display: flex; gap: 6px; align-items: center; }
    .map-form .look-note { grid-column: 1 / -1; margin: 0; color: var(--gf-text-muted); }
    .map-placeholder { border-radius: var(--gf-radius); background: var(--gf-surface-2); }
    .subs-editor { margin: 0 0 10px 20px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
    .note-text { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); resize: vertical; }
    .note-text:focus-visible { outline: none; border-color: var(--gf-accent); box-shadow: var(--gf-focus); }
    .new-note { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    .new-note input { flex: 1; min-width: 160px; }
    /* Folded away: the title only, faded; ↺ brings it back. */
    .block.off { opacity: 0.45; }
    .block.off .block-title { margin-bottom: 0; }
    .block.off:hover, .block.off:focus-within { opacity: 0.8; }
    /* While dragging: every block shows its title only; the dragged one floats under the pointer. */
    .blocks.sorting .content { display: none; }
    .blocks.sorting .block { margin-top: 6px; padding: 4px 8px; background: var(--gf-surface); border: 1px dashed var(--gf-border); }
    .blocks.sorting .block-title { margin: 0; }
    .block.dragging { position: relative; z-index: 2; opacity: 1; background: var(--gf-surface); box-shadow: var(--gf-shadow-float); outline: 2px solid var(--gf-accent); border-style: solid; transition: none; }
    .block.dragging .block-title, .block.dragging .grip { cursor: grabbing; }
    .block.dragging .grip { opacity: 1; color: var(--gf-accent); }
    /* A part with nothing for this plant hides itself; the block then says so. */
    .content .if-empty { display: none; }
    /* Left out when empty: a block whose component found nothing for this plant. */
    .block.hide-empty:has(> .content > [hidden]:not([loading])) { display: none; }
    .content > [hidden]:not([loading]) ~ .if-empty { display: block; }
    @media (prefers-reduced-motion: reduce) { .block { transition: none; } }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      font-weight: 600;
      margin: 0 0 8px;
    }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--gf-gap);
    }
    figure {
      margin: 0;
      background: var(--gf-surface);
      border-radius: var(--gf-radius);
      overflow: hidden;
      box-shadow: var(--gf-shadow);
    }
    figure img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      background: var(--gf-surface-2);
    }
    figcaption { padding: 6px 8px; }
    p { margin: 0 0 12px; }
    .actions { margin: 12px 0 4px; }
    .actions .fav { min-height: var(--gf-control-h); padding: 8px 16px; font-size: 0.9rem; }
    .actions .fav[aria-pressed='true'] { color: var(--gf-fav); border-color: var(--gf-fav); background: color-mix(in srgb, var(--gf-fav) 10%, var(--gf-surface)); }
    .share-note { color: var(--gf-text-muted); font-size: 0.85rem; margin: 4px 0 0; }
    .description { background: var(--gf-surface); border-radius: var(--gf-radius); padding: 12px 14px; margin-bottom: 8px; }
    .description small { display: block; color: var(--gf-text-muted); margin-bottom: 4px; }
    ul.inline { padding: 0; margin: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .links a {
      display: inline-block;
      color: var(--gf-accent);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius-pill);
      padding: 4px 12px;
      text-decoration: none;
      background: var(--gf-surface);
    }
    .links a:hover { background: var(--gf-surface-2); }
    .skeleton {
      height: 180px;
      border-radius: var(--gf-radius);
      background: linear-gradient(90deg, var(--gf-surface-2), var(--gf-surface), var(--gf-surface-2));
      background-size: 200% 100%;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { from { background-position: 100% 0; } to { background-position: -100% 0; } }

    /* Épuré: big photo, the essentials, one-tap add to the current collection. */
    .epure { max-width: 560px; }
    .hero { margin: 4px 0 12px; border-radius: var(--gf-radius-lg); overflow: hidden; background: var(--gf-surface-2); box-shadow: var(--gf-shadow); }
    .hero img, .hero .skeleton, .hero .no-photo { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; height: auto; border-radius: 0; }
    .hero .no-photo { display: grid; place-items: center; font-size: 3rem; }
    .hero figcaption { padding: 4px 10px; }
    .hero a, .gallery a { cursor: zoom-in; }
    .all-media { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; }
    dialog.pane { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; background: var(--gf-surface); }
    dialog.pane:not([open]) { display: none; }
    dialog.pane gf-sheet-block { flex: 1; min-height: 0; }
    .pane-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--gf-border); }
    .pane-bar h2 { flex: 1; margin: 0; font-size: 1rem; }
    /* ⤢: a block in the pane beside the sheet. */
    .block { position: relative; }
    .to-pane { width: 30px; height: 30px; min-height: 0; font-size: 0.85rem; flex: none; opacity: 0; transition: opacity 0.15s; color: var(--gf-text-muted); }
    .block > .to-pane { position: absolute; top: 0; right: 0; z-index: 2; }
    .block:hover .to-pane, .to-pane:focus-visible { opacity: 1; }
    @media (hover: none) { .block-title .to-pane { opacity: 0.6; } }
    .in-pane { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
    .paned { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 10px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .paned button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--gf-border); background: var(--gf-surface); border-radius: var(--gf-radius-pill); padding: 3px 10px; font: inherit; color: var(--gf-text); cursor: pointer; }
    .paned button:hover { border-color: var(--gf-accent); }
    .epure :is(h1, h2.h1) { font-size: 1.8rem; }
    .meta { color: var(--gf-text-muted); margin: 6px 0 10px; }
    .more { margin-top: 18px; }

    /* Standard: collections as one discreet line. */
    .mine { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--gf-text-muted); margin: 4px 0; }

    /* Scientifique: facts as label / value rows, tables, sources. */
    h3 { font-size: 0.85rem; margin: 14px 0 6px; }
    .facts { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 6px 14px; margin: 0; font-size: 0.9rem; }
    .facts dt { color: var(--gf-text-muted); }
    .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .facts .lang { font-style: normal; font-size: 0.75rem; font-weight: 700; color: var(--gf-text-muted); text-transform: uppercase; }
    .statuses { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 10px; }
    .statuses th, .statuses td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: top; }
    .statuses th { color: var(--gf-text-muted); font-weight: 600; }
    .science p.muted { font-size: 0.9rem; }
    .credit { font-size: 0.75rem; color: var(--gf-text-muted); margin: 8px 0 0; }
    /* GBIF charts: one bar per month or year (no library). */
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 84px; margin: 4px 0 0; }
    .bars .bar { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
    .bars .bar i { display: block; width: 100%; min-height: 1px; background: var(--gf-accent); border-radius: 3px 3px 0 0; opacity: 0.85; }
    .bars.months { height: 100px; }
    .bars.months .bar b { font-size: 0.65rem; font-weight: 600; color: var(--gf-text-muted); line-height: 1.4; }
    .bars.years { gap: 1px; height: 64px; }
    .axis { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--gf-text-muted); }
    .small { font-size: 0.8rem; }
    .counts { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.9rem; }
    .counts li { display: grid; grid-template-columns: 1fr auto 3.6em; gap: 10px; align-items: baseline; }
    .counts li > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts b { font-variant-numeric: tabular-nums; font-weight: 600; }
    .counts small { color: var(--gf-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
    .near { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 0.88rem; }
    .near li { display: grid; grid-template-columns: 4.5em 1fr auto; gap: 10px; align-items: baseline; }
    .near li span { color: var(--gf-text-muted); min-width: 0; overflow-wrap: anywhere; }
    .papers { margin: 0; padding-left: 18px; display: grid; gap: 8px; font-size: 0.9rem; }
    .papers small { display: block; color: var(--gf-text-muted); }
    /* Herbarium sheets are tall: shown whole, not cropped. */
    .gallery.herbarium img { aspect-ratio: 3 / 4; object-fit: contain; background: #f4f1ea; }
    .specimen { display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; }
    .credit a { color: inherit; }
    .credit.error { color: var(--gf-danger); }
    .wiki p.credit { margin-top: 6px; }
    /* The Wikipédia summary reads like the other blocks: flush left, no card (its source line names it). */
    .description.wiki { background: none; padding: 0; border-radius: 0; }
    .description.wiki p { margin: 0 0 8px; }
    .wiki-desc { font-style: italic; color: var(--gf-text-muted); }
    /* The article's menu: in the block's header, stuck at the top of the sheet while reading it. */
    .wiki-menu { display: flex; gap: 4px; align-items: center; overflow-x: auto; scrollbar-width: none; margin: 0 -4px 10px; padding: 6px 4px;
      background: color-mix(in srgb, var(--gf-surface) 94%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--gf-border);
      mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent); }
    .wiki-menu::-webkit-scrollbar { display: none; }
    .wiki-logo { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--gf-border); font-size: 0.85rem; color: var(--gf-text-muted); }
    .wiki-menu a { flex: none; padding: 4px 10px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; color: var(--gf-text-muted); text-decoration: none; white-space: nowrap; }
    .wiki-menu a:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .wiki-menu a:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .wiki-theme { border-top: 1px solid var(--gf-border); }
    .wiki-theme > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; padding: 10px 0; cursor: pointer; font-weight: 600; list-style: none; }
    .wiki-theme > summary::-webkit-details-marker { display: none; }
    .wiki-theme > summary::before { content: '›'; display: inline-block; transition: transform 0.15s; color: var(--gf-text-muted); }
    .wiki-theme[open] > summary::before { transform: rotate(90deg); }
    .wiki-theme > summary small { font-weight: 400; color: var(--gf-text-muted); font-size: 0.75rem; }
    .wiki-theme > summary .also { margin-left: auto; font-size: 0.75rem; font-weight: 400; }
    .wiki-theme[data-flash] { animation: flash 1.2s ease-out; }
    .wiki-in { padding: 0 0 10px 14px; }
    /* Wikipédia's words, under a block's own data. */
    .wiki-bits { margin-top: 12px; padding: 10px 12px; border-left: 3px solid color-mix(in srgb, var(--gf-accent) 40%, transparent); background: color-mix(in srgb, var(--gf-surface) 70%, transparent); border-radius: 0 var(--gf-radius-sm) var(--gf-radius-sm) 0; }
    .wiki-x h3 { margin: 0 0 4px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); }
    .wiki-x p { margin: 0 0 6px; font-size: 0.92rem; line-height: 1.5; }
    .wiki-x + .wiki-x { margin-top: 10px; }
    ${unsafeCSS(chartStyles)}
    .prudence { border: 1px solid #d97706; background: color-mix(in srgb, #f59e0b 12%, var(--gf-surface)); border-radius: var(--gf-radius); padding: 8px 12px; margin-bottom: 10px; }
    .prudence.grave { border-color: #b91c1c; background: color-mix(in srgb, #ef4444 10%, var(--gf-surface)); }
    .prudence .verdict { margin: 0 0 6px; }
    .prudence ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .prudence li { display: flex; gap: 8px; align-items: baseline; font-size: 0.9rem; line-height: 1.35; }
    .prudence li svg { flex: none; color: #d97706; }
    /* data-level, not a class: .danger is the shared stylesheet's destructive look (styles/ui.js). */
    .prudence li[data-level='danger'] svg { color: #b91c1c; }
    .prudence li[data-level='deadly'] svg { color: var(--gf-deadly); }
    .prudence li[data-level='info'] svg { color: var(--gf-text-muted); }
    .prudence p { margin: 8px 0 0; }
    .prudence .sos a { color: inherit; }
    .prudence li button.link { min-height: 0; padding: 0 4px; font-size: inherit; }
    .no-tox { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid var(--gf-text-muted); color: var(--gf-text-muted); }
    .src { font-size: 0.72rem; color: var(--gf-text-muted); white-space: nowrap; }
    .src::before { content: '— '; }
    ul.recipes { margin: 4px 0 0; padding-left: 18px; font-size: 0.9rem; display: grid; gap: 3px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 5px 0 2px; vertical-align: 0; }
    .partner em, .partners em { font-family: var(--gf-font-serif); }
    .pollen .level { display: inline-block; padding: 1px 10px; border-radius: var(--gf-radius-pill); font-weight: 700; font-size: 0.85rem; background: var(--gf-surface-2); }
    .pollen .level.l1 { background: #e8f5e9; color: #2e7d32; } .pollen .level.l2 { background: #fff8e1; color: #b26a00; }
    .pollen .level.l3 { background: #ffe0b2; color: #c43e00; } .pollen .level.l4 { background: #ffcdd2; color: #b71c1c; }
    details.here-climate summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; margin: 6px 0; }
    /* Tabular data (style « Tableau », the default; « Liste » keeps the compact rows). */
    table.data { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 2px 0 6px; }
    table.data th, table.data td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: baseline; }
    table.data thead th { color: var(--gf-text-muted); font-weight: 600; font-size: 0.75rem; }
    table.data tbody th { color: var(--gf-text-muted); font-weight: 600; width: 40%; }
    table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.data.counts-table td:first-child { max-width: 0; width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    table.data .pct { width: 7.5em; }
    .meter { display: inline-block; width: 3em; height: 6px; margin-right: 6px; border-radius: 3px; background: var(--gf-surface-2); overflow: hidden; vertical-align: middle; }
    .meter i { display: block; height: 100%; background: var(--gf-accent); opacity: 0.8; }
    table.data td > button.focusable, table.data td .with-link > button.focusable { margin: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    table.data .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    table.data .ext { flex: none; text-decoration: none; }
    h4 { font-size: 0.78rem; margin: 10px 0 2px; color: var(--gf-text-muted); font-weight: 600; }
    ul.plain { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 0.9rem; }

    /* A value that shows on the sheet's maps when touched (the sheet has a map): dotted underline, highlighted while shown. */
    button.focusable {
      display: inline; min-height: 0; padding: 0 3px; margin: 0 -3px; border: 0; border-radius: 4px; background: none; box-shadow: none;
      color: inherit; font: inherit; font-weight: inherit; text-align: inherit; cursor: pointer;
      text-decoration: underline dotted color-mix(in srgb, var(--gf-accent) 70%, transparent); text-underline-offset: 3px;
    }
    button.focusable:hover { color: var(--gf-accent); }
    button.focusable[aria-pressed='true'] { background: color-mix(in srgb, #f59e0b 28%, transparent); text-decoration: none; }
    button.focusable:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .counts li > button.focusable { display: block; margin: 0; padding: 0 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    .counts .with-link > button.focusable { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .ext { flex: none; text-decoration: none; }
    .bars button.bar { padding: 0; margin: 0; border: 0; border-radius: 3px 3px 0 0; background: none; text-decoration: none; }
    .bars button.bar:hover i { opacity: 1; background: color-mix(in srgb, var(--gf-accent) 80%, #000); }
    .bars button.bar[aria-pressed='true'] { background: none; }
    .bars button.bar[aria-pressed='true'] i { background: #f59e0b; opacity: 1; }
    .bars button.bar[aria-pressed='true'] b { color: #b45309; }
    figcaption button.where { display: flex; gap: 4px; align-items: center; margin: 0 0 4px; font-size: 0.72rem; color: var(--gf-text-muted); text-align: left; }
    .focus-hint { font-size: 0.75rem; color: var(--gf-text-muted); margin: 6px 0 0; }

    /*
     * The plant pane's tree of panes (King: « Déplacer vers… », a drag): panes on the top, left, right or bottom
     * of the sheet, which scrolls between them. Bands S / M / L high (or dragged), columns S / M / L wide.
     */
    :host { container-type: inline-size; }
    :host([edged]) { overflow: hidden; display: flex; flex-direction: column; padding: 0; }
    .frame.edged { position: relative; flex: 1; min-height: 0; display: flex; }
    :host([edged]) > .frame.edged { height: 100%; }
    /* The tree: splits in rows and columns, each child its share (flex), a grip between two. */
    .split { flex: 1; min-width: 0; min-height: 0; display: flex; }
    .split.row { flex-direction: row; } .split.col { flex-direction: column; }
    .cell { display: flex; min-width: 0; min-height: 0; }
    /* The media's pane keeps the room its viewer needs (its image, zoom bar and thumbnails never overlap). */
    .split.col > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .split.row > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-width: 280px; }
    .cell > * { flex: 1; min-width: 0; min-height: 0; }
    .cell.folded { flex: 0 0 auto !important; }
    /* The grips between them: core/split-grip.js (gripStyles, at the end of the styles). */
    .frame.edged .main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 16px; }
    :host([embedded]) .frame.edged .main { padding: 0 14px; }
    /* Narrow: the panes as bands above and under the sheet, sharing the height left to it. */
    .frame.edged.narrow { flex-direction: column; }
    /* (Personalising, the bar « Mise en page de la fiche » above the frame takes its share first: --kb-h.) */
    .band-cell { flex: none; height: min(calc((var(--host-h, 80vh) - var(--kb-h, 0px)) * 0.45), calc((var(--host-h, 80vh) - var(--kb-h, 0px) - 220px) / var(--bands, 1)));
      border-bottom: 1px solid var(--gf-border); }
    .band-cell.folded { height: auto; }
    /* A narrow sheet: the media's band too keeps the room its viewer needs. */
    .band-cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .panes-only .band-cell.grow { flex: 1 0 300px; height: auto; }
    .frame.edged.narrow.panes-only { overflow-y: auto; }
    /* Panes only (Découvrir): the tree left without its sheet fills the whole frame — one pane alone too. */
    .frame.edged.panes-only:not(.narrow) > * { flex: 1 1 0; min-width: 0; }
    .edge { position: relative; z-index: 7; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-bg, var(--gf-surface-2)); }
    /* Over the whole plant pane for a while (the frame holds it: the cells are not positioned). */
    .edge.max { position: absolute; inset: 0; z-index: 30; box-shadow: var(--gf-shadow-float); }
    .edge-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 36px; padding: 2px 6px 2px 8px; color: var(--gf-text-muted); font-size: 0.75rem; }
    /* The media's controls in its header (type, part, count): what the viewer's own line held. */
    .media-ctl { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; overflow-x: auto; scrollbar-width: none; color: var(--gf-text); }
    .media-ctl:empty { display: none; }
    .media-ctl::-webkit-scrollbar { display: none; }
    .media-ctl select { font: inherit; font-size: 0.78rem; padding: 2px 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); max-width: 150px; min-height: 0; height: 28px; }
    .media-ctl .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.78rem; white-space: nowrap; }
    .media-ctl .parts { flex: none; display: flex; gap: 1px; padding: 2px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .media-ctl .parts button { width: 26px; height: 24px; min-height: 0; padding: 0; border: 0; border-radius: var(--gf-radius-pill); background: none; color: var(--gf-text-muted); display: grid; place-items: center; cursor: pointer; font-size: 0.8rem; }
    .media-ctl .parts button[aria-checked='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
    .media-ctl .parts button:disabled { opacity: 0.3; cursor: default; }
    .media-ctl .icon-btn { width: 28px; height: 28px; min-height: 0; }
    .media-ctl .back-mosaic { white-space: nowrap; font-size: 0.78rem; }
    .edge-bar:has(.media-ctl:not(:empty)) .edge-tabs .tab-name { display: none; }
    .edge-tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .edge-tabs::-webkit-scrollbar { display: none; }
    .edge-tabs button { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 2px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); font: inherit; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; cursor: pointer; }
    .edge-tabs button[aria-selected='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: var(--gf-shadow); }
    .edge-tabs:has(button:only-child) button { background: none; box-shadow: none; cursor: default; }
    .edge-sizes { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; }
    .edge-sizes button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.68rem; font-weight: 700; cursor: pointer; }
    .edge-sizes button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .edge-btn { flex: none; width: 30px; height: 30px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); cursor: pointer; list-style: none; }
    .edge-btn::-webkit-details-marker { display: none; }
    .edge-btn:hover { background: var(--gf-surface); color: var(--gf-text); }
    .edge-sizes button:focus-visible, .edge-btn:focus-visible, .edge-tabs button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .edge-opts { position: relative; flex: none; }
    .opts-pop { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; gap: 6px; min-width: 230px; padding: 10px 12px; background: var(--gf-surface);
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); color: var(--gf-text); font-size: 0.85rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .opts-pop label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .edge-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 12px 10px; overscroll-behavior: contain; }
    .edge.bare .edge-body { padding: 0; }
    .edge.bare .edge-body > .block { margin: 0; }
    /* The bar names the edge's blocks: no second title (King shows the block's tools). */
    .edge:not(.king) .edge-body > .block > h2.block-title, .edge:not(.king) .edge-body > .block > .to-pane { display: none; }
    .edge-body > .block { margin-top: 0; }
    .edge-body > .block.map-block, .edge-body > .block[data-key='media'] { flex: 1 0 200px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block.map-block > .content, .edge-body > .block[data-key='media'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body .map-placeholder.fill { flex: 1; height: auto !important; }
    .edge-body gf-media-viewer { flex: 1; min-height: 0; }
    .edge-body > .block[data-key='web'] { flex: 1 0 260px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block[data-key='web'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body:has(> .block[data-key='web']) { padding: 0; }
    gf-sheet-map[fill] { flex: 1; min-height: 0; }
    /* Folded: its bar only (a column: a strip of its blocks' icons). */
    .edge.col.folded { width: 44px; }
    .edge.col.folded .edge-bar { flex-direction: column; padding: 6px 4px; gap: 6px; }
    .edge.col.folded .edge-tabs { flex-direction: column; overflow: visible; }
    .edge.col.folded .tab-name { display: none; }
    .edge.col .edge-tabs .tab-name { overflow: hidden; text-overflow: ellipsis; }
    /* Personalising: a folded pane drawn open, its bar saying so. */
    .edge-bar .fold-note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; color: var(--gf-text-muted); }
    /* Without title or frame: the block fills the edge; its tabs and « agrandir » float over it. */
    .edge-float { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; gap: 4px; padding: 2px; border-radius: var(--gf-radius-sm); background: color-mix(in srgb, var(--gf-surface) 85%, transparent); box-shadow: var(--gf-shadow); }
    .edge-float .tab-name { display: none; }
    /* King: « Déplacer vers… » a block — the sheet, a new pane on a side, a tab of a pane. */
    .place-pick { position: relative; flex: none; }
    .place-pick > summary { list-style: none; display: inline-grid; place-items: center; cursor: pointer; }
    .place-pick > summary::-webkit-details-marker { display: none; }
    .move-menu { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; min-width: 230px; padding: 6px; background: var(--gf-surface); border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); text-transform: none; letter-spacing: 0; font-weight: 400; }
    .move-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer; }
    .move-menu button:hover:not(:disabled), .move-menu button:focus-visible { background: var(--gf-accent-soft); outline: none; }
    .move-menu button:disabled { opacity: 0.45; cursor: default; }
    .said { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    /* King: the blocks to add, as chips to drag. */
    .palette { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); }
    .palette .pal-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: inline-flex; gap: 4px; align-items: center; }
    .palette .chip { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 2px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); font: inherit; font-size: 0.8rem; cursor: grab; touch-action: none; }
    .palette .chip.new { border-style: dashed; color: var(--gf-accent); }
    :host([docking]) { user-select: none; -webkit-user-select: none; }
    :host([docking]) .block-title, :host([docking]) .edge-tabs button { cursor: grabbing; }
    /*
     * The rubrics, like the filters' facets: the blocks gathered by rubric, each rubric under its header, stuck
     * while the rubric is read. « full » (room enough): the wrapper has no box, so every header sticks along the
     * whole list — those passed stacked at the top, those to come waiting stacked at the bottom, above the action
     * bar. « push »: the rubric is a box, its header alone at the top, pushed away by the next one's. Under the
     * headers: the block read's title (level 1), then the article's theme read (level 2). Where the reading is, is
     * drawn by the browser alone: nothing is computed while scrolling.
     */
    .rubric { display: contents; --lvl1: calc((var(--stack, 0) + 1) * var(--rub-h)); }
    :host(:not([stack='full'])) .rubric { display: block; --lvl1: var(--rub-h); }
    .rub-mark { display: block; height: 0; scroll-margin-top: calc(var(--stack, 0) * var(--rub-h)); }
    :host(:not([stack='full'])) .rub-mark { scroll-margin-top: 0; }
    .rub-head { position: sticky; z-index: 5; top: 0; box-sizing: border-box; height: var(--rub-h); margin: 0 -6px; padding: 0 2px 0 6px;
      display: flex; align-items: center; gap: 2px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border);
      font-size: 0.82rem; font-weight: 600; letter-spacing: 0; text-transform: none; }
    :host([stack='full']) .rub-head { top: calc(var(--stack, 0) * var(--rub-h)); bottom: calc((var(--count, 1) - var(--stack, 0) - 1) * var(--rub-h) + var(--bar-h, 0px));
      box-shadow: 0 -1px 0 var(--gf-border); }
    .rubric:first-of-type > .rub-mark { margin-top: 14px; }
    .rub-go { flex: 1; min-width: 0; height: 100%; min-height: 0; display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 0; border: 0; border-radius: 0; background: none; color: var(--gf-text);
      font: inherit; text-align: left; cursor: pointer; }
    .rub-go:focus-visible, .rub-toc:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
    .rub-ic { flex: none; display: grid; place-items: center; width: 22px; color: var(--gf-accent); font-size: 0.95rem; }
    .rub-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rub-badge { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: var(--gf-radius-pill); display: inline-grid; place-items: center;
      font-size: 0.7rem; font-weight: 700; color: #fff; background: var(--gf-warn, #b45309); }
    .rub-badge.danger { background: var(--gf-danger, #dc2626); }
    .rub-badge.deadly { background: var(--gf-deadly); color: var(--gf-deadly-contrast); }
    .rub-badge.info { background: var(--gf-text-muted); }
    @media (prefers-color-scheme: dark) { .rub-badge { color: #1d1405; } }
    .rub-toc { flex: none; width: 28px; height: 28px; min-height: 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--gf-text-muted); cursor: pointer; }
    .rub-toc:hover, .rub-go:hover .rub-label { color: var(--gf-text); }
    .rub-head[data-flash] { animation: rub-flash 1.2s ease-out; }
    @keyframes rub-flash { from { background: var(--gf-accent-soft); } }
    .rub-note { margin: 8px 0 4px; font-size: 0.82rem; color: var(--gf-text-muted); }
    .rubric > .block { scroll-margin-top: var(--lvl1); }
    .rubric > .block > .block-title { position: sticky; top: var(--lvl1); z-index: 4; background: var(--gf-surface); margin: 0 -6px 8px; padding: 4px 6px; box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block > .wiki-theme, .rubric .wiki-theme { scroll-margin-top: var(--lvl1); }
    .rubric .wiki-theme[open] > summary { position: sticky; top: var(--lvl1); z-index: 3; background: var(--gf-surface); box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block:not(.headless) .wiki-theme { scroll-margin-top: calc(var(--lvl1) + var(--title-h, 38px)); }
    .rubric > .block:not(.headless) .wiki-theme[open] > summary { top: calc(var(--lvl1) + var(--title-h, 38px)); }
    /* Room after the last rubric: it too comes right under the rubrics stuck above it. */
    .blocks.rubrics { --room-stack: var(--rub-h); --room-gap: 160px; }
    :host([stack='full']) .blocks.rubrics { --room-stack: calc(var(--count, 1) * var(--rub-h)); --room-gap: 120px; }
    :host(:not([edged])) .blocks.rubrics::after, .frame.edged .main[data-drop-node='sheet'] .blocks.rubrics::after { content: ''; display: block; flex: none;
      height: max(0px, calc(var(--sheet-h, 100vh) - var(--room-stack) - var(--bar-h, 0px) - var(--room-gap))); }
    /* King: the plain list — any block can come under the top (room after the last one). */
    .frame.edged .main[data-drop-node='sheet']:has(.blocks.king)::after { content: ''; display: block; height: max(0px, calc(100% - 160px)); }
    /* The table of contents: over everything (the top layer), under the header touched. */
    .toc { position: fixed; inset: auto; margin: 0; width: min(300px, calc(100vw - 16px)); max-height: min(70vh, 560px); overflow-y: auto; padding: 8px; box-sizing: border-box;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
    .toc { display: none; }
    .toc[data-open] { display: block; }
    .toc:popover-open { display: block; }
    .toc:focus { outline: none; }
    .toc-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 6px; border-bottom: 1px solid var(--gf-border); margin-bottom: 4px;
      position: sticky; top: -8px; z-index: 1; background: var(--gf-surface); }
    .toc { overscroll-behavior: contain; }
    .blocks .block[tabindex='-1']:focus { outline: none; }
    .toc-head b { flex: 1; }
    .toc-head .entity { font-size: 0.7rem; font-weight: 600; padding: 1px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); }
    .toc-lock[aria-pressed='true'] { color: var(--gf-accent); }
    .toc ul { list-style: none; margin: 0; padding: 0; }
    .toc ul ul { padding-left: 30px; }
    .toc ul ul.subs { padding-left: 14px; }
    .toc button { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: 32px; padding: 4px 6px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.86rem; text-align: left; cursor: pointer; }
    .toc button:hover, .toc button:focus-visible { background: var(--gf-surface-2); outline: none; }
    .toc .toc-rub { font-weight: 600; }
    .toc .toc-rub .bi { color: var(--gf-accent); }
    .toc .toc-rub span:not(.rub-badge) { flex: 1; }
    .toc ul ul button { color: var(--gf-text-muted); font-size: 0.82rem; min-height: 28px; }
    .toc button[aria-current] { background: var(--gf-accent-soft); color: var(--gf-text); }
    .block[data-flash] { animation: flash 1.2s ease-out; }
    @keyframes flash { from { box-shadow: 0 0 0 3px var(--gf-accent); } to { box-shadow: 0 0 0 3px transparent; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } .block[data-flash], .rub-head[data-flash] { animation: none; } }
    /* Personalising a narrow list (a phone, a sheet squeezed by its panes, a pane): the grip and the name on the first
       line, the tools under; « Déplacer vers… » across the title row. */
    @container (max-width: 420px) {
      .king .block-title :is(.name, input.rename) { flex: 1 0 calc(100% - 52px); }
      .king .block-title .off-note { flex: 1 1 100%; }
      .king .block-title .move-menu { left: 0; right: 0; min-width: 0; }
    }
    /* A finger: every target of the personalised sheet at 44 px (last: over the sizes above). */
    @media (pointer: coarse) {
      .grip, .block-title .tool, .place-pick > summary { width: 44px; height: 44px; }
      .block-title .styles button { min-height: 44px; }
      .action-bar .act-toggle { width: 44px; height: 44px; top: 0; right: 0; }
      .king-bar button, .palette .chip, .move-menu button { min-height: 44px; }
    }
  `, gripStyles];

export class SheetBase extends LitElement {
  /** @type {import('lit').PropertyDeclarations} */
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Under a screen's own title (a mini-app, a layout's cell): its name a heading of level 2, never a second h1. */
    subheading: { type: Boolean },
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    _wiki: { state: true },
    /** Wikipédia: the sections read whole, the themes opened in its block. */
    _wikiOpen: { state: true },
    _science: { state: true },
    _gbif: { state: true },
    _near: { state: true },
    _spotsOpen: { state: true },
    _plant: { state: true },
    _details: { state: true },
    /** Its « Médias » (the block in the sheet, or on an edge) open at this image, by its place (a mini-app's address, &m=). */
    mediaAt: { attribute: false },
    /**
     * The search its maps about « Les résultats » read (core/search-channel.js), the block it opens over the page too:
     * in a screen, its cell's group's (cells.js); none: Flore's.
     */
    channel: { attribute: false },
    _error: { state: true },
    _noteSaved: { state: true },
    _noteFailed: { state: true },
    /** What the sheet's maps show beyond their settings: a filter, a point, a compared plant (map-focus.js). */
    _focus: { state: true },
    /** Open data crossed with the plant: GloBI interactions, climate niche; « here » (pollen and climate of my position). */
    _open: { state: true },
    _failed: { state: true },
    /** A block opened over the page (outside Flore, where there is no pane): its key and the image it starts at. */
    _paneDialog: { state: true }
  };

  constructor() {
    super();
    /** @type {number} */
    this.plantId = 0;
    /** The image its « Médias » open at (a mini-app's &m=). @type {number} */
    this.mediaAt = 0;
    /** @type {any} */
    this._plant = undefined;
    /** @type {any} */
    this._details = undefined;
    /** @type {string | null} */
    this._error = null;
    this.view = 'standard';
    /** @type {import('../core/search-channel.js').Channel | null} */
    this.channel = null;
    this.subheading = false;
    /** Note block whose text was just saved. @type {string | null} */
    this._noteSaved = null;
    /** Note block whose text could not be stored (storage full or unavailable). @type {string | null} */
    this._noteFailed = null;
    /** @type {any} */ this._wiki = undefined;
    /** @type {Set<string>} */
    this._wikiOpen = new Set();
    /** @type {any} */ this._science = undefined;
    /**
     * GBIF data of the plant, each part loaded when a block or sub-block shows it (undefined: not yet; null: none):
     * vernacularNames, descriptions, distributions, speciesProfiles, synonyms, iucn, stats, photos, herbarium,
     * literature; names of datasets and areas in `titles`.
     * @type {Record<string, any>}
     */
    this._gbif = {};
    /** « Près d’ici »: not asked, looking for the position, loading, the result, or what went wrong. @type {any} */
    this._near = undefined;
    this._spotsOpen = false;
    /** @type {import('../core/map-focus.js').SheetFocus} */
    this._focus = noFocus();
    /** What the opened blocks loaded (undefined: not yet; null: nothing). @type {{ interactions?: any, niche?: any, here?: any, safety?: any, confusions?: any, recipes?: any, wdUses?: any, herbarium?: any, photos?: any }} */
    this._open = {};
    /**
     * The loads that failed (a source unavailable, not a module switched off), by load key ('wiki', 'gbif:stats',
     * 'details:gbif'…): the blocks they feed say « Source indisponible — Réessayer », not « aucune donnée ».
     * @type {Record<string, any>}
     */
    this._failed = {};
    /** @type {{ key: string, url: string | null } | null} */
    this._paneDialog = null;
    // A value touched in a block: the maps show it (touched again, it goes).
    this.addEventListener(FOCUS_EVENT, e => {
      e.stopPropagation();
      this._focus = toggleFocus(this._focus, /** @type {CustomEvent} */ (e).detail);
    });
  }

  /** Data of the plant still on its way (the details, the article, GBIF, the open data): what is there may still grow. */
  get _loadingNow() { return (this._details === undefined || this.#pending.size > 0) && performance.now() - this.#loadStart < KEEP_MAX_MS; }
  /** When the plant's data were asked (a source that never answers stops counting after KEEP_MAX_MS). */
  #loadStart = 0;
  /** The plant's loads in flight (#loadExtras). @type {Set<Promise<any>>} */
  #pending = new Set();
  /** @type {AbortController | null} */
  #abort = null;
  /** Modules off and folded blocks at the last update, to reload what they change. @type {string | null} */
  #signature = null;
  /** @type {any} */
  #hidden = null;
  /** Extras already requested for the current plant. */
  #requested = new Set();
  /** The view at the last update. @type {string | null} */
  #viewSeen = null;

  _store = new StoreController(this);

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    const view = this._view;
    const viewChanged = view !== this.#viewSeen;
    this.#viewSeen = view;
    const signature = modulesSignature();
    const hidden = this._store.state.sheetLayout;
    const modulesChanged = this.#signature !== null && signature !== this.#signature;
    const hiddenChanged = hidden !== this.#hidden;
    this.#signature = signature;
    this.#hidden = hidden;
    if (changed.has('plantId')) { this._load(this.plantId); return; }
    // A module switched on or off (Réglages › Modules): its data comes or goes.
    if (modulesChanged) this.#refresh();
    // Blocks folded or shown, another view (the card underneath come on top in the mode arranged here too): what it
    // shows now (each load once per plant).
    else if (hiddenChanged || viewChanged) this._loadShown();
  }

  /** What the blocks shown now read, for the plant read (each load once per plant). */
  _loadShown() {
    if (this._plant && this._details !== undefined) this.#loadExtras(this._plant, this._details, this.#abort?.signal);
  }

  connectedCallback() {
    super.connectedCallback();
    notesEvents.addEventListener('change', this.#onNotes);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    notesEvents.removeEventListener('change', this.#onNotes);
    this.#abort?.abort();
  }

  /** The note texts read (at startup) or changed in another tab: shown. */
  #onNotes = () => this.requestUpdate();

  // ── Hooks: what a sheet laid out (gf-plant-detail.js) changes in its blocks; the defaults, a sheet's plain ───────────

  /** The mode shown. @returns {string} */
  get _view() { return this.view; }

  /** A block whose data is loaded. @param {string} key */
  _shows(key) { return !isHidden(this._view, key); }

  /** The pane holding a block. @param {string} key @returns {import('../core/pane-tree.js').StackNode | null} */
  _paneOf(key) { return paneOf(this._view, key); }

  /** Folded: by hand in the mode, or its service off. @param {string} k */
  _folded(k) { return isHidden(this._view, k); }

  /** Does the sheet show a map (in the flow or pinned)? Its data can then be touched to show on it. */
  get _hasMap() {
    return blockOrder(this._view).some(k => isMap(k) && !isHidden(this._view, k));
  }

  /** A map block fills its room (pinned, or alone in a pane). @param {string} key */
  _fills(key) { return Boolean(this._paneOf(key)); }

  /** « Lire dans l’article »: the Wikipédia block is in the sheet, to be read there. */
  get _reader() { return !this._folded('wikipedia') && !this._paneOf('wikipedia'); }

  /** Its maps drawn (not a placeholder). */
  get _drawsMaps() { return true; }

  /** Its « Médias » a showcase, photos first. */
  get _showcase() { return false; }

  /** ⤢ and a photo touched open a block at full size (_openPane). */
  get _canOpenPane() { return true; }

  /** Usages shown alone (gf-sheet-block): « Plantes à confondre » under its Prudence. */
  get _usesBox() { return false; }

  /**
   * A block at full size (⤢ on the block, a photo touched for « Médias »): asked to the host first (open-pane, cancelable)
   * — Flore shows it in a pane in place of the results (a phone: over the sheet), a screen flashes the cell that shows
   * it —, else (Mes plantes, an activity's sheet, a screen's whole plant cell where no cell shows that block) it opens
   * over the page, alone (gf-sheet-block). @param {string} key @param {string | null} [url] the image to open at
   */
  _openPane(key, url = null) {
    const plant = this._plant;
    if (!plant || !this._canOpenPane) return;
    const asked = new CustomEvent('open-pane', { detail: { plantId: plant.id, key, url }, bubbles: true, composed: true, cancelable: true });
    if (!this.dispatchEvent(asked)) return;
    this._paneDialog = { key, url };
    this.updateComplete.then(() => openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.pane'))));
  }

  /**
   * The block opened over the page (_openPane), alone: its bar (its name, the plant, Fermer), then the block. One at a time:
   * a photo touched in it turns it into « Médias » at that image. Échap or Fermer closes it (its history entry gone too).
   * @param {any} plant
   */
  _paneDialogView(plant) {
    const pane = this._paneDialog;
    if (!pane) return nothing;
    const close = (/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close();
    return html`<dialog class="pane" aria-label=${blockTitle(pane.key)} @close=${() => { this._paneDialog = null; }}>
        <div class="pane-bar"><h2>${blockTitle(pane.key)} — <i>${plant.scientificName}</i></h2>
          <button class="icon-btn" type="button" aria-label="Fermer" title="Fermer" @click=${close}>${icon('x-lg')}</button></div>
        <gf-sheet-block key=${pane.key} plant-id=${plant.id} view=${this._view} .startUrl=${pane.url} .channel=${this.channel}
          @open-pane=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); e.preventDefault(); this._paneDialog = { key: e.detail.key, url: e.detail.url ?? null }; }}
          @media-close=${close}></gf-sheet-block>
      </dialog>`;
  }

  /** To a theme of the article (« wiki:<theme> »): opened. @param {string} key */
  async goTo(key) {
    if (!key.startsWith('wiki:')) return;
    const t = key.slice(5);
    if (!this._wikiThemeOpen(t)) this._wikiOpen = new Set([...this._wikiOpen, 'theme:' + t]);
  }

  /** A plant to read: its data are reset next. */
  _willLoad() {}

  /** The plant read (its details still to come). @param {any} plant @param {AbortSignal} signal */
  _loaded(plant, signal) {}

  /** The safety files read again (« Réessayer »). @param {any} plant */
  _safetyRetried(plant) {}

  /** @param {number} id */
  async _load(id) {
    this._willLoad();
    this.#pending = new Set();
    this.#loadStart = performance.now();
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._plant = undefined;
    this._details = undefined;
    this._error = null;
    this._wiki = undefined;
    this._wikiOpen = new Set(sheetSession.wikiThemes);
    this._science = undefined;
    this._gbif = {};
    this._near = undefined;
    this._spotsOpen = sheetSession.spotsOpen;
    this._focus = noFocus();
    this._open = {};
    this._failed = {};
    this.#requested.clear();
    this.scrollTop = 0;

    let plant;
    try {
      await whenReady();
      if (abort.signal.aborted) return;
      plant = await db.get('plants', id);
    } catch (error) {
      console.error(error);
      if (!abort.signal.aborted) this._plant = { failed: /** @type {Error} */ (error).message };
      return;
    }
    if (abort.signal.aborted) return;
    this._plant = plant || null;
    if (!plant) return;
    this._loaded(plant, abort.signal);

    try {
      const details = await sources.details(plant, abort.signal);
      if (!abort.signal.aborted) { this._details = details; this.#noteDetails(details); }
      if (!abort.signal.aborted) this.#loadExtras(plant, details, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        if (isUnavailable(error)) this._failed = { ...this._failed, 'details:all': error };
        this._details = null;
        this.#loadExtras(plant, null, abort.signal);
        this._error = navigator.onLine
          ? 'Les sources distantes ne répondent pas pour le moment.'
          : 'Hors ligne : les données distantes ne sont pas disponibles.';
      }
    }
  }

  /** Modules changed: fetch the plant's data again, in place (the sheet keeps its scroll). */
  async #refresh() {
    const plant = this._plant;
    if (!plant?.id) return;
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this.#requested.clear();
    this.#loadStart = performance.now();
    this._wiki = undefined;
    this._science = undefined;
    this._gbif = {};
    this._near = undefined;
    this._failed = {};
    this._error = null;
    const details = await sources.details(plant, abort.signal).catch(error => {
      if (!abort.signal.aborted && isUnavailable(error)) this._failed = { ...this._failed, 'details:all': error };
      return null;
    });
    if (abort.signal.aborted) return;
    this._details = details;
    this.#noteDetails(details);
    this.#loadExtras(plant, details, abort.signal);
  }

  /**
   * The services the details could not reach (lib/plant-sources.mjs `unavailable`): their blocks say so, with « Réessayer ».
   * @param {any} details
   */
  #noteDetails(details) {
    const down = details?.unavailable || [];
    if (!down.length) return;
    this._failed = { ...this._failed, ...Object.fromEntries(down.map((/** @type {string} */ s) => ['details:' + s, { source: s }])) };
  }

  /**
   * « Réessayer » on a block: the failures remembered are forgotten (core/cache.js) and what failed is asked again —
   * the details and everything after them when they were incomplete, else only the loads that failed.
   */
  #retry() {
    const plant = this._plant;
    if (!plant?.id) return;
    forgetFailures();
    const keys = Object.keys(this._failed);
    this._failed = {};
    if (keys.some(k => k.startsWith('details:'))) { this.#refresh(); return; }
    /** @type {Record<string, any>} */
    const open = { ...this._open };
    const gbif = { ...this._gbif };
    for (const k of keys) {
      this.#requested.delete(k);
      if (k === 'wiki') this._wiki = undefined;
      else if (k === 'science') this._science = undefined;
      else if (k.startsWith('gbif:')) delete gbif[k.slice(5)];
      else if (OPEN_KEYS[k]) delete open[OPEN_KEYS[k]];
    }
    this._open = open;
    this._gbif = gbif;
    this.#loadExtras(plant, this._details, this.#abort?.signal);
  }

  /** The loads of a block that failed (see BLOCK_LOADS). @param {string} key @returns {any[]} */
  #down(key) {
    const loads = BLOCK_LOADS[key];
    if (!loads) return [];
    const failed = this._failed;
    return Object.keys(failed).filter(k => k === 'details:all' || loads.includes(k)).map(k => failed[k]);
  }

  /**
   * What the shown blocks need beyond the details, in every view: the Wikipedia summary, the Wikidata
   * classification, IUCN status and identifiers, the GBIF count in France. A folded block fetches nothing;
   * each loads once per plant.
   * @param {any} plant @param {any} details @param {AbortSignal} [signal]
   */
  #loadExtras(plant, details, signal) {
    const v = this._view;
    const shown = (/** @type {string} */ key) => this._shows(key);
    const qid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    // Each load in flight is counted: a place reached is kept while the data still arrives (#keep).
    const pending = this.#pending;
    // A load that fails: null for its value, and, when its source is unavailable (not a module switched off), noted
    // under its key so its blocks say so (#down).
    const settle = (/** @type {Promise<any>} */ task, /** @type {(v: any) => void} */ set, /** @type {string} */ key = '') => {
      const done = task.then(v => { if (!signal?.aborted && this._plant === plant) set(v ?? null); })
        .catch(error => {
          if (signal?.aborted || this._plant !== plant) return;
          if (key && isUnavailable(error)) this._failed = { ...this._failed, [key]: error };
          set(null);
        });
      pending.add(done);
      done.finally(() => { pending.delete(done); if (!pending.size && pending === this.#pending) this.requestUpdate(); });
    };
    const once = (/** @type {string} */ key) => !this.#requested.has(key) && Boolean(this.#requested.add(key));
    // Wikipédia feeds its block and, by theme, Descriptions, Calendrier, Habitat, Occurrences, Usages and Noms.
    if (['wikipedia', 'descriptions', 'calendar', 'gbifProfile', 'occurrences', 'uses', 'names'].some(shown) && once('wiki')) settle(sources.wikipedia(plant, qid, signal), x => { this._wiki = x; }, 'wiki');
    const science = shown('ids') || (baseOf(v) === 'scientific' && (shown('taxonomy') || shown('status')));
    if (science && once('science')) settle(sources.wikidataScience(plant, qid, signal), x => { this._science = x; }, 'science');
    this.#loadGbif(plant, details, signal, settle, once, shown);
    const putOpen = (/** @type {string} */ k, /** @type {any} */ x) => { this._open = { ...this._open, [k]: x }; };
    if (shown('interactions') && once('globi')) settle(openData.interactions(plant.scientificName, signal), x => putOpen('interactions', x), 'globi');
    const gbifKey = details?.identifiers?.gbif?.id ?? null;
    if (shown('climate') && !isSubHidden(v, 'climate', 'niche') && details !== undefined && once('niche')) {
      if (gbifKey) settle(openData.climateNiche(gbifKey, signal), x => putOpen('niche', x), 'niche'); else putOpen('niche', null);
    }
    // « Usages et cuisine sauvage »: the local safety file first, then Wikidata and Wikibooks.
    if (shown('uses')) {
      if (once('uses:safety')) {
        const [safety, confusions] = this.#safetyTasks(plant);
        settle(safety, x => putOpen('safety', x));
        settle(confusions, x => putOpen('confusions', x));
      }
      const usesQid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
      if (details !== undefined && once('uses:wikidata')) {
        if (usesQid && moduleOn('wikidata')) settle(usesData.wikidataUses(usesQid, signal), x => putOpen('wdUses', x), 'uses:wikidata'); else putOpen('wdUses', null);
      }
      if (!isSubHidden(v, 'uses', 'kitchen') && once('uses:recipes')) {
        if (moduleOn('wikibooks')) settle(usesData.recipes({ french: commonOf(plant), latin: plant.scientificName }, signal), x => putOpen('recipes', x), 'uses:recipes');
        else putOpen('recipes', null);
      }
    }
    // My position already known in this visit: its pollen and climate come with the sheet.
    if (shown('climate') && hereAllowed && once('here')) queueMicrotask(() => this.#findHere());
  }

  /**
   * The local safety data of « Usages » (Prudence): the safety file's entry (null: none) and the plant's confusions,
   * UNREAD when a file could not be read. @param {any} plant
   */
  #safetyTasks(plant) {
    return [usesData.safetyOf(plant).catch(() => UNREAD), lookalikesOf(plant).catch(() => UNREAD)];
  }

  /**
   * « Réessayer »: the safety and look-alikes files read again (a file that failed is asked again), with the
   * alerts. `lookalikes`: also the « Plantes à confondre » blocks (the retry did not come from one of them).
   */
  #retrySafety(lookalikes = true) {
    const plant = this._plant;
    if (!plant?.id) return;
    if (lookalikes) for (const el of this.renderRoot.querySelectorAll('gf-lookalikes')) /** @type {any} */ (el).reload();
    const put = (/** @type {string} */ k, /** @type {any} */ x) => { if (this._plant === plant) this._open = { ...this._open, [k]: x ?? null }; };
    const [safety, confusions] = this.#safetyTasks(plant);
    safety.then(x => put('safety', x));
    confusions.then(x => put('confusions', x));
    this._safetyRetried(plant);
  }

  /** Pollen and climate at my position (asked once; later sheets of the visit reuse it). */
  async #findHere() {
    const plant = this._plant;
    hereAllowed = true;
    this._open = { ...this._open, here: { state: 'locating' } };
    const known = lastFix();
    // A fix of the last half hour if known, else the GPS asked once: a fix of the last five minutes, or why there is
    // none (20 s at most).
    const fix = known && Date.now() - known.timestamp < 30 * 60000 ? known : await oneFix({ maxAge: 5 * 60000, timeout: 20000 });
    if (this._plant !== plant) return;
    if (!fix || 'error' in fix) { this._open = { ...this._open, here: { state: 'error', message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' } }; return; }
    const point = /** @type {[number, number]} */ (fix.coordinates);
    this._open = { ...this._open, here: { state: 'loading', point } };
    const [pollen, climate] = await Promise.all([
      openData.pollensAt(point).catch(() => null),
      openData.climateAt(point).catch(() => null)
    ]);
    if (this._plant === plant) this._open = { ...this._open, here: { state: 'done', point, pollen, climate } };
  }

  /**
   * GBIF, part by part: only what the shown blocks and sub-blocks use (the Backbone key comes with the details).
   * @param {any} plant @param {any} details @param {AbortSignal | undefined} signal
   * @param {(task: Promise<any>, set: (v: any) => void, key?: string) => void} settle @param {(key: string) => boolean} once
   * @param {(key: string) => boolean} shown
   */
  #loadGbif(plant, details, signal, settle, once, shown) {
    const v = this._view;
    if (details === undefined) return;
    const key = details?.identifiers?.gbif?.id ?? null;
    const sub = (/** @type {string} */ block, /** @type {string} */ k) => shown(block) && !isSubHidden(v, block, k);
    const put = (/** @type {string} */ name, /** @type {any} */ value) => { this._gbif = { ...this._gbif, [name]: value }; };
    const part = (/** @type {string} */ name, /** @type {() => Promise<any>} */ load) => {
      if (!once('gbif:' + name)) return;
      if (!key) { put(name, null); return; }
      settle(load(), x => put(name, x), 'gbif:' + name);
    };
    const species = (/** @type {string} */ name, /** @type {string} */ api = name) => part(name, () => sources.gbifSpecies(plant, key, api, signal));
    if (shown('names')) species('vernacularNames');
    if (shown('descriptions')) species('descriptions');
    if (sub('occurrences', 'distribution')) species('distributions');
    if (shown('gbifProfile')) species('speciesProfiles');
    if (baseOf(v) === 'scientific' && sub('taxonomy', 'gbifSynonyms')) species('synonyms');
    if (baseOf(v) === 'scientific' && sub('status', 'iucn')) species('iucn', 'iucnRedListCategory');
    if (['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => sub('occurrences', k))) {
      part('stats', () => sources.gbifStats(plant, key, signal).then(stats => { this.#loadTitles(stats, signal, k => sub('occurrences', k)); return stats; }));
    }
    if (!this._store.state.modules.photos) { if (once('gbif:noPhotos')) { put('photos', []); put('herbarium', []); } }
    else {
      if (sub('gbifMedia', 'photos')) part('photos', () => sources.gbifMedia(plant, key, 'photos', signal));
      if (sub('gbifMedia', 'herbarium')) part('herbarium', () => sources.gbifMedia(plant, key, 'herbarium', signal));
    }
    if (shown('literature')) part('literature', () => sources.gbifLiterature(plant, key, signal));
    // « Près d’ici » asked on an earlier sheet of this visit: look around again, without asking.
    if (nearAllowed && key && sub('occurrences', 'near') && once('gbif:near')) queueMicrotask(() => this.#findNear());
    // Arrived before the region and source names were shown: name them now.
    if (this._gbif.stats) this.#loadTitles(this._gbif.stats, signal, k => sub('occurrences', k));
  }

  /**
   * Names of the top sources and of the areas the plant is found in (each fetched once, then cached), for the parts of
   * Occurrences shown (`shown`: as #loadGbif reads them — a block alone shows them whatever the mode folds).
   * @param {any} stats @param {AbortSignal | undefined} signal @param {(k: string) => boolean} shown
   */
  #loadTitles(stats, signal, shown) {
    if (!stats) return;
    /** @type {[string, Promise<string | null>][]} */
    const wanted = [];
    const titles = this._gbif.titles || {};
    if (shown('datasets')) for (const d of stats.datasets) if (!(d.key in titles)) wanted.push([d.key, sources.gbifDatasetTitle(d.key, signal)]);
    if (shown('regions')) {
      for (const r of stats.regions) if (!(r.gid in titles)) wanted.push([r.gid, sources.gadmName(r.gid, signal)]);
      for (const d of stats.departments.slice(0, 5)) if (!(d.gid in titles)) wanted.push([d.gid, sources.gadmName(d.gid, signal)]);
    }
    if (!wanted.length) return;
    const plant = this._plant;
    // Placeholders first: asked once.
    this._gbif = { ...this._gbif, titles: { ...titles, ...Object.fromEntries(wanted.map(([k]) => [k, undefined])) } };
    Promise.all(wanted.map(([k, task]) => task.catch(() => null).then(name => [k, name]))).then(named => {
      if (signal?.aborted || this._plant !== plant) return;
      this._gbif = { ...this._gbif, titles: { ...this._gbif.titles, ...Object.fromEntries(named) } };
    });
  }

  /**
   * The parts of a block this view shows, in the order chosen for it (King › Sous-blocs). `parts`: sub-block
   * key → its markup, or nothing when this view or this plant has none.
   * @param {string} block @param {Record<string, () => unknown>} parts
   */
  #subs(block, parts) {
    return shownSubs(this._view, block).map(k => parts[k]?.() ?? nothing).filter(x => x !== nothing);
  }

  /** A photo touched: the « Médias » viewer at that image, in the pane. @param {Event} e @param {string | null} [url] */
  #openMedia(e, url = null) {
    e.preventDefault();
    this._openPane('media', url);
  }

  /** « Tous les médias »: the viewer from its first image. */
  #allMedia() {
    return html`<button class="link all-media" type="button" @click=${(/** @type {Event} */ e) => this.#openMedia(e)}>${icon('images')} Tous les médias</button>`;
  }

  /** Everything the views share, computed once per render. @param {any} plant */
  _context(plant) {
    const details = this._details;
    const inat = details?.identifiers?.inaturalist;
    return {
      plant,
      details,
      loading: details === undefined,
      name: nameOf(plant),
      // Photos en ligne switched off (Réglages › Modules): no remote image anywhere on the sheet.
      photosOff: !this._store.state.modules.photos,
      images: this._store.state.modules.photos ? gallery(plant, details) : [],
      inat,
      wikidata: plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id,
      links: sources.links(plant),
      status: plant.status?.france
    };
  }

  /** The sheet's title: its h1, or under a screen's own title (`subheading`) an h2 that looks the same. @param {string} text */
  _heading(text) { return this.subheading ? html`<h2 class="h1">${text}</h2>` : html`<h1>${text}</h1>`; }

  /** The « Nom » block: French and scientific names (Épuré: the family too; flowering is the Calendrier's). @param {any} ctx */
  #name({ plant, name }) {
    return html`
      ${this._heading(name)}
      <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
      ${baseOf(this._view) === 'epure' ? html`<p class="meta">${plant.family}</p>` : nothing}`;
  }

  /** @param {any} ctx */
  #tags({ plant, status, inat }) {
    return html`<ul class="tags">${this.#subs('taxonomy', {
      ranks: () => html`<li>${plant.family}</li><li>Genre <i>${plant.genus}</i></li>`,
      author: () => plant.author ? html`<li>${plant.author}</li>` : nothing,
      france: () => status ? html`<li title="Statut TAXREF ${status}">${STATUS_LABELS[status] || status}</li>` : nothing,
      synonyms: () => plant.synonyms?.length ? html`<li>${plant.synonyms.length} synonyme${plant.synonyms.length > 1 ? 's' : ''}</li>` : nothing,
      inat: () => inat?.observationsCount ? html`<li>${inat.observationsCount.toLocaleString('fr-FR')} observations iNaturalist</li>` : nothing
    })}</ul>`;
  }

  /** Photos of the plant (licensed), or why there are none. @param {any} ctx @param {number} [max] */
  #gallery({ plant, images, loading, photosOff }, max = Infinity) {
    const shown = images.slice(0, max);
    return photosOff ? html`<p class="muted">${photosOffLine()}</p>` : shown.length ? html`
      <div class="gallery">
        ${shown.map(image => html`
          <figure>
            <a href=${safeUrl(image.sourceUrl || image.pageUrl || image.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}>
              <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${dropFigure} @load=${showImg} />
            </a>
            <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
          </figure>`)}
      </div>${this.#allMedia()}` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`;
  }

  /** The block that shows a theme of the article beside its own data, when it is in the sheet. @param {string} theme */
  _wikiHost(theme) {
    const host = WIKI_THEMES[theme]?.[1];
    return host && !this._folded(host) && !this._paneOf(host) ? host : null;
  }

  /** The article's sections of these themes. @param {string[]} themes */
  #wikiSections(themes) { return (this._wiki?.sections || []).filter((/** @type {any} */ x) => themes.includes(x.theme)); }

  /**
   * The article's sections of these themes: their title, their beginning (« Lire la suite »: whole). Under a
   * block's own data (`under`), with the credit and a way to the article, at that theme.
   * @param {string[]} themes @param {boolean} [under]
   */
  #wikiBits(themes, under = true) {
    const list = this.#wikiSections(themes);
    if (!list.length) return nothing;
    const reader = this._reader;
    return html`<div class=${under ? 'wiki-bits' : 'wiki-in'}>${list.map((/** @type {any} */ x) => {
      const id = x.theme + ':' + x.title, whole = this._wikiOpen.has(id) || x.text.length <= WIKI_SHORT + 80;
      const text = whole ? x.text : x.text.slice(0, WIKI_SHORT).replace(/\s+\S*$/, '') + '…';
      return html`<section class="wiki-x"><h3>${x.title.split(' › ').pop()}</h3>${text.split('\n').map(p => html`<p>${p}</p>`)}
        ${whole ? nothing : html`<button class="link" type="button" @click=${() => { this._wikiOpen = new Set([...this._wikiOpen, id]); }}>Lire la suite</button>`}</section>`;
    })}${under ? html`<p class="credit">D’après <a href=${this._wiki.url} target="_blank" rel="noopener">Wikipédia</a> · CC BY-SA 4.0
      ${reader ? html` · <button class="link" type="button" @click=${() => this.goTo('wiki:' + themes[0])}>Lire dans l’article</button>` : nothing}</p>` : nothing}</div>`;
  }

  /** The themes of the article, in the menu's order. */
  get _wikiThemes() { return Object.keys(WIKI_THEMES).filter(t => this.#wikiSections([t]).length); }

  /** A theme of the article open: Description from the start, the others when asked. @param {string} t */
  _wikiThemeOpen(t) { return this._wikiOpen.has('theme:' + t) || (t === 'description' && !this._wikiOpen.has('closed:description')); }

  /**
   * The Wikipédia block, read like an article: at its top, the menu of its themes (a table of contents, not stuck:
   * the theme read is the one whose title stays stuck under the rubric); the description and the lead; each theme
   * folded under its anchor, Description open. A theme also shown in a block of the sheet (Usages, Habitat…) says so.
   */
  #wikipedia() {
    const wiki = this._wiki;
    if (!wiki) return nothing;
    if (!wiki.extract) {
      return wiki.english ? html`<p class="muted">Pas d’article Wikipédia en français. <a href=${wiki.english} target="_blank" rel="noopener">Lire l’article en anglais</a></p>` : nothing;
    }
    const themes = this._wikiThemes;
    const date = wiki.touched ? new Date(wiki.touched).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    return html`<div class="description wiki">
      ${themes.length ? html`<nav class="wiki-menu" aria-label="Sommaire de l’article Wikipédia">
        <span class="wiki-logo" aria-hidden="true">${icon('wikipedia')}</span>
        ${themes.map(t => html`<a href=${'#wiki-' + t} @click=${(/** @type {Event} */ e) => { e.preventDefault(); this.goTo('wiki:' + t); }}>${WIKI_THEMES[t][0]}</a>`)}
      </nav>` : nothing}
      ${wiki.description ? html`<p class="wiki-desc">${wiki.description}</p>` : nothing}
      ${wiki.extract.split('\n').map((/** @type {string} */ p) => html`<p>${p}</p>`)}
      ${themes.map(t => {
        const host = this._wikiHost(t), open = this._wikiThemeOpen(t);
        return html`<details class="wiki-theme" id=${'wiki-' + t} data-theme=${t} ?open=${open}
            @toggle=${(/** @type {Event} */ e) => {
              const now = /** @type {HTMLDetailsElement} */ (e.currentTarget).open;
              if (now === this._wikiThemeOpen(t)) return;
              const o = new Set(this._wikiOpen);
              if (now) { o.add('theme:' + t); o.delete('closed:' + t); } else { o.delete('theme:' + t); o.add('closed:' + t); }
              this._wikiOpen = o;
            }}>
          <summary>${WIKI_THEMES[t][0]} <small>${this.#wikiSections([t]).length} section${this.#wikiSections([t]).length > 1 ? 's' : ''}</small>
            ${host ? html`<button class="link also" type="button" title=${`Aussi dans « ${blockTitle(host)} », avec ses autres données`}
              @click=${(/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); this.goTo(host); }}>aussi dans « ${blockTitle(host)} » →</button>` : nothing}</summary>
          ${open ? this.#wikiBits([t], false) : nothing}
        </details>`;
      })}
      <p class="credit">Source : <a href=${wiki.url} target="_blank" rel="noopener">article Wikipédia</a> · texte sous licence CC BY-SA 4.0${date ? ' · modifié le ' + date : ''}</p>
    </div>`;
  }

  /** @param {any} ctx */
  #resources({ details, inat, wikidata, links }) {
    const link = (/** @type {string} */ url, /** @type {string} */ label) => url ? html`<li><a href=${url} target="_blank" rel="noopener">${label}</a></li>` : nothing;
    return html`<ul class="inline links">${this.#subs('resources', {
      inpn: () => link(links.inpn, 'INPN'),
      taxref: () => link(links.taxref, 'TAXREF'),
      gbif: () => link(details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : links.gbif, 'GBIF'),
      inaturalist: () => link(inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : links.inaturalist, 'iNaturalist'),
      wikidata: () => link(wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : links.wikidata, 'Wikidata'),
      commons: () => link(links.wikimedia, 'Wikimedia Commons'),
      wikipedia: () => link(this._wiki?.url || inat?.wikipediaUrl, 'Wikipédia')
    })}</ul>`;
  }

  /**
   * A « Carte » block: the map component, set up as configured (the card under a swiped one shows a
   * placeholder rather than a second map). @param {string} key @param {any} ctx
   */
  #map(key, { plant, details, inat }) {
    const config = mapConfig(key);
    // Pinned, or alone in a pane: the map fills the room.
    const fill = this._fills(key);
    if (!this._drawsMaps) return html`<div class="map-placeholder ${fill ? 'fill' : ''}" style=${`height:${{ s: 180, m: 260, l: 380 }[config.height]}px`}></div>`;
    // One WebGL map per sheet: the main « Carte » block may show in 3D, the map blocks added stay in 2D (gf-map-gl.js).
    return html`<gf-sheet-map .plant=${plant} .gbifKey=${details?.identifiers?.gbif?.id ?? null} .inatId=${inat?.id ?? null} .channel=${this.channel}
      map-3d=${key === 'map' ? 'auto' : 'off'} map-3d-why=${ONE_GL_PER_SHEET} .config=${config} ?fill=${fill} .mapFocus=${this._focus}
      @map-config=${(/** @type {CustomEvent} */ e) => setMapConfig(key, e.detail)}
      @focus-clear=${(/** @type {CustomEvent} */ e) => { this._focus = { ...this._focus, [e.detail.kind]: null }; }}></gf-sheet-map>`;
  }

  /** @type {number | undefined} */
  #noteTimer;

  /** A note block: free text for this plant, saved as it is typed. @param {string} key @param {any} plant */
  #note(key, plant) {
    return html`<textarea class="note-text" rows="3" aria-label=${blockTitle(key)} placeholder="Votre note sur cette plante"
      .value=${noteText(key, plant.id)}
      @input=${e => {
        const text = e.target.value;
        clearTimeout(this.#noteTimer);
        this.#noteTimer = setTimeout(async () => {
          // Said only once it is stored: a refusal (storage full) is said, never a false « Enregistré ».
          const stored = await setNoteText(key, plant.id, text);
          this._noteFailed = stored ? null : key;
          if (!stored) return;
          // A favourite of a game, given a note: the user's own now (« Recommencer » the game keeps it).
          if (text.trim()) promoteFavorites([plant.id]);
          this._noteSaved = key;
          setTimeout(() => { if (this._noteSaved === key) this._noteSaved = null; }, 1500);
        }, 400);
      }}></textarea>
      ${this._noteFailed === key
        ? html`<p class="credit error" role="alert">Non enregistré : stockage plein ou indisponible. Copiez votre texte, puis exportez vos plantes et libérez de l’espace.</p>`
        : html`<p class="credit" aria-live="polite">${this._noteSaved === key ? 'Enregistré sur cet appareil.' : 'Note personnelle, gardée sur cet appareil (et dans l’export de Mes plantes).'}</p>`}`;
  }

  /**
   * The plant's other French names (TAXREF, GBIF), without the one it is shown under and without repeats (case
   * and accents aside). Not iNaturalist's common name: it comes in English when there is no French one.
   * @param {any} ctx @returns {string[]}
   */
  /** Names separated by a light dot. @param {string[]} names */
  #nameList(names) {
    return names.map((n, i) => html`${i ? html`<span class="sep" aria-hidden="true">·</span>` : nothing}${n}`);
  }

  #otherFrench({ plant, name }) {
    return dedupNames([...(plant.vernacularNames || []), ...gbifFrenchNames(plant, this._gbif), ...(this._wiki?.aliases || [])], [name]);
  }

  /**
   * A block with nothing to show for this plant, left out outside King: Noms with no other name, Wikipédia
   * with no article (or not yet: it appears when the summary arrives).
   * @param {string} key @param {any} ctx
   */
  _emptyHere(key, ctx) {
    // A source unavailable: the block stays, to say so and offer « Réessayer ».
    return !this.#down(key).length && this.#nothingHere(key, ctx);
  }

  /** The block has no data for this plant (whatever the reason). @param {string} key @param {any} ctx */
  #nothingHere(key, ctx) {
    const v = this._view;
    const g = this._gbif;
    const loaded = (/** @type {any} */ x) => x !== undefined;
    if (isNote(key)) return !noteText(key, ctx.plant.id);
    switch (key) {
      case 'names': return this.#namesEmpty(ctx);
      // Wikipédia: shown when the summary arrives.
      case 'wikipedia': return !this._wiki || (!this._wiki.extract && !this._wiki.english);
      case 'photos': return ctx.photosOff || (!ctx.loading && !ctx.images.length);
      case 'media': return ctx.photosOff || (!ctx.loading && !ctx.images.length && loaded(this._gbif.photos) && !this._gbif.photos?.length);
      // Épuré and Standard: the component hides itself when empty (CSS, see .hide-empty).
      case 'status': return baseOf(v) === 'scientific' && !ctx.plant.statuses?.length && loaded(this._science) && !this._science?.iucn && loaded(g.iucn) && !g.iucn?.code;
      case 'mine': return !(getMembership().byPlant.get(ctx.plant.id) || []).length;
      case 'descriptions': return !this.#wikiSections(['description']).length && loaded(g.descriptions) && !descriptions(g).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || '')).length;
      case 'occurrences': return !ctx.loading && !ctx.details?.identifiers?.gbif?.id && !ctx.inat?.observationsCount;
      case 'gbifMedia': return ctx.photosOff || shownSubs(v, 'gbifMedia').every(k => loaded(g[k]) && !g[k]?.length);
      case 'gbifProfile': { const p = profile(g); return !this.#wikiSections(['ecology']).length && !p.habitats.length && !p.forms.length && !p.invasive.length; }
      case 'literature': return !g.literature?.items?.length;
      case 'interactions': return loaded(this._open.interactions) && !this._open.interactions?.roles?.length;
      // Prudence always says something once read (a warning, the data unavailable, or that none is known).
      case 'uses': { const o = this._open; return isSubHidden(v, 'uses', 'safety') && !this.#wikiSections(['toxicity', 'food', 'uses']).length && loaded(o.safety) && !o.safety && !o.confusions?.length && loaded(o.wdUses) && !o.wdUses?.uses?.length && !o.wdUses?.products?.length && !o.wdUses?.dishes?.length && !o.recipes?.length && !this.#danger(ctx.plant).items.length; }
      case 'climate': return !openData.pollenOf(ctx.plant) && loaded(this._open.niche) && !this._open.niche?.points?.length;
      case 'trefle': return !ctx.loading && !trefleFacts(ctx.details).length;
      default: return false;
    }
  }


  /** The Noms block has nothing to show here. @param {any} ctx */
  #namesEmpty(ctx) {
    if (this.#otherFrench(ctx).length || this.#wikiSections(['names']).length) return false;
    return blockStyle(this._view, 'names') === 'list' || baseOf(this._view) !== 'scientific' || !otherNames(this._gbif).length;
  }

  /**
   * A block's content, as this view shows it. A source it reads failed: « Source indisponible — Réessayer », alone
   * when the block has nothing else to show, else above what it has (its « nothing known » lines left out).
   * @param {string} key @param {any} ctx
   */
  _content(key, ctx) {
    const down = this.#down(key);
    if (!down.length) return this.#blockContent(key, ctx, false);
    const notice = sourceDown(down, () => this.#retry());
    return this.#nothingHere(key, ctx) ? notice : html`${notice}${this.#blockContent(key, ctx, true)}`;
  }

  /** @param {string} key @param {any} ctx @param {boolean} down a source of the block failed: no « nothing known » line */
  #blockContent(key, ctx, down) {
    const v = this._view;
    const { plant, details, loading } = ctx;
    const pending = html`<p class="muted">chargement…</p>`;
    const empty = (/** @type {string} */ text) => down ? nothing : html`<p class="muted">${text}</p>`;
    // After a part that hides itself when it has nothing for this plant.
    const ifEmpty = (/** @type {string} */ text) => down ? nothing : html`<p class="muted if-empty">${text}</p>`;
    if (isNote(key)) return this.#note(key, plant);
    if (isMap(key)) return this.#map(key, ctx);
    switch (key) {
      case 'name': return this.#name(ctx);
      case 'web': return html`<gf-web-pane ?inactive=${!this._paneOf('web')}></gf-web-pane>`;
      case 'media': {
        if (ctx.photosOff) return html`<p class="muted">${photosOffLine()}</p>`;
        // In the sheet: compact; in a pane (the mode's, or the host's own): the full viewer, filling it (its keys only
        // when it has the focus).
        const edged = Boolean(this._paneOf('media'));
        return html`<gf-media-viewer ?prefer-photos=${this._showcase} ?showcase=${this._showcase} ?bar-out=${edged} ?compact=${!edged} ?local=${edged} plant-id=${plant.id} .index=${this.mediaAt ?? 0}
            presentation=${blockStyle(this._view, 'media')} .label=${isTitleShown(this._view, 'media') ? null : blockTitle('media')}
            @open-pane=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); this._openPane('media', e.detail.url); }}></gf-media-viewer>`;
      }
      case 'photos': {
        if (baseOf(v) !== 'epure') return this.#gallery(ctx, baseOf(v) === 'standard' ? 6 : Infinity);
        const hero = ctx.images[0];
        return html`<figure class="hero">
          ${hero ? html`<a href=${safeUrl(hero.sourceUrl || hero.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, hero.url)}><img src=${hero.url} alt=${plant.scientificName} decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} /></a>
            <figcaption><gf-attribution .media=${hero}></gf-attribution></figcaption>`
            : html`<div class=${loading ? 'skeleton' : 'no-photo'} aria-hidden="true">${loading ? '' : icon('flower1')}</div>`}
        </figure>`;
      }
      case 'status':
        return baseOf(v) === 'scientific' ? this.#statuses(ctx)
          : html`<gf-status .plant=${plant}></gf-status>${ifEmpty('Aucune protection, réglementation ni liste rouge connue (INPN).')}`;
      case 'lookalikes':
        return html`<gf-lookalikes .plant=${plant} ?compact=${baseOf(v) === 'epure'} ?detailed=${baseOf(v) === 'scientific'} ?map-linked=${this._hasMap} .mapFocus=${this._focus}
            @safety-retry=${() => this.#retrySafety(false)}></gf-lookalikes>
          ${ifEmpty(NO_CONFUSION)}`;
      case 'taxonomy': return baseOf(v) === 'scientific' ? this.#taxonomy(ctx) : this.#tags(ctx);
      case 'mine': {
        if (baseOf(v) === 'scientific') return html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this._hasMap} .mapFocus=${this._focus}></gf-plant-spots>`;
        const count = (getMembership().byPlant.get(plant.id) || []).length;
        return html`
          <div class="mine">
            <span>${count ? `Dans ${count} de mes listes et lieux` : 'Dans aucune liste ni aucun lieu'}</span>
            <button class="link" type="button" aria-expanded=${this._spotsOpen ? 'true' : 'false'}
              @click=${() => { this._spotsOpen = !this._spotsOpen; }}>${this._spotsOpen ? 'Masquer' : count ? 'Voir' : 'Lieux'}</button>
          </div>
          ${this._spotsOpen ? html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this._hasMap} .mapFocus=${this._focus}></gf-plant-spots>` : nothing}`;
      }
      case 'calendar':
        return html`<gf-calendar .plant=${plant} notitle></gf-calendar>${this.#wikiSections(['biology']).length ? this.#wikiBits(['biology']) : ifEmpty('Aucune période de floraison ni d’observation connue.')}`;
      case 'wikipedia':
        return this._wiki ? this.#wikipedia() : this._wiki === undefined ? pending : empty('Pas d’article Wikipédia en français trouvé.');
      case 'descriptions': {
        const texts = descriptions(this._gbif).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || ''));
        if (this.#wikiSections(['description']).length) return html`${this.#wikiBits(['description'])}${texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)}`;
        return texts.length
          ? texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)
          : this._gbif.descriptions === undefined ? pending : empty(baseOf(v) === 'scientific' ? 'Aucune description sur GBIF.' : 'Aucune description en français sur GBIF.');
      }
      case 'names': {
        const names = this.#otherFrench(ctx);
        const foreign = baseOf(v) === 'scientific' ? otherNames(this._gbif) : [];
        const wikiNames = this.#wikiBits(['names']);
        if (!names.length && !foreign.length) return wikiNames !== nothing ? wikiNames : this._gbif.vernacularNames === undefined ? pending : empty('Aucun autre nom français connu.');
        // « Liste » (Épuré's default): just the French names.
        if (blockStyle(v, 'names') === 'list') return html`${shownSubs(v, 'names').includes('french') && names.length ? html`<p class="names-list">${this.#nameList(names)}</p>` : nothing}${wikiNames}`;
        return html`<dl class="facts">${this.#subs('names', {
          french: () => names.length ? html`<dt>Autres noms français</dt><dd class="names">${this.#nameList(names)}</dd>` : nothing,
          foreign: () => foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd class="names">${foreign.map(([lang, list]) => html`<span class="lang">${lang || '?'}</span> ${this.#nameList(/** @type {string[]} */ (list))} `)}</dd>` : nothing
        })}</dl>
        <p class="credit">Sources : TAXREF v18 · GBIF${this._wiki?.aliases?.length ? ' · Wikidata' : ''}.</p>${wikiNames}`;
      }
      case 'occurrences': return html`${this.#occurrences(ctx)}${this.#wikiBits(['distribution'])}`;
      case 'gbifMedia': return this.#gbifMedia(ctx);
      case 'gbifProfile': {
        const w = this.#wikiBits(['ecology']);
        if (w === nothing) return this.#gbifProfile();
        const p = profile(this._gbif);
        return html`${p.habitats.length || p.forms.length || p.invasive.length ? this.#gbifProfile() : nothing}${w}`;
      }
      case 'literature': return this.#literature(ctx);
      case 'interactions': return this.#interactions(ctx);
      case 'climate': return this.#climate(ctx);
      case 'uses': return html`${this.#uses(ctx)}${this.#wikiBits(['toxicity', 'food', 'uses'])}`;
      case 'trefle': {
        const facts = trefleFacts(details);
        if (facts.length) return html`<dl class="facts">${facts.map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`)}</dl>
          <p class="credit">Source : Trefle (données en anglais, avec votre jeton).</p>`;
        if (!sources.getTrefleToken()) return html`<p class="muted">Ajoutez votre jeton Trefle dans <a href=${href.settings()}>Réglages › Modules</a>.</p>`;
        return loading ? pending : empty('Aucune donnée Trefle pour cette plante.');
      }
      case 'ids': return this.#ids(ctx);
      case 'resources': return this.#resources(ctx);
      default: return nothing;
    }
  }

  /** @param {any} ctx */
  #taxonomy({ plant, wikidata, status, inat }) {
    const sci = this._science;
    const chain = [...(sci?.classification || [])].reverse();
    const gbifSyn = shownSubs(this._view, 'taxonomy').includes('gbifSynonyms') ? gbifSynonyms(plant, this._gbif) : [];
    return html`
      <dl class="facts">${this.#subs('taxonomy', {
        chain: () => html`<dt>Classification</dt>
          <dd>${chain.length ? html`${chain.map(t => html`<span class="rank"><i>${t.name || t.label}</i></span> › `)}<i>${plant.scientificName}</i>`
            : sci === undefined && wikidata ? html`<span class="muted">chargement…</span>` : html`${plant.family} › <i>${plant.genus}</i> › <i>${plant.scientificName}</i>`}</dd>`,
        ranks: () => html`<dt>Famille · genre · espèce</dt><dd>${plant.family} · <i>${plant.genus}</i> · <i>${plant.species}</i></dd>`,
        author: () => html`<dt>Auteur</dt><dd>${plant.author || '—'}</dd>`,
        france: () => html`<dt>Statut en France</dt><dd>${status ? `${STATUS_LABELS[status] || status} (TAXREF ${status})` : '—'}</dd>`,
        synonyms: () => plant.synonyms?.length ? html`<dt>Synonymes (${plant.synonyms.length})</dt><dd class="sci-list"><i>${plant.synonyms.join(' · ')}</i></dd>` : nothing,
        gbifSynonyms: () => gbifSyn.length ? html`<dt>Synonymes GBIF absents de TAXREF (${gbifSyn.length})</dt><dd class="sci-list"><i>${gbifSyn.join(' · ')}</i></dd>` : nothing,
        inat: () => inat?.observationsCount != null ? html`<dt>Observations iNaturalist</dt><dd>${inat.observationsCount.toLocaleString('fr-FR')}</dd>` : nothing
      })}</dl>
      <p class="credit">Sources : TAXREF v18 (PatriNat) · Wikidata (classification)${inat?.observationsCount != null ? ' · iNaturalist' : ''}${gbifSyn.length ? ' · GBIF Backbone (synonymes)' : ''}.</p>`;
  }

  /** @param {any} ctx */
  #statuses({ plant, wikidata }) {
    const sci = this._science;
    // Global IUCN category from GBIF (IUCN Red List checklist) when Wikidata has none.
    const gbifIucn = !sci?.iucn && this._gbif.iucn?.code ? String(this._gbif.iucn.code) : null;
    const statuses = [...(plant.statuses || [])].sort((a, b) =>
      Object.keys(STATUS_TYPES).indexOf(a.type) - Object.keys(STATUS_TYPES).indexOf(b.type) || String(a.area).localeCompare(String(b.area), 'fr'));
    return html`
      ${this.#subs('status', {
        iucn: () => html`<dl class="facts">
          <dt>UICN (monde)</dt><dd>${sci?.iucn ? sci.iucn.label || sci.iucn.id
            : gbifIucn ? `${IUCN_LABELS[/** @type {keyof typeof IUCN_LABELS} */ (gbifIucn)] || gbifIucn} (${gbifIucn}) — GBIF`
            : (sci === undefined && wikidata) || this._gbif.iucn === undefined ? html`<span class="muted">chargement…</span>` : '—'}</dd>
        </dl>`,
        table: () => statuses.length ? html`<table class="statuses">
          <thead><tr><th>Type</th><th>Territoire</th><th>Statut</th></tr></thead>
          <tbody>${statuses.map(st => html`<tr><td>${STATUS_TYPES[st.type] || st.type}</td><td>${st.area}${st.level ? html` <span class="muted">(${st.level})</span>` : nothing}</td><td>${st.code && st.code !== st.label ? html`<b>${st.code}</b> ` : nothing}${st.label}</td></tr>`)}</tbody>
        </table>` : html`<p class="muted">Aucune protection, réglementation ni liste rouge connue (INPN).</p>`
      })}
      <p class="credit">Sources : INPN – Base de connaissance Statuts (PatriNat) · ${gbifIucn ? 'GBIF (Liste rouge UICN)' : 'Wikidata (UICN)'}.</p>`;
  }

  /**
   * A value of the sheet that shows on its maps when touched (map-focus.js): a button when the sheet has a
   * map, plain text otherwise. @param {import('../core/map-focus.js').MapFocus} f @param {unknown} content @param {string} [cls]
   */
  #focusable(f, content, cls = '') {
    if (!this._hasMap) return content;
    const on = isFocused(this._focus, f);
    return html`<button type="button" class="focusable ${cls}" aria-pressed=${on ? 'true' : 'false'}
      title=${on ? 'Retirer de la carte' : 'Voir sur la carte de la fiche'} @click=${() => this._focusOn(f)}>${content}</button>`;
  }

  /** Shows a value on the maps (or takes it off). @param {import('../core/map-focus.js').MapFocus} f */
  _focusOn(f) { this._focus = toggleFocus(this._focus, f); }

  /**
   * Counts as a table (value, occurrences, share with a small bar) or as a list, as the block's style says.
   * @param {string} head @param {{ label: unknown, count: number }[]} rows @param {number} total
   */
  #counts(head, rows, total) {
    if (blockStyle(this._view, 'occurrences') === 'list') return html`<ul class="counts">${rows.map(r => html`
      <li>${r.label}<b>${r.count.toLocaleString('fr-FR')}</b><small>${percent(r.count, total)}</small></li>`)}</ul>`;
    const max = Math.max(1, ...rows.map(r => r.count));
    return html`<table class="data counts-table">
      <thead><tr><th scope="col">${head}</th><th scope="col" class="num">Occurrences</th><th scope="col" class="num">Part</th></tr></thead>
      <tbody>${rows.map(r => html`<tr><td>${r.label}</td><td class="num">${r.count.toLocaleString('fr-FR')}</td>
        <td class="num pct"><span class="meter" aria-hidden="true"><i style=${`width:${Math.round(r.count / max * 100)}%`}></i></span>${percent(r.count, total)}</td></tr>`)}</tbody>
    </table>`;
  }

  /** @param {any} ctx */
  #occurrences({ details, inat }) {
    const key = details?.identifiers?.gbif?.id ?? null;
    const g = this._gbif;
    const stats = g.stats;
    const places = distributions(g);
    const pending = html`<span class="muted">chargement…</span>`;
    const search = 'https://www.gbif.org/occurrence/search?country=FR&occurrence_status=present&has_geospatial_issue=false&taxon_key=' + key;
    const statsShown = ['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => shownSubs(this._view, 'occurrences').includes(k));
    return html`${this.#subs('occurrences', {
      inat: () => html`<dl class="facts"><dt>Observations iNaturalist</dt><dd>${inat?.observationsCount != null ? inat.observationsCount.toLocaleString('fr-FR') : details === undefined ? pending : '—'}</dd></dl>`,
      gbif: () => html`<dl class="facts"><dt>Occurrences GBIF en France</dt><dd>${stats?.count != null
        ? html`<a href=${search} target="_blank" rel="noopener">${stats.count.toLocaleString('fr-FR')}</a>`
        : details === undefined || (key && stats === undefined) ? pending : '—'}</dd></dl>`,
      near: () => key ? this.#nearView() : nothing,
      months: () => stats?.count ? this.#monthBars(stats.months) : nothing,
      years: () => stats?.years?.length ? this.#yearBars(stats.years) : nothing,
      regions: () => stats?.count ? this.#areas(stats) : nothing,
      basis: () => stats?.basis?.length ? html`<h3>Types de relevés</h3>${this.#counts('Type', stats.basis.map((/** @type {any} */ b) => {
        const label = BASIS_LABELS[/** @type {keyof typeof BASIS_LABELS} */ (b.basis)] || b.basis;
        return { count: b.count, label: this.#focusable({ kind: 'filter', label, params: { basisOfRecord: b.basis } }, html`<span>${label}</span>`) };
      }), stats.count)}` : nothing,
      datasets: () => stats?.datasets?.length ? html`<h3>Principales sources</h3>${this.#counts('Source', stats.datasets.map((/** @type {any} */ d) => ({
        count: d.count,
        label: this._hasMap
          ? html`<span class="with-link">${this.#focusable({ kind: 'filter', label: g.titles?.[d.key] ?? 'source GBIF', params: { datasetKey: d.key } }, html`<span>${g.titles?.[d.key] ?? '…'}</span>`)}
              <a class="ext" href=${'https://www.gbif.org/dataset/' + d.key} target="_blank" rel="noopener" title="Le jeu de données sur GBIF.org" aria-label="Le jeu de données sur GBIF.org">↗</a></span>`
          : html`<a href=${'https://www.gbif.org/dataset/' + d.key} target="_blank" rel="noopener">${g.titles?.[d.key] ?? '…'}</a>`
      })), stats.count)}` : nothing,
      distribution: () => places.length ? html`<h3>Répartition dans le monde (listes GBIF)</h3>
        <ul class="inline">${places.map(row => html`<li>${row.country
          ? this.#focusable({ kind: 'filter', label: row.place, params: { country: row.country } }, row.place, 'chip')
          : row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>` : nothing
    })}
    ${key && statsShown && stats ? html`<p class="credit">Source : <a href=${search} target="_blank" rel="noopener">GBIF.org</a> — occurrences en France : présences seulement, coordonnées sans problème connu.</p>` : nothing}
    ${key && statsShown && stats?.count && this._hasMap ? html`<p class="focus-hint">${icon('map')} Touchez une zone, un mois, une année, un type de relevé ou une source : la carte de la fiche n’affiche que ces occurrences.</p>` : nothing}`;
  }

  /** Occurrences per month, January to December. @param {number[]} months */
  #monthBars(months) {
    const max = Math.max(1, ...months);
    const names = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return html`<h3>Occurrences par mois</h3>
      <div class="bars months" role="img" aria-label=${'Occurrences GBIF en France par mois : ' + months.map((c, i) => `${names[i]} ${c}`).join(', ')}>
        ${months.map((c, i) => {
          const bar = html`<i style=${`height:${Math.round(c / max * 100)}%`}></i><b>${'JFMAMJJASOND'[i]}</b>`;
          if (!this._hasMap) return html`<span class="bar" title=${`${names[i]} : ${c.toLocaleString('fr-FR')}`}>${bar}</span>`;
          /** @type {import('../core/map-focus.js').FilterFocus} */ const f = { kind: 'filter', label: names[i], params: { month: String(i + 1) } };
          const on = isFocused(this._focus, f);
          return html`<button type="button" class="bar focusable" aria-pressed=${on ? 'true' : 'false'} aria-label=${`${names[i]} : ${c} occurrences, sur la carte`}
            title=${`${names[i]} : ${c.toLocaleString('fr-FR')} — ${on ? 'retirer de la carte' : 'voir sur la carte'}`} @click=${() => this._focusOn(f)}>${bar}</button>`;
        })}
      </div>`;
  }

  /** Occurrences per year, the last 60 years (older ones summed). @param {{ year: number, count: number }[]} years */
  #yearBars(years) {
    const last = years[years.length - 1].year;
    const first = Math.max(years[0].year, last - 59);
    const by = new Map(years.map(y => [y.year, y.count]));
    /** @type {[number, number][]} */ const list = [];
    for (let y = first; y <= last; y++) list.push([y, by.get(y) || 0]);
    const max = Math.max(1, ...list.map(([, c]) => c));
    const older = years.filter(y => y.year < first).reduce((n, y) => n + y.count, 0);
    return html`<h3>Occurrences par année</h3>
      <div class="bars years" role="img" aria-label=${`Occurrences GBIF en France par année, de ${first} à ${last}`}>
        ${list.map(([y, c]) => {
          const bar = html`<i style=${`height:${Math.round(c / max * 100)}%`}></i>`;
          if (!this._hasMap || !c) return html`<span class="bar" title=${`${y} : ${c.toLocaleString('fr-FR')}`}>${bar}</span>`;
          /** @type {import('../core/map-focus.js').FilterFocus} */ const f = { kind: 'filter', label: String(y), params: { year: String(y) } };
          const on = isFocused(this._focus, f);
          return html`<button type="button" class="bar focusable" aria-pressed=${on ? 'true' : 'false'} aria-label=${`${y} : ${c} occurrences, sur la carte`}
            title=${`${y} : ${c.toLocaleString('fr-FR')} — ${on ? 'retirer de la carte' : 'voir sur la carte'}`} @click=${() => this._focusOn(f)}>${bar}</button>`;
        })}
      </div>
      <div class="axis"><span>${first}</span><span>${last}</span></div>
      ${older ? html`<p class="muted small">Et ${older.toLocaleString('fr-FR')} avant ${first}.</p>` : nothing}`;
  }

  /** Regions and départements (GADM areas of France) with occurrences. @param {any} stats */
  #areas(stats) {
    // Points near a border may fall in a neighbour's areas: France's only (GADM ids FRA.*).
    const regions = stats.regions.filter((/** @type {any} */ r) => r.gid.startsWith('FRA.'));
    const departments = stats.departments.filter((/** @type {any} */ d) => d.gid.startsWith('FRA.'));
    if (!regions.length && !departments.length) return nothing;
    const t = this._gbif.titles || {};
    const name = (/** @type {any} */ a) => this.#focusable({ kind: 'filter', label: t[a.gid] ?? a.gid, params: { gadmGid: a.gid } },
      html`${t[a.gid] ?? '…'} <small class="muted">(${a.count.toLocaleString('fr-FR')})</small>`, 'chip');
    const head = html`<h3>Régions et départements</h3>
      <p>Occurrences dans <strong>${departments.length}</strong> département${departments.length > 1 ? 's' : ''} et <strong>${regions.length}</strong> région${regions.length > 1 ? 's' : ''}.</p>`;
    const credit = html`<p class="credit">Découpage administratif : GADM, via GBIF.</p>`;
    if (blockStyle(this._view, 'occurrences') !== 'list') {
      const label = (/** @type {any} */ a) => this.#focusable({ kind: 'filter', label: t[a.gid] ?? a.gid, params: { gadmGid: a.gid } }, html`<span>${t[a.gid] ?? '…'}</span>`);
      return html`${head}
        ${regions.length ? html`<h4>Régions</h4>${this.#counts('Région', regions.map((/** @type {any} */ r) => ({ label: label(r), count: r.count })), stats.count)}` : nothing}
        ${departments.length ? html`<h4>Départements les plus cités</h4>${this.#counts('Département', departments.slice(0, 8).map((/** @type {any} */ d) => ({ label: label(d), count: d.count })), stats.count)}` : nothing}
        ${credit}`;
    }
    return html`${head}
      <dl class="facts">
        ${departments.length ? html`<dt>Départements les plus cités</dt><dd>${departments.slice(0, 5).map((/** @type {any} */ d, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(d)}`)}</dd>` : nothing}
        ${regions.length ? html`<dt>Régions</dt><dd>${regions.map((/** @type {any} */ r, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(r)}`)}</dd>` : nothing}
      </dl>
      ${credit}`;
  }

  /** « Près d’ici »: GBIF occurrences around the user, on demand (the position is sent to GBIF). */
  #nearView() {
    const n = this._near;
    const radius = savedRadius();
    const head = html`<h3>Près d’ici</h3>`;
    if (!n) return html`${head}
      <p><button type="button" class="near-ask" @click=${() => this.#findNear()}>${icon('crosshair')} Chercher autour de moi (${formatDistance(radius)})</button></p>
      <p class="credit">Votre position est envoyée à GBIF pour cette recherche, sans être enregistrée.</p>`;
    if (n.state === 'locating') return html`${head}<p class="muted">Recherche de votre position…</p>`;
    if (n.state === 'loading') return html`${head}<p class="muted">chargement…</p>`;
    if (n.state === 'error') return html`${head}<p class="muted">${n.message} <button class="link" type="button" @click=${() => this.#findNear()}>Réessayer</button></p>`;
    return html`${head}
      ${n.total ? html`<p><strong>${n.total.toLocaleString('fr-FR')}</strong> occurrence${n.total > 1 ? 's' : ''} GBIF à moins de ${formatDistance(n.radius)}${n.nearest.length ? ' ; les plus proches :' : '.'}</p>
        <ul class="near">${n.nearest.map((/** @type {any} */ o) => html`<li title=${o.dataset || ''}>
          ${this.#focusable({ kind: 'point', label: 'GBIF à ' + formatDistance(o.distance), coordinates: o.coordinates, url: 'https://www.gbif.org/occurrence/' + o.key },
            html`<strong>${formatDistance(o.distance)}</strong>`)}
          <span>${o.date ? new Date(o.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }) : 'date inconnue'}
            · ${BASIS_LABELS[/** @type {keyof typeof BASIS_LABELS} */ (o.basis)] || o.basis || ''}</span>
          <a href=${'https://www.gbif.org/occurrence/' + o.key} target="_blank" rel="noopener">voir</a></li>`)}</ul>`
        : html`<p class="muted">Aucune occurrence GBIF à moins de ${formatDistance(n.radius)}.</p>`}
      <p class="credit">Source : GBIF.org — présences, coordonnées sans problème connu. Rayon : celui d’« Autour » (Carte).</p>`;
  }

  /** Looks for GBIF occurrences around the user's position (a recent one, else asks the GPS once). */
  async #findNear() {
    const key = this._details?.identifiers?.gbif?.id;
    const plant = this._plant;
    if (!key) return;
    nearAllowed = true;
    this._near = { state: 'locating' };
    const known = lastFix();
    const fix = known && Date.now() - known.timestamp < 5 * 60000 ? known : await oneFix({ maxAge: 5 * 60000, timeout: 20000 });
    if (this._plant !== plant) return;
    if (!fix || 'error' in fix) { this._near = { state: 'error', message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' }; return; }
    const radius = savedRadius();
    this._near = { state: 'loading' };
    try {
      const result = await sources.gbifNear(key, fix.coordinates, radius);
      if (this._plant === plant) this._near = result ? { state: 'done', radius, ...result } : { state: 'error', message: 'GBIF est désactivé (Réglages › Modules).' };
    } catch {
      if (this._plant === plant) this._near = { state: 'error', message: 'GBIF ne répond pas pour le moment.' };
    }
  }

  /** « Médias GBIF »: field photos and herbarium sheets, apart. @param {any} ctx */
  #gbifMedia({ plant, photosOff }) {
    if (photosOff) return html`<p class="muted">${photosOffLine()}</p>`;
    const g = this._gbif;
    return html`${this.#subs('gbifMedia', {
      photos: () => this.#mediaGallery(plant, 'Photos d’observation (France)', g.photos, 'Aucune photo d’observation sous licence libre sur GBIF.', false),
      herbarium: () => this.#mediaGallery(plant, 'Planches d’herbier', g.herbarium, 'Aucune planche d’herbier sous licence libre sur GBIF.', true)
    })}${g.photos?.length || g.herbarium?.length ? this.#allMedia() : nothing}`;
  }

  /** @param {any} plant @param {string} title @param {any[] | null | undefined} list @param {string} none @param {boolean} herbarium */
  #mediaGallery(plant, title, list, none, herbarium) {
    const head = html`<h3>${title}</h3>`;
    if (list === undefined) return html`${head}<p class="muted">chargement…</p>`;
    // Its source failed: the block says so above (#content), not « none ».
    if (!list?.length) return this._failed['gbif:' + (herbarium ? 'herbarium' : 'photos')] || this._failed['details:gbif'] ? head : html`${head}<p class="muted">${none}</p>`;
    return html`${head}<div class="gallery ${herbarium ? 'herbarium' : ''}">${list.map(image => html`<figure>
      <a href=${safeUrl(image.sourceUrl || image.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}><img src=${image.url} alt=${(herbarium ? 'Planche d’herbier de ' : '') + plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${dropFigure} @load=${showImg} /></a>
      <figcaption>
        ${herbarium ? html`<span class="specimen">${[image.institution, image.catalogNumber && 'n° ' + image.catalogNumber, image.year, image.country].filter(Boolean).join(' · ')}</span>` : nothing}
        ${image.coordinates && this._hasMap ? this.#focusable({ kind: 'point', label: (herbarium ? 'Planche ' : 'Photo ') + ([image.institution, image.year].filter(Boolean).join(' ') || 'GBIF'), coordinates: image.coordinates, url: image.sourceUrl },
          html`${icon('geo-alt-fill')} ${image.locality ? image.locality.slice(0, 60) + (image.locality.length > 60 ? '…' : '') : 'Lieu de récolte'}`, 'where') : nothing}
        <gf-attribution .media=${image}></gf-attribution>
      </figcaption></figure>`)}</div>`;
  }

  /** « Habitat et écologie (GBIF) »: what the species profiles of GBIF checklists say. */
  #gbifProfile() {
    if (this._gbif.speciesProfiles === undefined) return html`<p class="muted">chargement…</p>`;
    const p = profile(this._gbif);
    if (!p.habitats.length && !p.forms.length && !p.invasive.length) return html`<p class="muted">Aucun profil d’espèce exploitable sur GBIF.</p>`;
    const key = this._details?.identifiers?.gbif?.id;
    const credit = html`<p class="credit">Source : <a href=${'https://www.gbif.org/species/' + key} target="_blank" rel="noopener">GBIF.org</a> — profils d’espèce de ${p.sources} liste${p.sources > 1 ? 's' : ''} de référence.</p>`;
    if (blockStyle(this._view, 'gbifProfile') === 'list') return html`<ul class="plain">
        ${p.habitats.length ? html`<li><b>Milieu :</b> ${p.habitats.map(([h]) => h).join(' · ')}</li>` : nothing}
        ${p.forms.length ? html`<li><b>Port :</b> ${p.forms.map(([f]) => f).join(' · ')}</li>` : nothing}
        ${p.invasive.length ? html`<li><b>Signalée envahissante :</b> ${p.invasive.slice(0, 4).join(' · ')}${p.invasive.length > 4 ? ` et ${p.invasive.length - 4} autres listes` : ''}</li>` : nothing}
      </ul>${credit}`;
    return html`<dl class="facts">
        ${p.habitats.length ? html`<dt>Milieu</dt><dd>${p.habitats.map(([h]) => h).join(' · ')}</dd>` : nothing}
        ${p.forms.length ? html`<dt>Port</dt><dd>${p.forms.map(([f]) => f).join(' · ')}</dd>` : nothing}
        ${p.invasive.length ? html`<dt>Signalée envahissante</dt><dd>${p.invasive.slice(0, 4).join(' · ')}${p.invasive.length > 4 ? ` et ${p.invasive.length - 4} autres listes` : ''}</dd>` : nothing}
      </dl>
      <p class="credit">Source : <a href=${'https://www.gbif.org/species/' + key} target="_blank" rel="noopener">GBIF.org</a> — profils d’espèce de ${p.sources} liste${p.sources > 1 ? 's' : ''} de référence.</p>`;
  }

  /** « Publications (GBIF) »: the latest papers that used GBIF data on this taxon. @param {any} ctx */
  #literature({ details }) {
    const l = this._gbif.literature;
    if (l === undefined) return html`<p class="muted">chargement…</p>`;
    if (!l?.items?.length) return html`<p class="muted">Aucune publication citant des données GBIF sur cette espèce.</p>`;
    const key = details?.identifiers?.gbif?.id;
    const authors = (/** @type {any} */ r) => r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : '');
    if (blockStyle(this._view, 'literature') !== 'list') return html`<table class="data papers-table">
        <thead><tr><th scope="col">Titre</th><th scope="col">Auteurs</th><th scope="col">Revue</th><th scope="col" class="num">Année</th></tr></thead>
        <tbody>${l.items.map((/** @type {any} */ r) => html`<tr>
          <td>${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title}</a>` : r.title}</td>
          <td>${authors(r)}</td><td>${r.source}</td><td class="num">${r.year ?? ''}</td></tr>`)}</tbody>
      </table>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
    return html`<ul class="papers">${l.items.map((/** @type {any} */ r) => html`<li>
        ${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title}</a>` : r.title}
        <small>${[r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : ''), r.source, r.year].filter(Boolean).join(' · ')}</small>
      </li>`)}</ul>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
  }


  /**
   * The plant's verdict from what « Usages » read (core/danger.js#dangerLevel, as the badge, the cards and the harvest
   * warning have it): the safety file's entry and the confusions, a file that could not be read said first.
   * @param {any} plant
   */
  #sheetVerdict(plant) {
    const o = this._open;
    return dangerLevel({ statuses: plant.statuses, safety: o.safety === UNREAD ? null : o.safety,
      confusions: Array.isArray(o.confusions) ? o.confusions : [], unread: o.safety === UNREAD || o.confusions === UNREAD });
  }

  /**
   * What says to be careful with this plant, each with its source, at its verdict's level (core/danger.js): a file
   * that could not be read, ANSM liste B and liste A's toxic parts, TPPT toxicity, confusions with toxic plants
   * (Anses: the edible side's in one line), protection and harvest rules, the Red List (INPN). The gravest first.
   * @param {any} plant @returns {{ verdict: import('../core/danger.js').Verdict, items: { level: import('../core/danger.js').Level, text: unknown }[] }}
   */
  #danger(plant) {
    const o = this._open;
    const verdict = this.#sheetVerdict(plant);
    /** The level the verdict gives a kind of reason (its gravest, for the confusions). @param {import('../core/danger.js').Kind} kind */
    const levelOf = kind => verdict.reasons.filter(r => r.kind === kind).reduce((/** @type {import('../core/danger.js').Level} */ l, r) => rank(r.level) > rank(l) ? r.level : l, 'none');
    /** @type {{ level: import('../core/danger.js').Level, text: unknown }[]} */
    const out = [];
    if (o.safety === UNREAD || o.confusions === UNREAD) {
      const what = o.safety !== UNREAD ? 'Liste des confusions indisponible' : o.confusions === UNREAD ? 'Données de toxicité et liste des confusions indisponibles' : 'Données de toxicité indisponibles';
      out.push({ level: levelOf('unread'), text: html`<b>${what} pour le moment</b> : ne consommez aucune plante sans vérification. <button type="button" class="link" @click=${() => this.#retrySafety()}>Réessayer</button>` });
    }
    const ansm = /** @type {any[]} */ (o.safety === UNREAD ? [] : [].concat(o.safety?.ansm || [])), tppt = o.safety === UNREAD ? null : o.safety?.tppt;
    // The pair's severity, on both sides: the toxic side is the dangerous plant itself, even without ANSM or TPPT data.
    const confusions = /** @type {import('../core/lookalikes.js').Lookalike[]} */ (Array.isArray(o.confusions) ? o.confusions : []);
    const toxicSide = confusions.filter(l => l.side === 'toxic'), edibleSide = confusions.filter(l => l.side === 'edible');
    const see = html` Voir « ${blockTitle('lookalikes')} »${this._usesBox ? ' ci-dessous' : ''}. <span class="src">Anses, Centres antipoison</span>`;
    if (toxicSide.length) out.push({ level: levelOf('toxic-side'), text: html`<b>Plante ${gravest(toxicSide).plant}</b>, confondue avec ${[...new Set(toxicSide.flatMap(l => l.others.map(x => x.label)))].join(', ')}.${see}` });
    // TPPT in French; the base's own words on hover (levelEn, partsEn). Level 0: listed, toxicity to humans unknown. A
    // plant kept toxic by hand against the base (`reviewed`): its reason on hover, and the review as its source.
    if (tppt) out.push({ level: levelOf('tppt'), text: html`<b title=${tppt.reviewed || (tppt.levelEn ? 'TPPT : ' + tppt.levelEn : nothing)}>${tppt.level >= 2 ? 'Plante toxique' : tppt.level === 0 ? 'Toxicité pour l’humain inconnue' : 'Attention'}</b>${tppt.levelLabel && tppt.level > 0 ? ` (${tppt.levelLabel})` : ''}${tppt.parts ? html` — <span title=${tppt.partsEn ? 'TPPT : ' + tppt.partsEn : nothing}>${tppt.level >= 2 ? 'parties toxiques' : 'parties concernées'} : ${tppt.parts}</span>` : nothing}${tppt.toxins?.length ? html` ; substances : ${tppt.toxins.slice(0, 4).join(', ')}` : nothing}. <span class="src">${tppt.reviewed ? 'Genre toxique, revu à la main' : 'Agroscope, base TPPT'}</span>` });
    for (const b of ansm.filter(a => a.list === 'B')) out.push({ level: levelOf('ansm-b'), text: html`<b>Pharmacopée française, liste B</b>${b.from ? ` (listée sous « ${b.from} sp. », genre dont elle faisait partie)` : b.genus ? ' (tout le genre)' : ''} : plante médicinale dont les effets indésirables potentiels l’emportent sur le bénéfice attendu${b.parts ? html` — partie concernée : ${b.parts}` : nothing}. <span class="src">ANSM</span>` });
    for (const a of ansm.filter(a => a.list === 'A' && a.toxicParts)) out.push({ level: levelOf('ansm-a'), text: html`<b>Parties toxiques</b> : ${a.toxicParts}. <span class="src">ANSM, Pharmacopée liste A</span>` });
    if (edibleSide.length) out.push({ level: levelOf('edible-side'), text: html`<b>Risque de confusion</b> avec une plante ${gravest(edibleSide).plant} : ${[...new Set(edibleSide.flatMap(l => l.others.map(x => x.label + severityNote(l.pair))))].join(', ')}.${see}` });
    const st = plant.statuses || [];
    const protectedIn = [...new Set(st.filter((/** @type {any} */ x) => /^P[NRD]$/.test(x.type)).map((/** @type {any} */ x) => x.area || x.label))].slice(0, 3);
    if (protectedIn.length) out.push({ level: levelOf('protected') === 'none' ? levelOf('protected-elsewhere') : levelOf('protected'), text: html`<b>Espèce protégée</b> (${protectedIn.join(', ')}) : cueillette interdite là où elle l’est. <span class="src">INPN</span>` });
    const rule = harvestRuleText(st);
    if (rule) out.push({ level: levelOf('regulated'), text: html`<b>${rule}</b> (voir « ${blockTitle('status')} »). <span class="src">INPN</span>` });
    const red = verdict.reasons.find(r => r.kind === 'threatened');
    if (red) out.push({ level: red.level, text: html`<b>${red.text}</b> (voir « ${blockTitle('status')} »). <span class="src">${red.source}</span>` });
    // The gravest first (stable sort: the order above stays within a level, as the verdict's).
    return { verdict, items: out.sort((a, b) => rank(b.level) - rank(a.level)) };
  }

  /**
   * Usages shown alone: « Plantes à confondre » under its Prudence — the one never without the other. Direct children
   * of the block's content: the box hidden, its line « Aucune confusion… » shown (.if-empty). Prudence's « Réessayer »
   * reads it again (every gf-lookalikes of the block), its own asks Prudence again (safety-retry). @param {any} plant
   */
  #lookalikesBox(plant) {
    const v = this._view;
    return html`<h3>${blockTitle('lookalikes')}</h3>
      <gf-lookalikes .plant=${plant} ?compact=${baseOf(v) === 'epure'} ?detailed=${baseOf(v) === 'scientific'}
        @safety-retry=${() => this.#retrySafety(false)}></gf-lookalikes>
      <p class="muted if-empty">${NO_CONFUSION}</p>`;
  }

  /** « Usages et cuisine sauvage »: safety first, then sourced uses, parts and products, dishes and recipes. @param {any} ctx */
  #uses({ plant }) {
    const o = this._open;
    const style = blockStyle(this._view, 'uses');
    const { verdict, items: danger } = this.#danger(plant);
    const wd = o.wdUses;
    const ansmA = (/** @type {any[]} */ (o.safety?.ansm || [])).filter(a => a.list === 'A');
    const pending = html`<p class="muted">chargement…</p>`;
    const KIND = { food: 'Alimentation', medicine: 'Médecine traditionnelle', other: 'Autres usages' };
    return html`${this.#subs('uses', {
      safety: () => {
        // No toxicity in our sources (and not the toxic side of a confusion): said so, without reassuring.
        const tox = (/** @type {any[]} */ (o.safety?.ansm || [])).some(a => a.list === 'B' || a.toxicParts) || o.safety?.tppt
          || (Array.isArray(o.confusions) && o.confusions.some(l => l.side === 'toxic'));
        const none = o.safety !== undefined && o.safety !== UNREAD && Array.isArray(o.confusions) && !tox;
        // The verdict's chip on top: the same word and colour as the badge of Alertes and the plant's cards.
        const prudence = !danger.length && !none ? nothing : html`${danger.length ? html`<div class="prudence ${rank(verdict.level) >= rank('danger') ? 'grave' : ''}">
          <p class="verdict">${severityChip(verdict)}</p>
          <ul>${danger.map(d => html`<li data-level=${d.level}>${icon(rank(d.level) >= rank('danger') ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill')}<span>${d.text}</span></li>`)}</ul>
          <p class="small">En cas de doute, ne la consommez pas. ${emergency()}. <span class="src">Anses</span></p>
        </div>` : nothing}${none ? html`<p class="small no-tox">Aucune donnée de toxicité dans nos sources (ANSM, TPPT) : cela ne veut pas dire qu’elle est comestible ni sans danger. En cas de doute, ne la consommez pas.</p>` : nothing}`;
        return this._usesBox ? html`${prudence}${this.#lookalikesBox(plant)}` : prudence;
      },
      uses: () => {
        const head = html`<h3>${danger.length ? 'Usages rapportés (non vérifiés, voir Prudence)' : 'Usages rapportés (non vérifiés)'}</h3>`;
        const groups = /** @type {Record<string, any[]>} */ ({});
        for (const u of wd?.uses || []) (groups[u.kind] ||= []).push(u);
        if (wd === undefined && !ansmA.length) return html`${head}${pending}`;
        if (!wd?.uses?.length && !ansmA.length) return nothing;
        return html`${head}
          ${ansmA.length ? html`<p class="small"><b>Pharmacopée française, liste A</b> : plante médicinale utilisée traditionnellement — partie${ansmA.length > 1 || /,/.test(ansmA[0].parts || '') ? 's' : ''} utilisée${ansmA.length > 1 || /,/.test(ansmA[0].parts || '') ? 's' : ''} : ${ansmA.map(a => a.parts).filter(Boolean).join(' ; ') || 'non précisée'}. <span class="src">ANSM</span></p>` : nothing}
          ${Object.keys(groups).length ? html`<dl class="facts">${['food', 'medicine', 'other'].filter(k => groups[k]).map(k => html`<dt>${KIND[/** @type {'food'} */ (k)]}</dt>
            <dd>${groups[k].map((u, i) => html`${i ? ' · ' : ''}<a href=${'https://www.wikidata.org/wiki/' + u.id} target="_blank" rel="noopener">${u.label}</a>`)}</dd>`)}</dl>
            <p class="credit">Usages déclarés sur <a href=${'https://www.wikidata.org/wiki/' + wd?.qid} target="_blank" rel="noopener">Wikidata</a> (CC0), sans source détaillée : à recouper.</p>` : nothing}`;
      },
      parts: () => {
        if (!wd?.products?.length) return nothing;
        const rows = wd.products;
        return html`<h3>Parties et produits</h3>${style === 'list'
          ? html`<p class="small">${rows.map((p, i) => html`${i ? ' · ' : ''}${p.label}${p.parts.length ? html` <span class="muted">(${p.parts.join(', ')})</span>` : nothing}`)}</p>`
          : html`<table class="data"><thead><tr><th scope="col">Produit</th><th scope="col">Partie de la plante</th></tr></thead>
            <tbody>${rows.map(p => html`<tr><td><a href=${'https://www.wikidata.org/wiki/' + p.id} target="_blank" rel="noopener">${p.label}</a></td><td>${p.parts.join(', ') || html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table>`}
          <p class="credit">Source : Wikidata (CC0).</p>`;
      },
      kitchen: () => {
        const dishes = wd?.dishes || [];
        const books = o.recipes || [];
        if (!dishes.length && !books.length) return o.recipes === undefined && wd === undefined ? html`<h3>En cuisine</h3>${pending}` : nothing;
        return html`<h3>En cuisine</h3>
          ${dishes.length ? html`<p class="small"><b>Plats</b> : ${dishes.map((d, i) => html`${i ? ' · ' : ''}<a href=${safeUrl(d.url) || 'https://www.wikidata.org/wiki/' + d.id} target="_blank" rel="noopener">${d.label}</a>`)}</p>` : nothing}
          ${books.length ? html`<ul class="recipes">${books.map((/** @type {any} */ r) => html`<li>${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title.replace(/^Cookbook:/, '')}</a>` : r.title.replace(/^Cookbook:/, '')} <span class="muted">(${r.lang === 'fr' ? 'Wikibooks' : 'Wikibooks, en anglais'})</span></li>`)}</ul>` : nothing}
          <p class="credit">Plats : Wikidata (CC0) ; recettes : Wikibooks (CC BY-SA), non vérifiées.</p>`;
      },
      links: () => {
        const links = [];
        if (wd?.pfaf) links.push(html`<a href=${'https://pfaf.org/user/Plant.aspx?LatinName=' + encodeURIComponent(wd.pfaf.replace(/_/g, ' '))} target="_blank" rel="noopener">Plants For A Future (PFAF)</a>`);
        links.push(html`<a href=${'https://www.ema.europa.eu/en/search?search_api_fulltext=' + encodeURIComponent(plant.scientificName.split(' ').slice(0, 2).join(' '))} target="_blank" rel="noopener">Monographies de plantes (EMA)</a>`);
        if (o.safety?.ansm?.length) links.push(html`<a href="https://ansm.sante.fr/pharmacopee/liste-des-plantes-medicinales-utilisees-traditionnellement" target="_blank" rel="noopener">Pharmacopée française (ANSM)</a>`);
        return html`<h3>Pour aller plus loin</h3><ul class="inline links">${links.map(l => html`<li>${l}</li>`)}</ul>`;
      }
    })}`;
  }

  /** « Pollinisateurs et interactions » (GloBI): by role, as a table, a list or a network. @param {any} ctx */
  #interactions({ plant }) {
    const data = this._open.interactions;
    if (data === undefined) return html`<p class="muted">chargement…</p>`;
    if (!data?.roles?.length) return html`<p class="muted">Aucune interaction connue de GloBI pour cette espèce.</p>`;
    const keys = shownSubs(this._view, 'interactions');
    const roles = data.roles.filter((/** @type {any} */ r) => keys.includes(r.key));
    const style = blockStyle(this._view, 'interactions');
    const globi = safeUrl(data.url) || 'https://www.globalbioticinteractions.org/';
    const credit = html`<p class="credit">Source : <a href=${globi} target="_blank" rel="noopener">GloBI — Global Biotic Interactions</a> :
      ${data.total.toLocaleString('fr-FR')} mention${data.total > 1 ? 's' : ''} tirées de ${data.studies.toLocaleString('fr-FR')} étude${data.studies > 1 ? 's' : ''} ou jeu${data.studies > 1 ? 'x' : ''} de données (CC BY selon les sources).</p>`;
    if (!roles.length) return html`<p class="muted">Aucune interaction de ce type connue de GloBI.</p>${credit}`;
    const partner = (/** @type {any} */ p) => html`<span class="partner"><i class="dot" style=${`background:${groupColor(p.group)}`}></i><em>${p.name}</em></span>`;
    if (style === 'graph') return html`${networkChart(plant.scientificName, roles)}${groupLegend(roles)}${credit}`;
    if (style === 'list') return html`${roles.map((/** @type {any} */ r) => {
      const groups = new Map();
      for (const p of r.partners) groups.set(p.group, (groups.get(p.group) || 0) + 1);
      return html`<h3>${r.label} <small class="muted">(${r.count})</small></h3>
        <p class="small">${[...groups].sort((a, b) => b[1] - a[1]).map(([g, n], i) => html`${i ? ' · ' : ''}<i class="dot" style=${`background:${groupColor(g)}`}></i>${g} (${n})`)}</p>
        <p class="small partners">${r.partners.slice(0, 12).map((/** @type {any} */ p, /** @type {number} */ i) => html`${i ? ', ' : ''}<em>${p.name}</em>`)}${r.count > 12 ? ` et ${r.count - 12} autres` : ''}.</p>`;
    })}${credit}`;
    return html`${roles.map((/** @type {any} */ r) => html`<h3>${r.label} <small class="muted">(${r.count} espèce${r.count > 1 ? 's' : ''} ou groupe${r.count > 1 ? 's' : ''})</small></h3>
      <table class="data counts-table"><thead><tr><th scope="col">Espèce ou groupe</th><th scope="col">Groupe</th><th scope="col" class="num">Mentions</th></tr></thead>
        <tbody>${r.partners.slice(0, 12).map((/** @type {any} */ p) => html`<tr><td>${partner(p)}</td><td>${p.group}</td><td class="num">${p.count}</td></tr>`)}</tbody></table>
      ${r.count > 12 ? html`<p class="muted small">Et ${r.count - 12} autres sur <a href=${globi} target="_blank" rel="noopener">GloBI</a>.</p>` : nothing}`)}${credit}`;
  }

  /** « Climat et pollen » (Open-Meteo × GBIF): today's pollen of the plant, its climate niche, my position on it. @param {any} ctx */
  #climate({ plant }) {
    const v = this._view;
    const here = this._open.here;
    const pollen = openData.pollenOf(plant);
    const ask = (/** @type {string} */ label) => html`<p><button type="button" class="here-ask" @click=${() => this.#findHere()}>${icon('crosshair')} ${label}</button></p>
      <p class="credit">Votre position (arrondie à 100 m) est envoyée à Open-Meteo pour ce calcul, sans être enregistrée.</p>`;
    const hereState = !here ? null : here.state === 'locating' ? html`<p class="muted">Recherche de votre position…</p>` : here.state === 'loading' ? html`<p class="muted">chargement…</p>`
      : here.state === 'error' ? html`<p class="muted">${here.message} <button class="link" type="button" @click=${() => this.#findHere()}>Réessayer</button></p>` : null;
    return html`${this.#subs('climate', {
      pollen: () => {
        if (!pollen) return nothing;
        const head = html`<h3>Pollen de ${pollen.label.toLowerCase()} aujourd’hui</h3>`;
        if (!here) return html`${head}${ask('Voir le pollen là où je suis')}`;
        if (hereState) return html`${head}${hereState}`;
        const value = here.pollen?.values?.[pollen.key];
        if (value == null) return html`${head}<p class="muted">Pas de prévision de pollen ici (le modèle CAMS couvre l’Europe).</p>`;
        const lvl = openData.pollenLevel(value);
        return html`${head}<p class="pollen"><span class="level l${lvl.level}">${lvl.label}</span> — jusqu’à <strong>${Math.round(value)}</strong> grains/m³ aujourd’hui autour de vous.</p>
          <p class="credit">Prévision : Copernicus CAMS via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</p>`;
      },
      niche: () => {
        const niche = this._open.niche;
        const head = html`<h3>Niche climatique en France</h3>`;
        if (niche === undefined) return html`${head}<p class="muted">chargement…</p>`;
        if (!niche?.points?.length) return this._failed.niche || this._failed['details:gbif'] ? head : html`${head}<p class="muted">Pas assez d’occurrences GBIF localisées en France pour situer son climat.</p>`;
        const temps = niche.points.map((/** @type {any} */ p) => p.temp).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const rains = niche.points.map((/** @type {any} */ p) => p.precip).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const mine = here?.state === 'done' && here.climate ? { temp: here.climate.annualTemp, precip: here.climate.annualPrecip, label: 'chez vous' } : null;
        const inside = mine && mine.temp >= temps[Math.floor(temps.length * 0.1)] && mine.temp <= temps[Math.ceil(temps.length * 0.9) - 1]
          && mine.precip >= rains[Math.floor(rains.length * 0.1)] && mine.precip <= rains[Math.ceil(rains.length * 0.9) - 1];
        return html`${head}${nicheChart(niche.points, mine)}
          <p class="small">Là où elle a été observée : <strong>${temps[0]} à ${temps[temps.length - 1]} °C</strong> de moyenne annuelle,
            <strong>${rains[0].toLocaleString('fr-FR')} à ${rains[rains.length - 1].toLocaleString('fr-FR')} mm</strong> de pluie par an (${niche.points.length} lieux, cadre : 80 % d’entre eux).
            ${mine ? html`Chez vous : ${mine.temp} °C, ${mine.precip.toLocaleString('fr-FR')} mm — ${inside ? 'dans sa niche' : 'en dehors du cœur de sa niche'}.` : nothing}</p>
          ${this.#altitudes(niche.altitudes, here?.state === 'done' ? here.climate?.elevation : null)}
          ${!mine && !here ? ask('Me situer sur ce graphique') : hereState || nothing}
          ${mine && baseOf(v) !== 'epure' ? html`<details class="here-climate"><summary>Climat chez vous (${here.climate.years})</summary>${climateChart(here.climate.temp, here.climate.precip)}</details>` : nothing}
          <p class="credit">Climat : ERA5 via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (moyennes ${niche.years}, CC BY 4.0) aux occurrences de <a href=${'https://www.gbif.org/species/' + (this._details?.identifiers?.gbif?.id ?? '')} target="_blank" rel="noopener">GBIF.org</a>.</p>`;
      }
    })}`;
  }

  /**
   * The altitudes where it was observed in France (GBIF), and mine (Open-Meteo's, for my position) beside them.
   * @param {import('../core/open-data.js').Altitudes | null | undefined} a @param {number | null | undefined} mine
   */
  #altitudes(a, mine) {
    if (!a) return nothing;
    const m = (/** @type {number} */ v) => formatAltitude(v);
    const where = typeof mine === 'number' ? (mine >= a.low && mine <= a.high ? 'dans cette tranche' : mine < a.low ? 'plus bas que la plupart' : 'plus haut que la plupart') : '';
    return html`<p class="small">${icon('triangle')} Altitude : le plus souvent <strong>entre ${m(a.low)} et ${m(a.high)}</strong>
      (de ${m(a.min)} à ${m(a.max)} ; ${a.n} des ${a.of} occurrences GBIF la donnent).
      ${where ? html`Chez vous : ${m(/** @type {number} */ (mine))}, ${where}.` : nothing}</p>`;
  }

  /** @param {any} ctx */
  #ids({ plant, details, inat, wikidata }) {
    const claims = this._science?.claims;
    const gbif = details?.identifiers?.gbif;
    /** @type {Record<string, [string, unknown, string | null | undefined]>} */
    const all = {
      taxref: ['TAXREF (cd_nom)', plant.id, plant.links?.taxref],
      inpn: ['INPN', plant.id, plant.links?.inpn],
      gbif: ['GBIF', gbif?.id, gbif?.id ? 'https://www.gbif.org/species/' + gbif.id : null],
      inaturalist: ['iNaturalist', inat?.id, inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : null],
      wikidata: ['Wikidata', wikidata, wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : null],
      tela: ['Tela Botanica', claims?.tela, claims?.tela ? 'https://www.tela-botanica.org/bdtfx-nn-' + claims.tela : null],
      ipni: ['IPNI', claims?.ipni, claims?.ipni ? 'https://www.ipni.org/n/' + claims.ipni : null],
      powo: ['POWO', claims?.powo, claims?.powo ? 'https://powo.science.kew.org/taxon/' + claims.powo : null],
      trefle: ['Trefle', details?.identifiers?.trefle?.id, details?.identifiers?.trefle?.slug ? 'https://trefle.io/species/' + details.identifiers.trefle.slug : null]
    };
    const ids = shownSubs(this._view, 'ids').map(k => all[k]).filter(row => row?.[1]);
    const value = (/** @type {any} */ id, /** @type {any} */ url) => url ? html`<a href=${url} target="_blank" rel="noopener">${id}</a>` : id;
    if (blockStyle(this._view, 'ids') === 'list') return html`<ul class="inline ids">${ids.map(([label, id, url]) => html`<li><span class="muted">${label}</span> ${value(id, url)}</li>`)}</ul>`;
    return html`<table class="data ids"><tbody>${ids.map(([label, id, url]) => html`<tr><th scope="row">${label}</th><td>${value(id, url)}</td></tr>`)}</tbody></table>`;
  }
}
