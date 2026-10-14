// « Disposition libre » : the controls drawn over a map cell (ctl=, map-options.js MAP_CONTROLS; cells.js dl-map), each
// in its fixed place. The radius' handle on the circle (gf-map radiusHandle): dragged — by a mouse, by a finger — the
// circle follows, the distance in a bubble, snapped to the slider's stops near it, the map never panned; let go, the
// zone's radius changed as the slider changes it (r= in the address); its keys from stop to stop. The current plant's
// chip: ✕ (none), « Seule » (its points alone, this map only), ↗ (its sheet). The period's chips (when=, written in
// the layout). The count (the points shown, the plants found), which opens the map's « État ». The other background's
// thumbnail. ctl= as the exact set, the defaults by ui and the intent, none (nue). iNaturalist answered here: 12
// plants around, 24 observations of three dates (this month, another month of this year, this month two years ago).
import { test, expect, answerAround, plantId } from './fixtures.mjs';
import { centre } from './touch.mjs';
import { overMap } from './quiet.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix',
  'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const AT = 'at=48.85,2.35';
const now = new Date();
const THIS_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
const OTHER_MONTH = `${now.getFullYear()}-${String(((now.getMonth() + 6) % 12) + 1).padStart(2, '0')}-02`;
const OLD_SAME_MONTH = `${now.getFullYear() - 2}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
/** Observation i's date. @param {number} i */
const dateOf = i => [THIS_MONTH, OTHER_MONTH, OLD_SAME_MONTH][i % 3];

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: NAMES.map((name, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name, preferred_common_name: null } })) }) }));
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const taxon = Number(new URL(route.request().url()).searchParams.get('taxon_id')) || 0;
    const n = taxon ? 3 : 24;
    const results = Array.from({ length: n }, (_, i) => ({
      id: (taxon || 7) * 100 + i, observed_on: dateOf(i),
      geojson: { coordinates: [2.35 + ((i % 6) - 2.5) * 0.0018 + (taxon ? 0.0005 : 0), 48.85 + (Math.floor(i / 6) - 1.5) * 0.0015] },
      taxon: { id: taxon || 1000 + (i % 12), name: taxon ? NAMES[taxon - 1000] : NAMES[i % 12], preferred_common_name: null }
    }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n, results }) });
  });
});

/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const layoutOf = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash.split('?')[0]));
const cell = (/** @type {Page} */ page) => page.locator('dl-map');
const mapOf = (/** @type {Page} */ page) => page.locator('dl-map gf-map');
const handle = (/** @type {Page} */ page) => page.locator('dl-map .gf-radius-handle');
/** The map's centre and its circle as drawn. @param {Page} page */
const view = page => mapOf(page).evaluate(m => { const g = /** @type {any} */ (m); return { center: g.center(), radius: g.area?.radius ?? null, points: g.area?.points?.length ?? null }; });
/** Where the zone's centre is on the page. @param {Page} page */
const centreOnPage = page => mapOf(page).evaluate(m => {
  const g = /** @type {any} */ (m), p = g.pointOf([2.35, 48.85]), box = g.querySelector('.leaflet-container').getBoundingClientRect();
  return { x: box.left + p.x, y: box.top + p.y };
});

/** Where an element rests, once it has stopped moving (the map framing the circle). @param {import('@playwright/test').Locator} locator */
async function still(locator) {
  let last = '';
  await expect.poll(async () => { const c = await centre(locator); const k = `${Math.round(c.x)},${Math.round(c.y)}`; const same = k === last; last = k; return same; },
    { intervals: [150, 150, 250] }).toBe(true);
  return centre(locator);
}

test.describe('au bureau', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen: every cell in sight');

  test('la poignée du cercle : glissée, le rayon suit (bulle), aimanté à 2 km, la carte jamais déplacée ; lâchée, r= dans l’adresse ; au clavier, de cran en cran', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km),plant]?${AT}`);
    await expect(handle(page)).toHaveAttribute('role', 'slider');
    await still(handle(page));
    await expect(handle(page)).toHaveAttribute('aria-valuetext', '1 km');
    const box = await handle(page).boundingBox();
    expect(box && box.width >= 32 && box.height >= 32, 'une cible d’au moins 32 px').toBe(true);
    const from = await centre(handle(page));
    const c = await centreOnPage(page);
    const before = await view(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Twice as far from the centre, a little off: 2 km (within a few % of the stop).
    const to = { x: c.x + (from.x - c.x) * 2.06, y: from.y + 6 };
    await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(handle(page).locator('.bubble')).toBeVisible();
    await expect(handle(page).locator('.bubble')).toHaveText('2 km');
    await expect(handle(page)).toHaveAttribute('aria-valuetext', '2 km');
    // Nothing asked yet, and the map not panned.
    expect(await param(page, 'r')).not.toBe('2km');
    const held = await view(page);
    expect(held.center[0]).toBeCloseTo(before.center[0], 6);
    expect(held.center[1]).toBeCloseTo(before.center[1], 6);
    await page.mouse.up();
    await expect.poll(() => param(page, 'r')).toBe('2km');
    await expect.poll(async () => (await view(page)).radius).toBe(2000);
    await expect(handle(page).locator('.bubble')).toBeHidden();
    // The slider of the zone says it too.
    await expect(cell(page).locator('.panel input[type="range"]')).toHaveAttribute('aria-valuetext', '2 km');
    // Keys: the next stop, the one before.
    await handle(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => param(page, 'r')).toBe('5km');
    await expect(handle(page)).toHaveAttribute('aria-valuetext', '5 km');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => param(page, 'r')).toBe('2km');
    // Not on a stop: dragged a little, the radius rounded (2,3 km) — once the map has framed the circle again.
    const at = await still(handle(page));
    const c2 = await centreOnPage(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(c2.x + (at.x - c2.x) * 1.15, at.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => param(page, 'r')).toBe('2.3km');
  });

  test('la plante courante : sa pastille, ↗ sa fiche, « Seule » ses seuls points, ✕ aucune', async ({ app, page }) => {
    const ortie = plantId('Urtica dioica');
    await app.open(`#/layout/[map(r=1km),results]?${AT}`);
    await expect.poll(async () => (await view(page)).points).toBe(24);
    await expect(cell(page).locator('.chip')).toHaveCount(0);
    // A plant chosen (a result): its chip.
    await app.go(`#/layout/[map(r=1km),results]?${AT}&p=${ortie}`);
    const chip = cell(page).locator('.chip');
    await expect(chip).toBeVisible();
    await expect(chip.getByRole('link', { name: /^Ouvrir la fiche : / })).toHaveAttribute('href', `#/plant/${ortie}`);
    // Quiet maps: its chip, the count, the zone are controls — nothing else written over the map.
    await expect.poll(() => overMap(page, ['.panel'])).toEqual([]);
    // Seule: its points alone (this map's view only: the address unchanged).
    const layout = await layoutOf(page);
    await chip.getByRole('button', { name: 'Seule' }).click();
    await expect(chip.getByRole('button', { name: 'Seule' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await view(page)).points).toBe(2);
    expect(await mapOf(page).evaluate(m => /** @type {any} */ (m).area.points.map((/** @type {any} */ p) => p.taxonId))).toEqual([1000, 1000]);
    expect(await layoutOf(page)).toBe(layout);
    await chip.getByRole('button', { name: 'Seule' }).click();
    await expect.poll(async () => (await view(page)).points).toBe(24);
    // ✕: no current plant.
    await chip.getByRole('button', { name: 'Aucune plante courante' }).click();
    await expect.poll(() => param(page, 'p')).toBe(null);
    await expect(cell(page).locator('.chip')).toHaveCount(0);
    // ↗: its sheet.
    await app.go(`#/layout/[map(r=1km),results]?${AT}&p=${ortie}`);
    await chip.getByRole('link', { name: /^Ouvrir la fiche : / }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${ortie}`);
  });

  test('la période : ses puces filtrent les points et s’écrivent dans la disposition (when=) ; le compteur, et l’État', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km;ctl=rayon+lieu+periode+compte),results]?${AT}`);
    await expect.poll(async () => (await view(page)).points).toBe(24);
    const period = cell(page).getByRole('group', { name: 'Période des observations' });
    await expect(period.getByRole('button', { name: 'Toujours' })).toHaveAttribute('aria-pressed', 'true');
    const count = cell(page).locator('button.count');
    await expect(count).toHaveText(/^24 observations · \d+ espèces$/);
    await period.getByRole('button', { name: 'Ce mois-ci' }).click();
    await expect.poll(async () => (await view(page)).points).toBe(16);
    await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(r=1km,when=mois,ctl=rayon+lieu+periode+compte),results]');
    await expect(count).toHaveText(/^16 observations · /);
    await period.getByRole('button', { name: 'Cette année' }).click();
    await expect.poll(async () => (await view(page)).points).toBe(16);
    expect((/** @type {any[]} */ (await mapOf(page).evaluate(m => /** @type {any} */ (m).area.points))).every(p => p.date.startsWith(String(now.getFullYear())))).toBe(true);
    await period.getByRole('button', { name: 'Toujours' }).click();
    await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(r=1km,ctl=rayon+lieu+periode+compte),results]');
    await expect.poll(async () => (await view(page)).points).toBe(24);
    // Floraison: its chips there by its intent, this month chosen; « Toujours » written against it.
    await app.go(`#/layout/[map(floraison;r=1km),results]?${AT}`);
    await expect(period.getByRole('button', { name: 'Ce mois-ci' })).toHaveAttribute('aria-pressed', 'true');
    await period.getByRole('button', { name: 'Toujours' }).click();
    await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(floraison,r=1km,when=toujours),results]');
    // The count touched: the map's panel, its « État ».
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => route.fulfill({ status: 503, body: '' }));
    await app.go(`#/layout/[map(r=3km),results]?at=48.86,2.36`);
    await expect.poll(() => mapOf(page).evaluate(m => /** @type {any} */ (m).statusLines.length), { timeout: 15_000 }).toBeGreaterThan(0);
    await cell(page).locator('button.count').click();
    const panel = mapOf(page).locator('gf-map-panel dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('region', { name: 'État de la carte' }).or(panel.locator('section.state'))).toBeVisible();
  });

  test('le fond : la vignette de l’autre fond le montre ; gardé comme le panneau le garde', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km;ctl=rayon+fond),results]?${AT}`);
    const base = () => mapOf(page).evaluate(m => /** @type {any} */ (m).baseShown);
    const first = await base();
    const tile = cell(page).locator('button.base');
    await expect(tile).toHaveAccessibleName(first === 'photo' ? 'Fond : le plan IGN' : 'Fond : les photos aériennes');
    await tile.click();
    await expect.poll(base).toBe(first === 'photo' ? 'plan' : 'photo');
    await expect(tile).toHaveAccessibleName(first === 'photo' ? 'Fond : les photos aériennes' : 'Fond : le plan IGN');
    // No background of its own: the Carte's shared choice.
    expect(await page.evaluate(() => Object.entries(localStorage).find(([k]) => /maplayer/i.test(k))?.[1] ?? '')).toContain(first === 'photo' ? '"plan"' : '"photo"');
    // Its own (base=photo): switched here, not saved for the other maps.
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/maplayer/i.test(k)) localStorage.removeItem(k); });
    await app.open(`#/layout/[map(r=1km;base=photo;ctl=fond),results]?${AT}`);
    await expect.poll(base).toBe('photo');
    await cell(page).locator('button.base').click();
    await expect.poll(base).toBe('plan');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /maplayer/i.test(k)).length)).toBe(0);
  });

  test('ctl= : exactement ces commandes ; par défaut celles de ui (complètes, compactes) et de l’intention ; nue : aucune', async ({ app, page }) => {
    const shown = () => cell(page).evaluate(el => {
      const r = /** @type {ShadowRoot} */ (el.shadowRoot);
      const vis = (/** @type {string} */ sel) => [...r.querySelectorAll(sel)].some(e => /** @type {HTMLElement} */ (e).checkVisibility());
      return {
        lieu: vis('gf-map-search'), gps: vis('.gf-map-buttons .locate'), couches: vis('.gf-map-buttons .layers') || Boolean(r.querySelector('gf-map-search')?.shadowRoot?.querySelector('button.icon-btn')),
        zoom: vis('.leaflet-control-zoom'), rayon: vis('.panel, .zone') && vis('.gf-radius-handle'), '3d': vis('.tr .round'), fond: vis('.tr .base'),
        compte: vis('button.count'), periode: vis('.period'), legende: vis('.legend')
      };
    });
    const on = async () => Object.entries(await shown()).filter(([, v]) => v).map(([k]) => k).sort();
    await app.open(`#/layout/[map(r=1km),results]?${AT}`);
    await expect.poll(on).toEqual(['3d', 'compte', 'couches', 'gps', 'lieu', 'rayon', 'zoom']);
    await app.go(`#/layout/[map(r=1km;ctl=zoom+compte),results]?${AT}`);
    await expect.poll(on).toEqual(['compte', 'zoom']);
    await expect(cell(page)).toHaveAttribute('ctl', 'compte zoom');
    // The search without its layers button; the layers button alone (round).
    await app.go(`#/layout/[map(r=1km;ctl=lieu),results]?${AT}`);
    await expect.poll(on).toEqual(['lieu']);
    await app.go(`#/layout/[map(r=1km;ctl=couches+legende),results]?${AT}`);
    await expect.poll(on).toEqual(['couches', 'legende']);
    // The legend: opened, its lines.
    await cell(page).getByRole('button', { name: 'Légende', exact: true }).click();
    await expect(cell(page).getByRole('list', { name: 'Légende de la carte' })).toContainText('La zone (1 km)');
    await app.go(`#/layout/[map(protege;r=1km),results]?${AT}`);
    await expect.poll(on).toContain('legende');
    await app.go(`#/layout/[map(floraison;r=1km),results]?${AT}`);
    await expect.poll(on).toContain('periode');
    await app.go(`#/layout/[map(r=1km;ui=nue),results]?${AT}`);
    await expect.poll(on).toEqual([]);
    await app.go(`#/layout/[map(r=1km;ui=nue;ctl=compte),results]?${AT}`);
    await expect.poll(on).toEqual(['compte']);
    // Compact: the zone a pill (« 1 km ▾ »), the count a number.
    await app.go(`#/layout/[map(r=1km;ui=compacte),results]?${AT}`);
    await expect.poll(on).toEqual(['3d', 'compte', 'couches', 'gps', 'rayon', 'zoom']);
    const pill = cell(page).locator('.zone > button');
    await expect(pill).toHaveText(/1 km/);
    await expect(cell(page).locator('button.count')).toHaveText(/^\d+$/);
    await pill.click();
    await cell(page).getByRole('group', { name: 'Rayon de la zone' }).getByRole('button', { name: '5 km' }).click();
    await expect.poll(() => param(page, 'r')).toBe('5km');
    // Written as the default gives them: left out of the address.
    await app.go(`#/layout/[map(ctl=rayon+lieu+gps+couches+3d+plante+compte+zoom),results]?${AT}`);
    await expect.poll(() => layoutOf(page)).toBe('#/layout/[map,results]');
  });

  test('« Créer une app » : les commandes sur la carte, une pastille chacune', async ({ app, page }) => {
    await app.open(`#/builder?g=[map(r=1km),plant]&${AT}`);
    await page.locator('gf-builder gf-layout section.cell[data-comp="map"] .cell-head .pick').click();
    const p = page.locator('gf-block-picker:not([inline])');
    await p.locator('.row[data-group="Interface"]').click();
    const ctl = p.locator('[data-param="ctl"]');
    await expect(ctl.locator('button[data-value="zoom"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(ctl.locator('button[data-value="periode"]')).toHaveAttribute('aria-pressed', 'false');
    await ctl.locator('button[data-value="zoom"]').click();
    await ctl.locator('button[data-value="fond"]').click();
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'))).toBe('[map(r=1km,ctl=rayon+lieu+gps+couches+3d+fond+plante+compte),plant]');
  });
});

test.describe('au téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a finger');

  test('la poignée du cercle au doigt : le rayon suit, la carte ne bouge pas', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km),plant]?${AT}`);
    const from = await still(handle(page));
    const c = await centreOnPage(page);
    const before = await view(page);
    const to = { x: c.x + (from.x - c.x) * 1.98, y: from.y - 4 };
    const cdp = await page.context().newCDPSession(page);
    const send = (/** @type {string} */ type, /** @type {{ x: number, y: number }[]} */ points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await send('touchStart', [from]);
    for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }]);
    await expect(handle(page).locator('.bubble')).toHaveText('2 km');
    const held = await view(page);
    expect(held.center[0]).toBeCloseTo(before.center[0], 6);
    expect(held.center[1]).toBeCloseTo(before.center[1], 6);
    await send('touchEnd', []);
    await cdp.detach();
    await expect.poll(() => param(page, 'r')).toBe('2km');
  });
});
