// A GBIF occurrence is drawn as an iNaturalist observation is, on every map that shows them (map-style.js: one look):
// its plant's photo (never a source's colour), the same groups (stacks of that photo, their count on a badge), the same
// plant lit, the same card (photo and credit, names, when, where) but for the line saying where it comes from. The
// maps: a plant sheet's (the observations around me from iNaturalist and GBIF, from GBIF alone, GBIF's occurrences of
// an area touched in the sheet — the plant's own photo on each), and the 3D « Observations autour » (each its plant's
// photo: an iNaturalist observation's of the same plant, else the flora's). Every source answered here (fixtures.mjs
// answerPlantNear, answerObservations; tiles.mjs), the 3D in real WebGL (SwiftShader).
import { test, expect, answerObservations, answerPlantNear, plantId } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

// Software WebGL for the 3D (as maps3d.spec.mjs); the 2D maps never ask for it.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

/** No point drawn in a source's colour, nor as a coloured bubble, nor as a bare dot (fewer than 40 alone here). */
const COLOURED = '.gf-obs-gbif, .gf-obs-inat, .gf-occ-gbif, .gf-occ-inat, .gf-occ-group-gbif, .gf-occ-group-inat, .gf-occ-group-occ, path.gf-occ, path.gf-obs, .gf-gl-dot.gf-occ';
/** The nettle's photo in the flora (tests/fixtures/plants.json): the one its sheet shows. */
const NETTLE_PHOTO = /Brennnessel/;

/**
 * The points of a plant sheet's map, as drawn: each marker a photo marker of the plant chosen — alone (its ring) or a
 * stack (its photo, their count) —, how many points they stand for, their photos (loaded, faded in) and their address.
 * @param {Locator} map
 */
const drawn = map => map.evaluate(el => {
  const out = { markers: 0, other: 0, points: 0, photos: 0, shown: 0, srcs: /** @type {string[]} */ ([]) };
  for (const icon of el.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon')) {
    const single = icon.matches('.gf-obs-leaf.hl.chosen'), group = icon.matches('.gf-occ-group-hl.photo');
    if (!single && !group) { out.other++; continue; }
    out.markers++;
    out.points += single ? 1 : Number(icon.querySelector('.n')?.textContent) || 0;
    const img = /** @type {HTMLImageElement | null} */ (icon.querySelector('img'));
    if (!img) continue;
    out.photos++;
    out.srcs.push(img.getAttribute('src') || '');
    if (img.complete && img.naturalWidth > 0 && img.classList.contains('in')) out.shown++;
  }
  return out;
});

/**
 * Every point of the map is its plant's photo marker (`n` of them), 90 % of their photos shown at least, all the
 * plant's, none in a source's colour. @param {Locator} map @param {number} n @param {string} when
 */
async function allPhotos(map, n, when) {
  await expect.poll(async () => {
    const d = await drawn(map);
    return d.points === n && d.photos === d.markers && d.shown >= 0.9 * d.markers ? 'ok' : JSON.stringify(d);
  }, { message: `photo markers (${when})`, timeout: 15_000, intervals: [250] }).toBe('ok');
  const d = await drawn(map);
  expect(d.other, 'no other marker on this map').toBe(0);
  for (const src of d.srcs) expect(src).toMatch(NETTLE_PHOTO);
  await expect(map.locator(COLOURED)).toHaveCount(0);
}

/**
 * The card of a point whose text says `text`: the groups spread first (a touch: each point a marker of its own), then
 * each point hovered (touched on a phone) until its card says it. @param {Locator} map @param {string} text @param {boolean} phone
 */
async function cardSaying(map, text, phone) {
  const group = map.locator('.leaflet-marker-pane .gf-occ-group-hl.photo').first();
  if (await group.count()) await group.dispatchEvent('click');
  const points = map.locator('.leaflet-marker-pane .gf-obs-leaf.hl.chosen');
  await expect(points.first()).toBeAttached();
  const card = map.locator('.gf-float-tip.on .gf-obs-card');
  for (let i = 0, n = await points.count(); i < n; i++) {
    await points.nth(i).dispatchEvent(phone ? 'click' : 'mouseover');
    if (await card.count() && (await card.textContent() || '').includes(text)) return card;
    if (!phone) await points.nth(i).dispatchEvent('mouseout');
  }
  throw new Error(`no point's card says « ${text} »`);
}

/** A point's card: the plant's photo (shown) and its credit, its names. @param {Locator} card */
async function plantCard(card) {
  const img = card.locator('img');
  await expect(img).toHaveAttribute('src', NETTLE_PHOTO);
  await expect.poll(() => img.evaluate(i => /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0)).toBe(true);
  await expect(card.locator('.credit')).toContainText('Photo :');
  await expect(card.locator('b')).toHaveText('Ortie dioïque');
  await expect(card.locator('i')).toHaveText('Urtica dioica');
}

