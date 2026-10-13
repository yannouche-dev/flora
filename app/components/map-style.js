// @ts-check
// The look of the app's maps, whatever draws them (components/gf-map.js with Leaflet; a MapLibre renderer later): one
// style for every map — the observations' markers (a leaf, or the plant's photo over its leaf; the plant chosen
// large in its pink and gold ring; many of them as one disc with their count), the small card of a point (its photo
// and credit, its names, when and where), the kin of a point (its species), the states a page lights (the card on
// top, the matches, the plants passed), and the circle still on the screen of the games' step « map » (its place
// and size, its SVG). Data in, descriptors and DOM out: a renderer wraps a MarkerSpec in its own marker (Leaflet's
// divIcon) and places the ring's SVG over its map; the CSS is styles/map.css. No renderer imported here.
// Photos: each one through fadeImg (shown once loaded, over the leaf; gone if it fails, the leaf stays; none with the
// « Photos en ligne » module off; asked once more before that), and a marker taken away calls cancelImages (its photo
// stops loading: the next ones are not queued behind it on the few connections a host gets) — never a marker kept.

import { iconMarkup } from '../core/icons.js';
import { moduleOn } from '../core/modules.js';
import { creditText } from '../core/credit.js';

/**
 * A marker as any renderer draws it: its element, its classes, its size (px; anchored at its middle).
 * @typedef {{ className: string, size: [number, number], html: HTMLElement }} MarkerSpec
 * @typedef {{ top?: number | null, matched?: number[], passed?: number[] }} Marks   the taxa lit (iNaturalist's)
 * @typedef {{ x: number, y: number, r: number }} Ring   a circle on the screen (px from the map's top left corner)
 */

