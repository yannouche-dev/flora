// Builds the app's PNG icons from assets/icons/icon.svg (the GeoFlora pin): the ones the manifest, the home screen
// and Android's launch screen (splash) use. Rendered by the Chromium of Playwright (a dev dependency): no new package.
//   node scripts/make-app-icons.mjs            writes the files below into assets/icons/
//   node scripts/make-app-icons.mjs <folder>   writes them there instead (to look at them first)
// Then commit the PNGs. An installed app (Android WebAPK) keeps the icons it was installed with until their URL or
// content changes: give new names when the logo changes (and update manifest.webmanifest, index.html, sw.js SHELL).
//  - geoflora-192/512.png: « any » — the pin alone, on a transparent background, its height 80 % of the square.
//    Chrome draws it centred on the manifest's background_color for the Android launch screen.
//  - geoflora-maskable-192/512.png: « maskable » — the pin in white on the app's green, inside the safe zone (the
//    centred circle of 80 % of the side that every launcher mask keeps: circle, squircle, rounded square).
//  - apple-touch-icon-180.png: iOS home screen — opaque (iOS fills transparency with black), the same look as the
//    maskable icon, a little larger (iOS only rounds the corners).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, 'assets/icons');
const SVG = readFileSync(join(ROOT, 'assets/icons/icon.svg'), 'utf8');
const GREEN = '#2f6b3a'; // theme_color, --gf-accent
const WHITE_SVG = SVG.replace(/fill="#389746"/, 'fill="#ffffff"');

/** @type {{ name: string, size: number, svg: string, background: string, height: number }[]} */
const ICONS = [
  { name: 'geoflora-192.png', size: 192, svg: SVG, background: 'transparent', height: 0.8 },
  { name: 'geoflora-512.png', size: 512, svg: SVG, background: 'transparent', height: 0.8 },
  // The pin's bounding box (305 × 384 of its 384 × 385 viewBox), 0.56 of the side high: its round head and point stay
  // within the safe circle (radius 0.4).
  { name: 'geoflora-maskable-192.png', size: 192, svg: WHITE_SVG, background: GREEN, height: 0.56 },
  { name: 'geoflora-maskable-512.png', size: 512, svg: WHITE_SVG, background: GREEN, height: 0.56 },
  { name: 'apple-touch-icon-180.png', size: 180, svg: WHITE_SVG, background: GREEN, height: 0.66 }
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { name, size, svg, background, height } of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    // The viewBox is (almost) square: the image's box is the drawing's, the pin centred in it.
    const box = Math.round(size * height);
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};
      display:grid;place-items:center;overflow:hidden}img{width:${box}px;height:${box}px;display:block}</style><img src="${src}" alt="">`);
    await page.locator('img').evaluate(img => /** @type {HTMLImageElement} */ (img).decode());
    await page.screenshot({ path: join(OUT, name), omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`${join(OUT, name)}: ${size} × ${size}`);
  }
} finally {
  await browser.close();
}