/**
 * The nettle's sheet, its map set to show the observations around me (`near`), asked for. @param {Page} page
 * @param {import('./app.mjs').App} app @param {'both' | 'gbif' | 'off'} near
 */
async function sheetMap(page, app, near) {
  await app.open('#/collections');
  await page.evaluate(async n => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { near: n, gbif: 'off' }); }, near);
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const block = page.locator('gf-sheet-map:not([map-3d="off"])').first();
  await block.scrollIntoViewIfNeeded();
  if (near !== 'off') await block.locator('.near-ask').click();
  return block;
}

test('fiche plante : autour de moi, les occurrences GBIF comme les observations iNaturalist — la photo de la plante, les mêmes piles, la même carte', async ({ app, page }) => {
  /** @type {string[]} */ const asked = [];
  await answerPlantNear(page, { inat: 6, gbif: 7, seen: asked });
  const block = await sheetMap(page, app, 'both');
  const map = block.locator('gf-map');
  // 6 of iNaturalist's, 7 of GBIF's less its copy of an iNaturalist observation (shown by iNaturalist itself).
  await allPhotos(map, 12, 'iNaturalist and GBIF');
  expect(asked.some(u => u.includes('api.inaturalist.org') && u.includes('taxon_id=48460'))).toBe(true);
  expect(asked.some(u => u.includes('api.gbif.org') && u.includes('geoDistance='))).toBe(true);
  // The legend and the buttons: the plant's marker for both sources, never a source's colour.
  await expect(block.locator('.legend')).toContainText('iNaturalist (6)');
  await expect(block.locator('.legend')).toContainText('GBIF (7 à moins de 5 km)');
  await expect(block.locator('.legend i.obs')).toHaveCount(2);
  await expect(block.locator('.scope [data-layer="gbif-near"] i.obs, .scope [data-layer="inat"] i.obs')).toHaveCount(2);

  // A GBIF point's card: the plant's photo and its credit, its names, when and where — and its source; an iNaturalist
  // point's the same, but for its source.
  const gbif = await cardSaying(map, 'Observation : GBIF · Inventaire du CBN', app.phone);
  await plantCard(gbif);
  await expect(gbif).toContainText('Bois de Vincennes');
  await expect(gbif).toContainText('juin 2024');
  const inat = await cardSaying(map, 'Observation : iNaturalist', app.phone);
  await plantCard(inat);
  await expect(inat).toContainText('Paris 5e');
});

test('fiche plante : GBIF seul autour de moi, puis les occurrences d’une zone touchée — la photo de la plante sur chacune', async ({ app, page }) => {
  await answerPlantNear(page, { gbif: 7, area: 12 });
  const block = await sheetMap(page, app, 'gbif');
  const map = block.locator('gf-map');
  // GBIF alone: its 7, its copy of an iNaturalist observation kept (iNaturalist's are not shown).
  await allPhotos(map, 7, 'GBIF alone');
  await expect(block.locator('.legend')).toContainText('GBIF (7 à moins de 5 km)');
  await plantCard(await cardSaying(map, 'Observation : GBIF', app.phone));

  // An area touched in the sheet (a région): its occurrences, the same photo markers.
  await page.evaluate(async n => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { near: n }); }, 'off');
  await page.locator('gf-plant-detail').first().evaluate(async el => {
    const { sendFocus } = await import('/app/core/map-focus.js');
    sendFocus(el, { kind: 'filter', label: 'Île-de-France', params: { gadmGid: 'FRA.8_1' } });
  });
  await expect(block.locator('.chip[data-kind="filter"]')).toBeVisible();
  await allPhotos(map, 12, 'an area touched');
  await expect(block.locator('.legend')).toContainText('Occurrences GBIF : Île-de-France');
  await expect(block.locator('.legend i.obs')).toHaveCount(1);
  const card = await cardSaying(map, 'Observation : GBIF · Inventaire régional', app.phone);
  await plantCard(card);
  await expect(card).toContainText('Essonne');
});