/** An element, its text set as text (never HTML). @param {string} tag @param {string} [className] @param {string} [text] */
export function elem(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The wait before a photo that failed is asked once more (ms). */
const RETRY_MS = 1500;

/**
 * An image that leaves when it fails (offline, gone) — after one more try a moment later (a busy host, an answer
 * cut short): a listener, not an inline `onerror`, which the CSP of index.html forbids. Its address is kept
 * (data-src): a photo stopped by cancelImages can be asked again (resumeImages). `loading` is set before `src`.
 * @param {string} src @param {{ loading?: 'lazy' | 'eager', decoding?: 'async' | 'sync' | 'auto' }} [props]
 */
export function dropImg(src, props = {}) {
  const img = Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer', ...props });
  img.dataset.src = src;
  let tried = false;
  img.addEventListener('error', () => {
    // No address: stopped on purpose (cancelImages), not a failure.
    if (!img.getAttribute('src')) return;
    if (tried) { img.remove(); return; }
    tried = true;
    setTimeout(() => { if (img.getAttribute('src')) { img.removeAttribute('src'); img.src = src; } }, RETRY_MS);
  });
  img.src = src;
  return img;
}

/**
 * A badge's photo: shown once it has loaded (a fade), over the leaf; gone if it fails (the leaf stays). Every plant
 * photo of the map comes through here: with the « Photos en ligne » module off, none is loaded (the leaf stays).
 * Shown whichever way it comes: its load event, already there (cached), or once decoded (an image attached again).
 * @param {string} src @param {{ loading?: 'lazy' | 'eager', decoding?: 'async' | 'sync' | 'auto' }} [props]
 * @returns {Node}
 */
export function fadeImg(src, props = {}) {
  if (!moduleOn('photos')) return document.createTextNode('');
  const img = dropImg(src, props);
  img.classList.add('gf-fade');
  const show = () => { if (img.complete && img.naturalWidth) img.classList.add('in'); };
  // Already there (cached): no fade, at once.
  show();
  img.addEventListener('load', () => img.classList.add('in'));
  img.decode?.().then(show, () => {});
  return img;
}

/**
 * The photos still loading under `el` stop: a marker taken away keeps its request in the browser's queue otherwise
 * (a few at a time per host), and the photos of the points shown next wait behind those of points no longer there.
 * Only for a marker really taken away: one kept never stays without its photo (resumeImages). The service worker's own
 * request is not stopped with the image's: it is told (sw.js), and puts these photos after the others — unless
 * another image of the map still shows the same one.
 * @param {Element} el
 */
export function cancelImages(el) {
  /** @type {string[]} */
  const dropped = [];
  for (const img of el.querySelectorAll('img')) {
    if (img.complete) continue;
    const src = img.getAttribute('src');
    img.removeAttribute('src');
    if (src) dropped.push(src);
  }
  if (!dropped.length) return;
  const root = el.getRootNode();
  const used = new Set([.../** @type {Document | ShadowRoot} */ (root).querySelectorAll?.('img[src]') || []].map(i => i.getAttribute('src')));
  const urls = dropped.filter(u => !used.has(u));
  if (urls.length) globalThis.navigator?.serviceWorker?.controller?.postMessage({ type: 'photos-dropped', urls: urls.map(u => new URL(u, location.href).href) });
}

/** The photos under `el` that were stopped (cancelImages) asked again. @param {Element} el */
export function resumeImages(el) {
  for (const img of el.querySelectorAll('img')) {
    if (img instanceof HTMLImageElement && !img.getAttribute('src') && img.dataset.src) img.src = img.dataset.src;
  }
}

/** The leaf a plant's badge shows until its photo has loaded (and for good without one). */
export function leafGlyph() {
  const glyph = elem('span', 'glyph');
  // eslint-disable-next-line no-unsanitized/property -- the markup of a bundled icon, no data in it
  glyph.innerHTML = iconMarkup('leaf-fill');
  return glyph;
}

/** An observation without a photo: a small leaf in a disc, popping in after `delay` ms. @param {number} delay @returns {MarkerSpec} */
export function leafMarker(delay) {
  const pop = elem('span', 'pop');
  pop.style.animationDelay = delay + 'ms';
  // eslint-disable-next-line no-unsanitized/property -- the markup of a bundled icon, no data in it
  pop.innerHTML = iconMarkup('leaf-fill');
  return { className: 'gf-obs-leaf', size: [22, 22], html: pop };
}

/**
 * An observation with its photo: popping in after `delay` ms, its leaf first, then the plant's thumbnail in a ring
 * once it has loaded. @param {string} photo @param {number} delay @returns {MarkerSpec}
 */
export function photoMarker(photo, delay) {
  const pop = elem('span', 'pop');
  pop.style.animationDelay = delay + 'ms';
  // Not lazy: a small square; a lazy image in a marker pane (moved, scaled from 0, a map shown later) may wait for good.
  pop.append(leafGlyph(), fadeImg(photo, { decoding: 'async' }));
  return { className: 'gf-obs-leaf gf-obs-photo', size: [30, 30], html: pop };
}

/**
 * The plant chosen (Découvrir's plant in view, the species picked « Autour », a value touched in a plant's sheet, the
 * plant whose photos a game shows): its photo, large, in a pink and gold ring, bouncing in after `delay` ms with a
 * ripple as it lands. Its leaf shows under the photo until it comes, and stays when there is none (or it fails).
 * @param {string | null | undefined} photo @param {number} delay @param {number} [size] @param {string} [extra] more classes
 * @returns {MarkerSpec}
 */
export function chosenMarker(photo, delay, size = 44, extra = '') {
  const pop = elem('span', 'pop');
  pop.style.setProperty('--d', delay + 'ms');
  pop.append(leafGlyph());
  if (photo) pop.append(fadeImg(photo, { decoding: 'async' }));
  return { className: `gf-obs-leaf hl chosen ${extra}`.trim(), size: [size, size], html: pop };
}

/**
 * Many observations of the plant chosen, together (a wider scope): its photo in a disc sized by their number, the
 * count on a badge. `still`: drawn again at another zoom, no entrance.
 * @param {string} photo @param {number} n @param {number} size @param {boolean} [still] @returns {MarkerSpec}
 */
export function chosenGroupMarker(photo, n, size, still = false) {
  const g = elem('span', 'g');
  const ph = elem('span', 'ph');
  ph.append(leafGlyph(), fadeImg(photo, { decoding: 'async' }));
  g.append(ph, elem('b', 'n', n > 999 ? Math.round(n / 1000) + 'k' : String(n)));
  return { className: 'gf-occ-group gf-occ-group-hl photo' + (still ? ' still' : ''), size: [size, size], html: g };
}

/**
 * Which plant a point is, to light its kin (the other points of the same species): its binomial first — the same
 * key whatever the source (iNaturalist, GBIF, the plants of places) —, else its taxon.
 * @param {any} p @returns {string | null}
 */
export const speciesKey = p => {
  const binomial = String(p?.sci || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  return binomial ? 's:' + binomial : p?.taxonId != null ? 't:' + p.taxonId : null;
};

/**
 * The small plant card shown over an observation: its photo and its credit (author, licence, source — as text), its
 * names, when and where. Built as nodes, the texts as text: names and places come from iNaturalist / GBIF, never
 * parsed as HTML. No link: a point's card leads nowhere (the mini-apps lead nowhere outside).
 * @param {{ title: string, common?: string | null, sci?: string, photo?: string | null, credit?: import('../core/credit.js').Credit | null,
 *   date?: string | null, place?: string | null }} p
 */
export function obsCard(p) {
  const big = p.photo ? p.photo.replace('/square.', '/small.') : null;
  const when = p.date ? new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const card = elem('div', 'gf-obs-card'), t = elem('div', 't');
  if (big) card.append(fadeImg(big));
  t.append(elem('b', '', p.common || p.sci || p.title));
  if (p.common && p.sci) t.append(elem('i', '', p.sci));
  if (when || p.place) t.append(elem('small', '', [when, p.place].filter(Boolean).join(' · ')));
  if (big && p.credit && moduleOn('photos')) t.append(elem('small', 'credit', 'Photo : ' + creditText(p.credit)));
  card.append(t);
  return card;
}

/**
 * The classes a point takes for what a page lights (by its iNaturalist taxon): the card on top (gf-top), a match
 * (gf-matched), a plant passed (gf-passed). @param {{ taxonId?: number | null } | undefined} point @param {Marks} marks
 * @returns {Record<string, boolean>}
 */
export function markClasses(point, marks) {
  const t = point?.taxonId;
  return {
    'gf-top': t != null && t === marks.top,
    'gf-matched': t != null && Boolean(marks.matched?.includes(t)),
    'gf-passed': t != null && Boolean(marks.passed?.includes(t))
  };
}

/**
 * Where the circle of the games' step « map » stands in a map `width` × `height` px, a card over the map's bottom
 * whose top is `top` px from the map's top: in the middle of the width, its centre a fifth of the height above the
 * card (a quarter of the height from the top at least), its radius 54 % of the height (42 % of the width at most).
 * `chip`: a chip instead of the card (the step « cards »): in the middle of the room above it, as large as it fits.
 * @param {{ width: number, height: number, top: number, chip?: boolean }} box @returns {Ring}
 */
export function ringAt({ width, height, top, chip = false }) {
  const x = Math.round(width / 2);
  if (chip) return { x, y: Math.round(top / 2), r: Math.round(Math.max(24, Math.min(0.44 * top, 0.42 * width))) };
  return { x, y: Math.round(Math.max(0.25 * height, top - 0.2 * height)), r: Math.round(Math.min(0.54 * height, 0.42 * width)) };
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The circle still on the screen: an SVG of its own (its shadow under it, the circle's classes: gf-area gf-area-glow),
 * placed at `ring` (px of the map's box). `svg`: the one drawn before, moved. @param {Ring} ring @param {SVGSVGElement | null} [svg]
 * @returns {SVGSVGElement}
 */
export function ringElement(ring, svg = null) {
  const pad = 8, size = 2 * (ring.r + pad);
  if (!svg) {
    svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, 'svg'));
    svg.setAttribute('class', 'gf-ring');
    svg.setAttribute('aria-hidden', 'true');
    for (const cls of ['gf-perim-shadow', 'gf-area gf-area-glow']) {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('class', cls);
      svg.append(c);
    }
  }
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.cssText = `position:absolute;overflow:visible;left:${ring.x - ring.r - pad}px;top:${ring.y - ring.r - pad}px`;
  for (const c of svg.querySelectorAll('circle')) {
    c.setAttribute('cx', String(ring.r + pad));
    c.setAttribute('cy', String(ring.r + pad));
    c.setAttribute('r', String(ring.r));
  }
  return svg;
}
