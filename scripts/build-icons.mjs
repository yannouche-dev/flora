// Builds assets/icons/bi.svg: the Bootstrap Icons the app uses, as one SVG sprite (<symbol id="name">).
// Usage: npm pack bootstrap-icons@1.13.2 && tar xzf bootstrap-icons-1.13.2.tgz
//        node scripts/build-icons.mjs package
// Add an icon: put its name in NAMES (see https://icons.getbootstrap.com), run the script, commit the sprite.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = [
  'arrow-counterclockwise', 'arrow-left', 'arrow-right', 'arrows-angle-expand', 'arrows-collapse', 'caret-down-fill', 'caret-up-fill',
  'check-lg', 'chevron-bar-left', 'chevron-bar-right', 'chevron-down', 'chevron-up', 'download', 'chevron-left', 'chevron-right', 'collection', 'collection-fill', 'crosshair', 'diagram-3', 'exclamation-octagon-fill', 'exclamation-triangle-fill', 'flower1',
  'eye-slash', 'funnel', 'funnel-fill', 'gear', 'gear-fill', 'geo-alt-fill', 'globe-europe-africa', 'grip-vertical', 'heart', 'heart-fill', 'image', 'layers',
  'leaf', 'leaf-fill', 'list-nested', 'list-ul', 'map', 'map-fill', 'mic', 'mic-fill', 'pencil', 'pin-angle', 'pin-angle-fill', 'plus-lg', 'search', 'share', 'shield-check', 'star', 'star-fill', 'table',
  'three-dots', 'trash3', 'triangle', 'type-h2', 'upload', 'x', 'x-lg',
  'arrows-fullscreen', 'box-arrow-up-right', 'fullscreen-exit', 'images', 'zoom-in', 'tree', 'flower3'
];

// Drawn for the app, in the same 16 × 16 grid, where Bootstrap Icons has none.
const EXTRA = {
  // « Mode King » (no crown in Bootstrap Icons 1.13).
  crown: '<path d="M1 4.5 4.6 7.6 8 2l3.4 5.6L15 4.5 13.6 12H2.4zM2.4 13h11.2v1.5H2.4z"/>',
  // Plant parts (Médias): a cluster of berries on a stem, and a piece of bark.
  fruit: '<path d="M8 1c.3 1.4 1.3 2.4 3 2.7-.9.5-2 .5-3-.1V5.5h-1V1z"/><circle cx="5" cy="8.5" r="2.6"/><circle cx="10.6" cy="8.2" r="2.6"/><circle cx="7.8" cy="12.4" r="2.6"/>',
  bark: '<path d="M4 1h8l-.6 14H4.6zM6 3.2c.4 1.6.2 3.4-.4 5 .9 1.5 1 3.1.6 4.8h1c.4-1.8.3-3.5-.6-5 .6-1.6.8-3.2.4-4.8zm3.2 0c-.5 2 .1 3.5.7 5.1-.5 1.4-.6 3-.2 4.7h1c-.4-1.6-.3-3.1.2-4.6-.6-1.7-1.1-3.2-.7-5.2z"/>'
};

const pkg = process.argv[2] || 'node_modules/bootstrap-icons';
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const symbols = NAMES.map(name => {
  const svg = readFileSync(join(pkg, 'icons', name + '.svg'), 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim().replace(/\s*\n\s*/g, '');
  return `<symbol id="${name}" viewBox="0 0 16 16">${body}</symbol>`;
}).concat(Object.entries(EXTRA).map(([name, body]) => `<symbol id="${name}" viewBox="0 0 16 16" fill="currentColor">${body}</symbol>`));
writeFileSync('assets/icons/bi.svg', `<svg xmlns="http://www.w3.org/2000/svg">
<!-- Bootstrap Icons v${version} (https://icons.getbootstrap.com), © The Bootstrap Authors, MIT License. Built by scripts/build-icons.mjs. -->
${symbols.join('\n')}
</svg>
`);
console.log(`assets/icons/bi.svg: ${symbols.length} icons (Bootstrap Icons ${version})`);
