// Builds assets/icons/bi.svg: the Bootstrap Icons the app uses, as one SVG sprite (<symbol id="name">).
// Usage: npm pack bootstrap-icons@1.13.2 && tar xzf bootstrap-icons-1.13.2.tgz
//        node scripts/build-icons.mjs package
// Add an icon: put its name in NAMES (see https://icons.getbootstrap.com), run the script, commit the sprite.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = [
  'arrow-counterclockwise', 'arrow-left', 'arrow-right', 'arrows-angle-expand', 'arrows-collapse', 'caret-down-fill', 'caret-up-fill',
  'check-lg', 'chevron-down', 'download', 'chevron-left', 'chevron-right', 'crosshair', 'exclamation-octagon-fill', 'exclamation-triangle-fill', 'flower1',
  'funnel', 'funnel-fill', 'gear', 'geo-alt-fill', 'globe-europe-africa', 'grip-vertical', 'heart', 'heart-fill', 'image', 'layers',
  'list-nested', 'list-ul', 'map', 'mic', 'mic-fill', 'pencil', 'plus-lg', 'search', 'share', 'shield-check', 'star', 'star-fill', 'table',
  'three-dots', 'trash3', 'triangle', 'upload', 'x', 'x-lg'
];

// Drawn for the app, in the same 16 × 16 grid, where Bootstrap Icons has none.
const EXTRA = {
  // « Mode King » (no crown in Bootstrap Icons 1.13).
  crown: '<path d="M1 4.5 4.6 7.6 8 2l3.4 5.6L15 4.5 13.6 12H2.4zM2.4 13h11.2v1.5H2.4z"/>'
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
