// @ts-check
// The scenarios' pictures, made of the app's own icons: round coloured stickers (an icon on a disc, a darker
// disc offset beneath), loose icons around, a ground — flat and stylized, a little funky. Each sticker pops up
// in turn, then floats; the Parcours draws its dotted path. Still with prefers-reduced-motion.
// Usage: ${scene('trail')} in a component that includes `sceneStyles` in its styles.

import { html, svg, css } from 'lit';
import { iconHref } from './icons.js';

/** @typedef {import('./icons.js').IconName} IconName */

/**
 * A sticker: `name` on a disc of colour `bg` (icon colour `fg`), radius `r`, popping up after `d` seconds.
 * @param {number} x @param {number} y @param {IconName} name @param {string} bg @param {number} [r] @param {number} [d] @param {string} [fg] @param {number} [tilt]
 */
const sticker = (x, y, name, bg, r = 16, d = 0, fg = '#fff', tilt = 0) => svg`<g transform="translate(${x} ${y}) rotate(${tilt})">
  <g class="pop" style="--d:${d}s"><g class="float" style="--f:${(x * 7 + y * 3) % 5 / 10 + 2.6}s">
    <circle cx="2.2" cy="2.6" r=${r} fill="var(--shade)"/>
    <circle r=${r} fill=${bg} stroke="var(--rim)" stroke-width="2.2"/>
    <use href=${iconHref(name)} x=${-r * 0.56} y=${-r * 0.56} width=${r * 1.12} height=${r * 1.12} fill=${fg}/>
  </g></g></g>`;

/** A loose icon (no disc). @param {number} x @param {number} y @param {IconName} name @param {string} color @param {number} [size] @param {number} [d] @param {number} [tilt] @param {string} [cls] */
const loose = (x, y, name, color, size = 18, d = 0, tilt = 0, cls = 'float') => svg`<g transform="translate(${x} ${y}) rotate(${tilt})">
  <g class="pop" style="--d:${d}s"><g class=${cls} style="--f:3.4s">
    <use href=${iconHref(name)} x=${-size / 2} y=${-size / 2} width=${size} height=${size} fill=${color}/>
  </g></g></g>`;

const ground = svg`<path d="M0 156 Q 70 128 150 142 T 320 132 L 320 190 L 0 190 Z" fill="var(--ground)"/>`;

const TRAIL = 'M30 150 C 86 152 64 100 124 100 S 188 146 228 112 S 266 56 290 44';

/** The Parcours botanique: a dotted walk from a pin to a flag, flowers and leaves along it — plants only (a leaf in the wind, no animal). */
const trail = () => svg`
  <defs><mask id="scene-walk" maskUnits="userSpaceOnUse" x="0" y="-10" width="320" height="200">
    <path class="walk" pathLength="1" d=${TRAIL} fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/></mask></defs>
  ${ground}
  ${loose(46, 34, 'sun-fill', 'var(--sun)', 30, 0.1, 0, 'spin')}
  ${loose(244, 30, 'cloud-fill', 'var(--cloud)', 34, 0.2)}
  <path class="dots" mask="url(#scene-walk)" d=${TRAIL}/>
  ${sticker(30, 140, 'geo-alt-fill', 'var(--green)', 15, 0)}
  ${sticker(74, 120, 'flower1', 'var(--pink)', 15, 0.3, '#fff', -8)}
  ${sticker(124, 82, 'leaf-fill', 'var(--leaf)', 14, 0.5, '#fff', 10)}
  ${sticker(166, 138, 'flower3', 'var(--sun)', 15, 0.7, 'var(--ink-dark)', -6)}
  ${sticker(212, 92, 'tree-fill', 'var(--green)', 15, 0.9, '#fff', 4)}
  ${sticker(252, 142, 'flower2', 'var(--violet)', 14, 1.1, '#fff', 8)}
  ${sticker(290, 34, 'flag-fill', 'var(--sun)', 16, 1.35, 'var(--ink-dark)', -4)}
  ${loose(100, 164, 'leaf', 'var(--leaf)', 16, 0.4, -20)}
  ${loose(196, 170, 'leaf-fill', 'var(--leaf2)', 14, 0.8, 30)}
  ${loose(150, 40, 'leaf-fill', 'var(--leaf2)', 17, 1.2, 25, 'fly')}`;