test.describe('en 3D', () => {
  test.beforeEach(async ({ page }, info) => {
    if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  /** Software WebGL is slow: a change may take its time. */
  const SLOW = { timeout: 30_000 };
  /** What the 3D map's observations say (gf-map-obs3d.js state()). @param {Locator} map */
  const obs = map => map.evaluate(m => /** @type {any} */ (m).gl.state().obs3d);
  /** The markers standing on the map: how many, their photos shown, those a leaf alone. @param {Locator} map */
  const marks = map => map.evaluate(el => {
    const out = { markers: 0, photos: 0, shown: 0, leaves: 0 };
    for (const mk of el.querySelectorAll('.gf-o3-mk')) {
      out.markers++;
      for (const face of mk.querySelectorAll('.gf-obs-leaf')) {
        const img = /** @type {HTMLImageElement | null} */ (face.querySelector('img'));
        if (!img) { out.leaves++; continue; }
        out.photos++;
        if (img.complete && img.naturalWidth > 0 && img.classList.contains('in')) out.shown++;
      }
    }
    return out;
  });

  test('« Observations autour » : les occurrences GBIF comme les observations iNaturalist — photo de leur plante, plante éclairée, carte, graines', async ({ app, page }) => {
    test.slow();
    await answerTiles(page);
    await answerObservations(page, { inat: 20, gbif: 24 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('gf-gbif3d-set')) return;
      sessionStorage.setItem('gf-gbif3d-set', '1');
      localStorage.setItem('geoflora.maps3d', JSON.stringify({ renderer: '3d', relief: false, buildings: false, hillshade: false, sky: false, pitch: 30 }));
      localStorage.setItem('geoflora.mapView', JSON.stringify({ lat: 45.7772, lng: 3.087, zoom: 14 }));
      localStorage.setItem('geoflora.around3d', JSON.stringify({ 'gf-map-page': { on: true, radius: 2000, inat: false, gbif: true } }));
    });
    await app.open('#/collections');
    await page.evaluate(async () => {
      const col = await import('/app/core/collections.js');
      await col.savePlace(col.newPlace([3.0890, 45.7790], { name: 'Jardin Lecoq' }));
    });
    await app.go('#/map');
    const map = page.locator('gf-map-page gf-map');
    await expect(map).toHaveAttribute('data-renderer', '3d', SLOW);

    // GBIF alone: each occurrence its plant's photo (the flora's: no iNaturalist observation here), a French name.
    await expect.poll(async () => (await obs(map)).kinds?.gbif, SLOW).toBe(23);
    let st = await obs(map);
    expect(st.photos.gbif).toBe(23);
    await expect.poll(async () => {
      const m = await marks(map);
      return m.markers > 0 && m.leaves === 0 && m.shown >= 0.9 * m.photos ? 'ok' : JSON.stringify(m);
    }, { message: 'GBIF markers: photos', ...SLOW, intervals: [500] }).toBe('ok');
    // Its seeds the colour of an observation, whatever its source.
    const seeds = await map.evaluate(m => JSON.stringify(/** @type {any} */ (m).gl.glMap.getPaintProperty('gf-o3-seeds', 'circle-color')));
    expect(seeds).not.toContain('gbif');

    // Its card: the plant's photo and its credit, its names, when, where, and its source.
    const single = map.locator('.gf-o3-mk:not(.group)').first();
    await expect(single).toBeAttached(SLOW);
    await single.dispatchEvent('click');
    const card = map.locator('.gf-o3-card .gf-obs-card');
    await expect(card).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('src', /wikimedia/);
    await expect(card.locator('.credit')).toContainText('Photo :');
    await expect(card.locator('.source')).toHaveText('Observation : GBIF · Inventaire du CBN');
    await expect(card.locator('b')).not.toBeEmpty();
    await expect(card.locator('i')).not.toBeEmpty();
    await map.locator('.gf-o3-card').getByRole('button', { name: 'Fermer' }).click();

    // The plant a page shows: its GBIF occurrences lit, as its iNaturalist observations are.
    await map.evaluate(m => { /** @type {any} */ (m).highlight = { key: 'hl', points: [], sci: 'Hedera helix', common: 'Lierre grimpant' }; });
    await expect.poll(async () => (await obs(map)).lit).toEqual(['s:hedera helix']);
    await expect(map.locator('.gf-o3-mk.lit .gf-obs-leaf.chosen img').first()).toBeAttached(SLOW);
    await map.evaluate(m => { /** @type {any} */ (m).highlight = null; });

    // iNaturalist's too: the same markers, every point its plant's photo.
    await map.locator('.gf-o3-chip').click();
    await map.locator('.gf-o3-panel .gf-o3-toggle', { hasText: 'iNaturalist' }).locator('input').check();
    await expect.poll(async () => (await obs(map)).kinds, SLOW).toEqual({ inat: 20, gbif: 23, mine: 0 });
    st = await obs(map);
    expect(st.photos).toMatchObject({ inat: 20, gbif: 23 });
    await expect.poll(async () => (await marks(map)).leaves, SLOW).toBe(0);
    await expect(map.locator(COLOURED)).toHaveCount(0);
  });
});
