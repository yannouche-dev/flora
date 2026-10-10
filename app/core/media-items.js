// @ts-check
// Every image of a plant, from every source, as one list for the media viewer: the dataset photo, Wikimedia
// Commons, iNaturalist (the taxon's chosen photos), GBIF field photos and herbarium sheets.
// Each item knows three sizes of the same image: a thumbnail (filmstrip), a display size (the stage) and the
// original (the zoom) — derived from the URL patterns of each host (`sizes`), the only place that knows them.

import * as sources from './sources.js';
import { moduleOn } from './modules.js';

/** @typedef {import('./modules.js').Mode} Mode */

/**
 * @typedef {{
 *   key: string, kind: 'photo' | 'observation' | 'herbarium', source: string,
 *   thumb: string, display: string, original: string, src: string, width?: number | null, height?: number | null,
 *   author?: string | null, attribution?: string | null, license?: string | null, licenseUrl?: string | null,
 *   pageUrl?: string | null, sourceUrl?: string | null, title?: string | null,
 *   institution?: string, catalogNumber?: string, year?: number | null, country?: string, locality?: string,
 *   coordinates?: [number, number] | null
 * }} MediaItem
 */

const INAT = /^(https?:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/\d+\/)(?:square|thumb|small|medium|large|original)(\.\w+)(\?.*)?$/i;
const COMMONS_THUMB = /^https?:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/(\w\/\w\w\/[^/?]+)\/\d+px-[^/?]+/i;
const COMMONS_FILE = /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(\w\/\w\w\/[^/?]+)(?:\?.*)?$/i;

/**
 * Thumbnail, display and original URLs of one image, from its URL alone.
 * - iNaturalist: …/photos/<id>/{square|small|medium|large|original}.<ext>
 * - Wikimedia Commons: …/commons/thumb/a/ab/<File>/<N>px-<File> (standard widths) and …/commons/a/ab/<File>
 * - anything else (herbaria…): one size.
 * @param {string} url @returns {{ thumb: string, display: string, original: string }}
 */
export function sizes(url) {
  const u = String(url || '');
  const inat = INAT.exec(u);
  if (inat) {
    const at = (/** @type {string} */ size) => inat[1] + size + inat[2];
    return { thumb: at('small'), display: at('large'), original: at('original') };
  }
  const file = COMMONS_THUMB.exec(u)?.[1] || COMMONS_FILE.exec(u)?.[1];
  if (file) {
    const name = file.split('/').pop() || '';
    // Commons serves thumbnails at standard widths only; SVG and TIFF thumbnails are PNG / JPEG.
    const ext = /\.svg$/i.test(name) ? '.png' : /\.tiff?$/i.test(name) ? '.jpg' : '';
    const thumb = (/** @type {number} */ w) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${file}/${w}px-${name}${ext}`;
    return { thumb: thumb(330), display: thumb(1280), original: `https://upload.wikimedia.org/wikipedia/commons/${file}` };
  }
  return { thumb: u, display: u, original: u };
}

/** Same image, whatever its size or host: the key of its original. @param {string} url */
export const imageKey = url => {
  try { return decodeURIComponent(sizes(url).original).replace(/_/g, ' ').toLowerCase(); } catch { return url; }
};

/**
 * The media of a plant, in a stable order (dataset photo, Commons, iNaturalist, GBIF photos, herbarium),
 * one item per image.
 * @param {any} plant
 * @param {{ details?: any, inat?: any[] | null, gbifPhotos?: any[] | null, herbarium?: any[] | null }} data
 * @returns {MediaItem[]}
 */
export function mediaOf(plant, { details, inat, gbifPhotos, herbarium }) {
  /** @type {MediaItem[]} */
  const items = [];
  const seen = new Set();
  /** @param {Omit<MediaItem, 'key' | 'thumb' | 'display' | 'original' | 'src'> & { url: string, original?: string | null }} m */
  const add = ({ url, original, ...m }) => {
    if (!url) return;
    const s = sizes(original || url);
    // A host with one size only: keep the URL the source gave for the stage (lighter), the original for the zoom.
    const one = s.thumb === s.original;
    const key = imageKey(s.original);
    if (seen.has(key)) return;
    seen.add(key);
    // Commons does not enlarge: an original narrower than the display width is the display.
    const small = m.width && m.width <= 1280;
    // `src`: the URL the source gave, which works (the fallback when a derived size does not exist).
    items.push({ ...m, key, thumb: one ? url : s.thumb, display: one ? url : small ? s.original : s.display, original: s.original, src: url });
  };
  const t = plant.thumbnail;
  if (t?.url) add({ kind: 'photo', url: t.url, source: t.source || 'Wikimedia Commons', author: t.author, license: t.license, sourceUrl: t.sourceUrl });
  for (const c of details?.commons || []) {
    add({ kind: 'photo', url: c.url, source: 'Wikimedia Commons', author: c.author, license: c.license, licenseUrl: c.licenseUrl,
      pageUrl: c.pageUrl, title: (c.title || '').replace(/^File:|\.\w+$/g, ''), width: c.width, height: c.height });
  }
  const taxon = details?.identifiers?.inaturalist;
  for (const p of inat || []) {
    add({ kind: 'photo', url: p.original || p.large || p.medium, source: 'iNaturalist', attribution: p.attribution, author: p.author,
      license: p.license, pageUrl: p.pageUrl, width: p.width, height: p.height });
  }
  if (taxon?.photo?.url) {
    add({ kind: 'photo', url: taxon.photo.url, source: 'iNaturalist', attribution: taxon.photo.attribution, license: taxon.photo.license,
      sourceUrl: 'https://www.inaturalist.org/taxa/' + taxon.id });
  }
  for (const [list, kind] of /** @type {const} */ ([[gbifPhotos, 'observation'], [herbarium, 'herbarium']])) {
    for (const g of list || []) {
      add({ kind, url: g.url, original: g.original, source: 'GBIF', author: g.author, license: g.license, licenseUrl: g.licenseUrl,
        sourceUrl: g.sourceUrl, institution: g.institution, catalogNumber: g.catalogNumber, year: g.year, country: g.country,
        locality: g.locality, coordinates: g.coordinates });
    }
  }
  return items;
}

/**
 * Loads the media of a plant (each part cached like the sheet's), calling `update` as parts arrive.
 * Modules off in that mode: their images are left out (no request).
 * @param {any} plant @param {Mode} mode @param {AbortSignal} signal @param {(items: MediaItem[], done: boolean) => void} update
 */
export async function loadMedia(plant, mode, signal, update) {
  if (!moduleOn('photos', mode)) { update([], true); return; }
  /** @type {any} */
  const data = {};
  const push = (/** @type {boolean} */ done) => { if (!signal.aborted) update(mediaOf(plant, data), done); };
  push(false);
  data.details = await sources.details(plant, signal, mode).catch(() => null);
  push(false);
  const gbifKey = data.details?.identifiers?.gbif?.id;
  const taxon = data.details?.identifiers?.inaturalist?.id;
  await Promise.all([
    sources.inaturalistPhotos(plant, taxon, signal, mode).then(x => { data.inat = x; push(false); }, () => {}),
    sources.gbifMedia(plant, gbifKey, 'photos', signal, mode).then(x => { data.gbifPhotos = x; push(false); }, () => {}),
    sources.gbifMedia(plant, gbifKey, 'herbarium', signal, mode).then(x => { data.herbarium = x; push(false); }, () => {})
  ]);
  push(true);
}