/** Rencontres: a fan of plant cards, a heart for a match, binoculars to look around. */
const meet = () => svg`
  ${ground}
  ${loose(56, 40, 'stars', 'var(--sun)', 22, 1.2)}
  <g transform="translate(160 100)">
    ${[[-22, -16, 'var(--leaf2)', 0.1], [0, 0, 'var(--violet)', 0.25], [22, 16, 'var(--pink)', 0.4]].map(([rot, dx, c, d]) => svg`
      <g transform="rotate(${rot}) translate(${dx} 0)"><g class="pop" style="--d:${d}s">
        <rect x="-34" y="-50" width="68" height="92" rx="12" fill="var(--shade)" transform="translate(2.5 3)"/>
        <rect x="-34" y="-50" width="68" height="92" rx="12" fill="var(--card)" stroke="var(--rim)" stroke-width="2.2"/>
        <rect x="-26" y="-42" width="52" height="54" rx="8" fill=${c}/>
        <use href=${iconHref('flower1')} x="-14" y="-30" width="28" height="28" fill="#fff"/>
        <rect x="-26" y="18" width="40" height="6" rx="3" fill="var(--line)"/><rect x="-26" y="28" width="26" height="5" rx="2.5" fill="var(--line)"/>
      </g></g>`)}
  </g>
  ${sticker(226, 52, 'heart-fill', 'var(--red)', 18, 0.65, '#fff', 8)}
  ${sticker(84, 126, 'binoculars-fill', 'var(--green)', 17, 0.55, '#fff', -8)}
  ${loose(262, 138, 'flower3', 'var(--sun)', 20, 0.9, 10)}
  ${loose(40, 150, 'leaf-fill', 'var(--leaf)', 16, 0.8, -25)}`;

/** Cueillette prudente: a basket among what is picked, and the shield of caution. */
const harvest = () => svg`
  ${ground}
  ${sticker(160, 104, 'basket2-fill', 'var(--green)', 30, 0.1)}
  ${sticker(96, 70, 'leaf-fill', 'var(--leaf)', 15, 0.35, '#fff', -12)}
  ${sticker(124, 36, 'flower1', 'var(--pink)', 13, 0.5, '#fff', 8)}
  ${sticker(204, 40, 'fruit', 'var(--red)', 14, 0.65, '#fff', -6)}
  ${sticker(232, 78, 'flower3', 'var(--sun)', 14, 0.8, 'var(--ink-dark)', 6)}
  ${sticker(254, 140, 'shield-check', 'var(--blue)', 17, 1.0, '#fff', 6)}
  ${loose(276, 112, 'exclamation-triangle-fill', 'var(--amber)', 16, 1.2, 8)}
  ${loose(62, 142, 'leaf', 'var(--leaf)', 18, 0.6, -20)}
  ${loose(48, 40, 'sun-fill', 'var(--sun)', 26, 0.2, 0, 'spin')}`;

