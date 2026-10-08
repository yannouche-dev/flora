// Builds assets/icons/bi.svg: the Bootstrap Icons the app uses, as one SVG sprite (<symbol id="name">).
// Usage: npm pack bootstrap-icons@1.13.2 && tar xzf bootstrap-icons-1.13.2.tgz
//        node scripts/build-icons.mjs package
// Add an icon: put its name in NAMES (see https://icons.getbootstrap.com), run the script, commit the sprite.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = [
  'arrow-counterclockwise', 'arrow-left', 'arrow-right', 'arrows-angle-expand', 'arrows-collapse', 'caret-down-fill', 'caret-up-fill',
  'check-lg', 'chevron-down', 'chevron-left', 'chevron-right', 'crosshair', 'exclamation-octagon-fill', 'exclamation-triangle-fill', 'flower1',
  'funnel', 'funnel-fill', 'gear', 'geo-alt-fill', 'globe-europe-africa', 'heart', 'heart-fill', 'image', 'layers',
  'list-ul', 'map', 'mic', 'mic-fill', 'pencil', 'plus-lg', 'search', 'share', 'shield-check', 'star', 'star-fill', 'table',
  'three-dots', 'triangle', 'x', 'x-lg'
];

const pkg = process.argv[2] || 'node_modules/bootstrap-icons';
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const symbols = NAMES.map(name => {
  const svg = readFileSync(join(pkg, 'icons', name + '.svg'), 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim().replace(/\s*\n\s*/g, '');
  return `<symbol id="${name}" viewBox="0 0 16 16">${body}</symbol>`;
});
writeFileSync('assets/icons/bi.svg', `<svg xmlns="http://www.w3.org/2000/svg">
<!-- Bootstrap Icons v${version} (https://icons.getbootstrap.com), © The Bootstrap Authors, MIT License. Built by scripts/build-icons.mjs. -->
${symbols.join('\n')}
</svg>
`);
console.log(`assets/icons/bi.svg: ${symbols.length} icons (Bootstrap Icons ${version})`);