/** Mosaïque: tiles of photos, flowers and leaves, set slightly askew. */
const mosaic = () => {
  /** @type {[IconName, string, string][]} */
  const tiles = [['flower1', 'var(--pink)', '#fff'], ['leaf-fill', 'var(--leaf)', '#fff'], ['images', 'var(--green)', '#fff'],
    ['flower3', 'var(--sun)', 'var(--ink-dark)'], ['tree-fill', 'var(--leaf2)', '#fff'], ['flower2', 'var(--violet)', '#fff'],
    ['image', 'var(--blue)', '#fff'], ['flower1', 'var(--red)', '#fff'], ['leaf', 'var(--green)', '#fff']];
  return svg`${ground}${tiles.map(([name, bg, fg], i) => {
    const x = 104 + (i % 3) * 56, y = 22 + Math.floor(i / 3) * 52, tilt = [-5, 3, -2, 4, -4, 2, 3, -3, 5][i];
    return svg`<g transform="translate(${x} ${y}) rotate(${tilt})"><g class="pop" style="--d:${0.08 * i + 0.1}s"><g class="float" style="--f:${2.6 + (i % 4) / 5}s">
      <rect x="-22" y="-20" width="48" height="44" rx="9" fill="var(--shade)" transform="translate(2.5 3)"/>
      <rect x="-22" y="-20" width="48" height="44" rx="9" fill=${bg} stroke="var(--rim)" stroke-width="2.2"/>
      <use href=${iconHref(name)} x="-9" y="-9" width="22" height="22" fill=${fg}/></g></g></g>`;
  })}`;
};

const SCENES = { trail, meet, harvest, mosaic };
const LABELS = { trail: 'Un chemin parmi les fleurs', meet: 'Des cartes de plantes et un cœur', harvest: 'Un panier et ce qui se cueille', mosaic: 'Une mosaïque de photos de plantes' };

/** The picture of a scenario (Rencontres for one without its own). @param {string} kind */
export const scene = kind => {
  const key = /** @type {keyof typeof SCENES} */ (kind in SCENES ? kind : 'meet');
  return html`<svg class="scene" viewBox="0 0 320 190" role="img" aria-label=${LABELS[key]}>${SCENES[key]()}</svg>`;
};

/** Styles for `scene()`, to include in the component's styles. */
export const sceneStyles = css`
  .scene { display: block; justify-self: center; margin: 0 auto; width: min(380px, 100%); height: auto; overflow: visible;
    --green: var(--gf-accent, #2f6b3a); --leaf: #4f9a5c; --leaf2: #7cc36b; --sun: #f5c518; --red: #e4572e; --pink: #e86fa4; --violet: #8e6cc8;
    --blue: #3b82c4; --amber: #e8a317; --cloud: color-mix(in srgb, var(--gf-text, #1f2a1f) 14%, transparent); --card: var(--gf-surface, #fff); --line: var(--gf-border, #dfe6da);
    --ground: var(--gf-accent-soft, #e2eedf); --rim: var(--gf-surface, #fff); --shade: color-mix(in srgb, var(--gf-text, #1f2a1f) 22%, transparent);
    --ink-dark: #1f2a1f; }
  .scene .dots { fill: none; stroke: var(--green); stroke-width: 3.4; stroke-linecap: round; stroke-dasharray: 0.1 9; }
  .scene .pop { transform-box: fill-box; transform-origin: 50% 50%; animation: scene-pop 0.55s cubic-bezier(0.3, 1.7, 0.5, 1) both; animation-delay: var(--d, 0s); }
  .scene .float { transform-box: fill-box; transform-origin: 50% 50%; animation: scene-float var(--f, 3s) ease-in-out 0.8s infinite; }
  .scene .spin { transform-box: fill-box; transform-origin: 50% 50%; animation: scene-spin 24s linear infinite; }
  .scene .fly { transform-box: fill-box; animation: scene-fly 5s ease-in-out infinite; }
  .scene .walk { stroke-dasharray: 1; stroke-dashoffset: 1; animation: scene-walk 1.6s ease-out 0.1s forwards; }
  @keyframes scene-pop { from { transform: scale(0); } }
  @keyframes scene-float { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-4px) rotate(2deg); } }
  @keyframes scene-spin { to { transform: rotate(360deg); } }
  @keyframes scene-fly { 0%, 100% { transform: translate(0, 0) rotate(0); } 30% { transform: translate(14px, -8px) rotate(14deg); } 60% { transform: translate(28px, 4px) rotate(-8deg); } }
  @keyframes scene-walk { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .scene .pop, .scene .float, .scene .spin, .scene .fly { animation: none; }
    .scene .walk { animation: none; stroke-dashoffset: 0; }
  }
`;
