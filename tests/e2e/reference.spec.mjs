// The map's reference (« repère », app/components/gf-map.js `reference`): a long press proposes its point — a ghost
// there and the point's card asking (« Poser un repère ici ? » on the Carte, « Déplacer le lieu ici ? » in the place
// editor, « Chercher autour d’ici ? » in a free layout's map cell), said by the map's one live region —; Échap or
// « Annuler » keep nothing (a marker dragged there goes back), Entrée or « Confirmer » do what it is for (the place moved
// and saved once, the zone centred) and keep the point as the reference: its violet sight, told once
// (`reference-change`), its card with « Créer un lieu ici » next and « Retirer le repère », reached from its sight
// by the keyboard too; a free layout's reference goes with its zone. The keyboard's long press: Maj + F10 on the map.
// In 3D (gf-map-gl.js, the desktop only: software WebGL), the view centres on the reference and turns around it — the
// wheel pressed, Maj + →, « Tourner autour du repère » — the reference kept on its point of the screen (core/orbit.js;
// within 2 px), over the relief too; « Me localiser » never takes the view back from it. An address picked: the
// observations around framed once the 2D map has landed; a 2D flight stopped on its way: the 3D moves given back to it.
import { test, expect, answerObservations } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { mapSaid, overMap } from './quiet.mjs';
import { longPress } from './touch.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

/**
 * What the map tells from now on (its events' details, in order), read by the function returned.
 * @param {Locator} map @param {string[]} names @returns {Promise<() => Promise<Record<string, any[]>>>}
 */
async function listen(map, names) {
  await map.evaluate((m, n) => {
    const told = /** @type {Record<string, any[]>} */ ({});
    /** @type {any} */ (m).told = told;
    for (const name of n) { told[name] = []; m.addEventListener(name, e => told[name].push(/** @type {CustomEvent} */ (e).detail)); }
  }, names);
  return () => map.evaluate(m => /** @type {any} */ (m).told);
}

/**
 * A long press at a share of a box, on a whole pixel (a finger held on a phone, a right click on a desktop): where, in
 * the box (px from its top left corner), and on the ground as the 2D map reads it then ([lon, lat]; within `tol`:
 * 1.5 px there) — the map may move once it is answered. @param {Page} page @param {Locator} map @param {Locator} surface
 * @param {number} fx @param {number} fy
 */
async function press(page, map, surface, fx, fy) {
  const box = await surface.boundingBox();
  if (!box) throw new Error('no map on screen');
  const x = Math.round(box.x + box.width * fx), y = Math.round(box.y + box.height * fy);
  const root = /** @type {{ x: number, y: number }} */ (await map.locator('.gf-map-root').boundingBox());
  const [at, beside] = await map.evaluate((m, p) => [/** @type {any} */ (m).placeAt(p.x, p.y), /** @type {any} */ (m).placeAt(p.x + 1.5, p.y + 1.5)], { x: x - root.x, y: y - root.y });
  if ((page.viewportSize()?.width ?? 1280) < 700) await longPress(page, x, y);
  else await page.mouse.click(x, y, { button: 'right' });
  return { x: x - box.x, y: y - box.y, at, tol: Math.max(Math.abs(beside[0] - at[0]), Math.abs(beside[1] - at[1])) };
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b */
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** @param {number[]} a @param {number[]} b */
const near = (a, b, e = 2e-5) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;

/** Until a 2D map rests (its centre and zoom the same a moment apart: a frame, a flight over). @param {Page} page @param {Locator} map */
async function rest(page, map) {
  const view = () => map.evaluate(m => JSON.stringify([/** @type {any} */ (m).center(), /** @type {any} */ (m).zoom()]));
  let was = await view();
  await expect.poll(async () => { const before = was; await page.waitForTimeout(300); was = await view(); return was === before; }).toBe(true);
}

/** A marker's middle on the page. @param {Locator} el */
async function middle(el) {
  const b = await el.boundingBox();
  if (!b) throw new Error('not on screen');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('la Carte : l’appui long propose un repère — Échap n’en garde rien, Entrée le pose ; glissé puis Échap, il revient ; Maj + F10 ; « Retirer le repère »', async ({ app, page }) => {
  await app.open('#/map');
  const map = page.locator('gf-map-page gf-map');
  const leaflet = map.locator('.leaflet-container');
  await expect(leaflet).toBeVisible();
  const told = await listen(map, ['reference-change', 'point-info', 'positions-save']);
  const card = map.locator('gf-point-card');
  const ghost = map.locator('.leaflet-marker-pane .gf-ref.ghost');
  const ref = map.locator('.leaflet-marker-pane .gf-ref:not(.ghost)');

  // Asked: the ghost there (named, with its question), the question in the card (its « Confirmer » focused), said by
  // the map's live region.
  await press(page, map, leaflet, 0.4, 0.4);
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toHaveAttribute('role', 'img');
  await expect(ghost).toHaveAttribute('aria-label', 'Point proposé : Poser un repère ici ?');
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Confirmer' })).toBeFocused();
  await expect(card.getByRole('button', { name: 'Annuler' })).toBeVisible();
  await expect(mapSaid(map)).toContainText('Poser un repère ici ? Entrée pour confirmer, Échap pour annuler.');
  await expect(map.locator('[aria-live]')).toHaveCount(1);
  expect(await overMap(page)).toEqual([]);
  // Échap: nothing kept.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  await expect(ref).toHaveCount(0);
  await expect(mapSaid(map)).toContainText('Repère non posé.');
  expect(await told()).toEqual({ 'reference-change': [], 'point-info': [], 'positions-save': [] });
  expect(await map.evaluate(m => /** @type {any} */ (m).reference)).toBeNull();

  // Asked again, Entrée: the reference, told once; its sight (named), its card — « Créer un lieu ici » next.
  const pressed = await press(page, map, leaflet, 0.55, 0.45);
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(ref).toHaveCount(1);
  await expect(ghost).toHaveCount(0);
  await expect(ref).toHaveAttribute('aria-label', 'Repère : ouvrir sa fiche');
  let events = await told();
  expect(events['reference-change']).toHaveLength(1);
  expect(near(events['reference-change'][0].coordinates, pressed.at, pressed.tol)).toBe(true);
  expect(events['point-info']).toHaveLength(1);
  expect(events['point-info'][0].coordinates).toEqual(events['reference-change'][0].coordinates);
  expect(events['positions-save']).toEqual([]);
  await expect(card.getByRole('link', { name: 'Créer un lieu ici' })).toBeFocused();
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  await expect(mapSaid(map)).toContainText('Repère posé.');
  const reference = await map.evaluate(m => /** @type {any} */ (m).reference);
  expect(reference).toEqual(events['reference-change'][0].coordinates);

  // Échap: the card closed, the focus on the sight; Entrée on it (Leaflet makes no click of it): its card again, the
  // focus in it — told as the confirmation told it (point-info: the Carte's hint about an empty map gone again, as for
  // any open card). Its ✕: closed, the focus back on the sight (not lost to the page).
  const hint = page.locator('gf-map-page .empty-hint');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(ref).toBeFocused();
  await expect(hint).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Créer un lieu ici' })).toBeFocused();
  expect((await told())['point-info']).toEqual([events['point-info'][0], { coordinates: reference, label: '' }]);
  await expect(hint).toHaveCount(0);
  await card.getByRole('button', { name: 'Fermer' }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  await expect(ref).toBeFocused();
  await page.keyboard.press('Space');
  await expect(card.getByRole('link', { name: 'Créer un lieu ici' })).toBeFocused();

  // Editing started by the page (the Carte's « Déplacer » on a plant of its panel sets it): the reference's card closed,
  // « Terminé » shown in its place.
  await map.evaluate(m => { /** @type {any} */ (m).editing = true; });
  await expect(card).toHaveCount(0);
  await expect(map.locator('.gf-map-editbar')).toBeVisible();
  await map.evaluate(m => { /** @type {any} */ (m).editing = false; });
  await expect(map.locator('.gf-map-editbar')).toHaveCount(0);
  // (Again: its card.)
  await ref.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();

  // Dragged (a mouse): asked again; Échap — back where it was, the reference as it was.
  if (!app.phone) {
    await rest(page, map);
    const from = await middle(ref);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    // On its point again (the page around the map may have moved it: its card gone, the Carte's hint back).
    expect(await map.evaluate(m => /** @type {any} */ (m).reference)).toEqual(reference);
    const root = /** @type {{ x: number, y: number }} */ (await map.locator('.gf-map-root').boundingBox());
    const mid = await middle(ref), p = await map.evaluate((m, r) => /** @type {any} */ (m).pointOf(r), reference);
    expect(gap({ x: mid.x - root.x, y: mid.y - root.y }, p)).toBeLessThan(1.5);
    expect((await told())['reference-change']).toHaveLength(1);
    // Touched: its card again.
    await ref.click();
    await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  }

  // The keyboard's long press (Maj + F10 on the map: its centre); Entrée on another marker (the sight) is that
  // marker's, never a « Confirmer »; « Annuler », the focus back on the map.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await leaflet.focus();
  await page.keyboard.press('Shift+F10');
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  await ref.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  expect((await told())['reference-change']).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await leaflet.focus();
  await page.keyboard.press('Shift+F10');
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  await expect(ghost).toHaveCount(1);
  await card.getByRole('button', { name: 'Annuler' }).click();
  await expect(card).toHaveCount(0);
  await expect(leaflet).toBeFocused();
  expect((await told())['reference-change']).toHaveLength(1);
  // Again, Entrée on the map itself (its own key, not a button's): the view's centre is the reference.
  const centre = await map.evaluate(m => /** @type {any} */ (m).center());
  await page.keyboard.press('Shift+F10');
  await expect(ghost).toHaveCount(1);
  await leaflet.focus();
  await page.keyboard.press('Enter');
  await expect(ghost).toHaveCount(0);
  events = await told();
  expect(events['reference-change']).toHaveLength(2);
  expect(events['reference-change'][1].coordinates).toEqual(centre);

  // « Retirer le repère »: gone, told (null), said.
  await card.getByRole('button', { name: 'Retirer le repère' }).click();
  await expect(ref).toHaveCount(0);
  await expect(card).toHaveCount(0);
  events = await told();
  expect(events['reference-change']).toHaveLength(3);
  expect(events['reference-change'][2]).toEqual({ coordinates: null });
  await expect(mapSaid(map)).toContainText('Repère retiré.');
  expect(await map.evaluate(m => /** @type {any} */ (m).reference)).toBeNull();
});

test('l’éditeur d’un lieu : « Déplacer le lieu ici ? » — confirmé, un seul positions-save ; l’épingle glissée puis Échap revient à sa place', async ({ app, page }) => {
  await app.open('#/collection/new?kind=place&at=48.850000,2.350000');
  const map = page.locator('gf-spot-editor gf-map');
  const leaflet = map.locator('.leaflet-container');
  // A new place opens editing its position (full screen), its pin draggable.
  await expect(map).toHaveAttribute('editing', '');
  const pin = map.locator('.leaflet-marker-pane .gf-place.editing');
  await expect(pin).toHaveCount(1);
  const told = await listen(map, ['positions-save', 'reference-change']);
  const card = map.locator('gf-point-card');

  // A long press: asked, nothing saved yet; « Confirmer »: the place there, saved once — the reference there too.
  const pressed = await press(page, map, leaflet, 0.3, 0.35);
  await expect(card.getByRole('heading', { name: 'Déplacer le lieu ici ?' })).toBeVisible();
  await expect(map.locator('.leaflet-marker-pane .gf-ref.ghost')).toHaveCount(1);
  // Its question in place of « Terminé » (both at the bottom).
  await expect(map.locator('.gf-map-editbar')).toBeHidden();
  expect((await told())['positions-save']).toEqual([]);
  await card.getByRole('button', { name: 'Confirmer' }).click();
  await expect(card).toHaveCount(0);
  await expect(map.locator('.gf-map-editbar')).toBeVisible();
  await expect.poll(async () => (await told())['positions-save'].length).toBe(1);
  const saved = (await told())['positions-save'][0];
  expect(near(saved.pin, pressed.at, pressed.tol)).toBe(true);
  expect(saved.places).toEqual([]);
  expect(saved.plants).toEqual([]);
  await expect(mapSaid(map)).toContainText('Lieu déplacé.');
  await expect(map.locator('.leaflet-marker-pane .gf-ref:not(.ghost)')).toHaveCount(1);
  expect((await told())['reference-change']).toHaveLength(1);
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).pin)).toEqual(saved.pin);

  // Dragged (a mouse): asked; Échap — back where it was, nothing saved.
  if (!app.phone) {
    // (Framed again on the place moved: once the map rests.)
    await rest(page, map);
    const from = await middle(pin);
    await page.mouse.move(from.x, from.y - 6);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect(card.getByRole('heading', { name: 'Déplacer le lieu ici ?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(mapSaid(map)).toContainText('Le lieu reste à sa place.');
    expect(gap(await middle(pin), from)).toBeLessThan(1.5);
    expect((await told())['positions-save']).toHaveLength(1);
    // Dragged, and while it asks its place moves (a new place following the GPS: a new fix); Échap — back where the
    // place is now, not where the drag began.
    await page.mouse.move(from.x, from.y - 6);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y - 40, { steps: 8 });
    await page.mouse.up();
    await expect(card.getByRole('heading', { name: 'Déplacer le lieu ici ?' })).toBeVisible();
    const root = /** @type {{ x: number, y: number }} */ (await map.locator('.gf-map-root').boundingBox());
    const fix = await map.evaluate((m, r) => /** @type {any} */ (m).placeAt(r.x - 40, r.y + 30), { x: from.x - root.x, y: from.y - root.y });
    await map.evaluate((m, at) => { /** @type {any} */ (m).pin = at; }, fix);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    // (Its marker moved on the screen as its point did: from where it was, by the fix's offset.)
    const [a, b] = await map.evaluate((m, p) => [/** @type {any} */ (m).pointOf(p.was), /** @type {any} */ (m).pointOf(p.fix)], { was: saved.pin, fix });
    expect(gap(await middle(pin), { x: from.x + b.x - a.x, y: from.y + b.y - a.y })).toBeLessThan(1.5);
    expect((await told())['positions-save']).toHaveLength(1);
    // (Its point given back.)
    await map.evaluate((m, at) => { /** @type {any} */ (m).pin = at; }, saved.pin);
    await expect.poll(async () => gap(await middle(pin), from)).toBeLessThan(1.5);
    // Dragged again, Entrée: saved once more (one move, one save).
    await page.mouse.move(from.x, from.y - 6);
    await page.mouse.down();
    await page.mouse.move(from.x - 50, from.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect(card.getByRole('heading', { name: 'Déplacer le lieu ici ?' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await told())['positions-save'].length).toBe(2);
    expect((await told())['positions-save'][1].pin).not.toEqual(saved.pin);
  }
});

test('une case de disposition : « Chercher autour d’ici ? » — sa zone ne s’y centre qu’une fois confirmé ; la zone partie ailleurs, son repère avec elle', async ({ app, page }) => {
  // The IGN's reverse geocoder: a zone centred by a long press named after its commune (place=).
  await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/reverse\?/, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ type: 'FeatureCollection', features: [{ properties: { label: 'Place de Jaude', city: 'Clermont-Ferrand', distance: 20 } }] }) }));
  await app.open('#/layout/[map,search]?at=48.85,2.35');
  const cell = page.locator('dl-map');
  const map = cell.locator('gf-map');
  const leaflet = map.locator('.leaflet-container');
  await expect(leaflet).toBeVisible();
  await expect(map).toHaveAttribute('aria-description', 'Appui long sur la carte, puis « Confirmer » : la zone s’y centre.');
  const zone = async () => {
    const m = /[?&]at=([-\d.]+),([-\d.]+)/.exec(await page.evaluate(() => location.hash));
    return m ? [Number(m[2]), Number(m[1])] : null;
  };
  const place = async () => new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1] ?? '').get('place');
  const before = await zone();
  expect(before).toEqual([2.35, 48.85]);
  const card = map.locator('gf-point-card');

  await press(page, map, leaflet, 0.3, 0.3);
  await expect(card.getByRole('heading', { name: 'Chercher autour d’ici ?' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Créer un lieu ici' })).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await zone()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(mapSaid(map)).toContainText('La zone reste où elle est.');
  expect(await zone()).toEqual(before);

  const told = await listen(map, ['reference-change']);
  const pressed = await press(page, map, leaflet, 0.35, 0.3);
  await expect(card.getByRole('heading', { name: 'Chercher autour d’ici ?' })).toBeVisible();
  // Entrée (« Confirmer » focused): the focus then on the card itself — no « Créer un lieu ici » here, and never on
  // « Retirer le repère » (Entrée again would take the reference just set).
  await expect(card.getByRole('button', { name: 'Confirmer' })).toBeFocused();
  await page.keyboard.press('Enter');
  // The zone there (its address: 5 decimals), the reference where the finger was.
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).reference)).not.toBeNull();
  const reference = await map.evaluate(m => /** @type {any} */ (m).reference);
  expect(near(reference, pressed.at, pressed.tol)).toBe(true);
  await expect.poll(async () => near(/** @type {number[]} */ (await zone()), reference, 1e-5)).toBe(true);
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  await expect(card.getByRole('region', { name: 'Repère sur la carte' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await map.evaluate(m => /** @type {any} */ (m).reference)).toEqual(reference);
  await expect(map.locator('.leaflet-marker-pane .gf-ref:not(.ghost)')).toHaveCount(1);
  // Its zone kept: the reference stays (the zone's centre, its address rounded).
  await page.waitForTimeout(300);
  expect((await told())['reference-change']).toHaveLength(1);
  await expect.poll(() => place()).toBe('Clermont-Ferrand');

  // Its card closed, opened again from its sight (point-info told again): the zone there already — kept as it is, its
  // name too, nothing added to the history.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(near(/** @type {number[]} */ (await zone()), reference, 1e-5)).toBe(true);
  expect(await place()).toBe('Clermont-Ferrand');

  // Back: the zone where it was — the reference, its old centre, gone with it (told), its card too.
  await page.goBack();
  await expect.poll(zone).toEqual(before);
  await expect(map.locator('.leaflet-marker-pane .gf-ref')).toHaveCount(0);
  expect(await map.evaluate(m => /** @type {any} */ (m).reference)).toBeNull();
  expect((await told())['reference-change']).toEqual([expect.anything(), { coordinates: null }]);
  await expect(card).toHaveCount(0);
});

test.describe('en 3D', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'software WebGL: the desktop only');
    await page.setViewportSize({ width: 1024, height: 680 });
  });

  /**
   * The Carte in 3D (its tiles made here), the console's errors kept; its map, its canvas, what its 3D map says, and
   * `settle`: until the camera rests (its bearing, its tilt, its centre the same a moment apart).
   * @param {Page} page @param {any} app @param {Record<string, any>} [settings] geoflora.maps3d @param {number} [zoom]
   * @param {Record<string, any> | null} [around] what the Carte's map kept of its observations around (geoflora.around3d)
   * @param {(() => Promise<void>) | null} [seed] what the app holds first (Mes plantes open meanwhile)
   */
  async function open3d(page, app, settings = {}, zoom = 14, around = null, seed = null) {
    /** @type {string[]} */ const problems = [];
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text()); });
    await answerTiles(page);
    await page.addInitScript(([s, z, a]) => {
      if (sessionStorage.getItem('gf-ref-set')) return;
      sessionStorage.setItem('gf-ref-set', '1');
      localStorage.setItem('geoflora.maps3d', JSON.stringify({ renderer: '3d', relief: false, buildings: false, hillshade: false, sky: false, pitch: 30, ...s }));
      localStorage.setItem('geoflora.mapView', JSON.stringify({ lat: 45.7772, lng: 3.087, zoom: z }));
      if (a) localStorage.setItem('geoflora.around3d', JSON.stringify({ 'gf-map-page': a }));
    }, /** @type {[Record<string, any>, number, any]} */ ([settings, zoom, around]));
    if (seed) { await app.open('#/collections'); await seed(); await app.go('#/map'); } else await app.open('#/map');
    const map = page.locator('gf-map-page gf-map');
    await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
    const canvas = map.locator('canvas.maplibregl-canvas');
    const gl = () => map.evaluate(m => /** @type {any} */ (m).gl.state());
    const settle = async () => {
      let was = await gl();
      await expect.poll(async () => {
        const before = was;
        await page.waitForTimeout(300);
        was = await gl();
        return was.bearing === before.bearing && was.pitch === before.pitch && near(was.center, before.center, 1e-9);
      }, SLOW).toBe(true);
      return was;
    };
    return { map, canvas, gl, settle, problems };
  }

  /** Software WebGL is slow. */
  const SLOW = { timeout: 30_000 };

  /** A turn of `deg` with the wheel pressed (0.8° a pixel), from the middle of the canvas. @param {Page} page @param {Locator} canvas @param {number} deg */
  async function wheelTurn(page, canvas, deg) {
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await canvas.boundingBox());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2 + deg / 0.8, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
  }

  /** A bearing's change, within ±180°. @param {number} a @param {number} b */
  const turned = (a, b) => ((b - a + 540) % 360) - 180;

  /**
   * The camera filmed from now on, by the page itself: each of MapLibre's frames — its time on the page's clock, its zoom
   * and bearing (unrounded), the reference on the screen (and `point`'s, when given) —, read by framed() and later(); its
   * first frame returned. Not asked by the test as it goes: software WebGL holds the page at each frame (its picture
   * read back for the compositor, some 0.2–0.5 s on a loaded machine), each question of the test answered that much
   * later — a 9 s turn seen only as it ends, or over.
   * @param {Locator} map @param {number[] | null} [point] [lon, lat]
   * @returns {Promise<{ t: number, zoom: number, bearing: number, refAt: number[] | null, at: number[] | null }>}
   */
  function film(map, point = null) {
    return map.evaluate((m, p) => {
      const h = /** @type {any} */ (m), gl = h.gl.glMap;
      if (h.film) gl.off('move', h.film.shot);
      /** @type {any[]} */ const frames = [];
      const xy = (/** @type {number[] | null} */ c) => { const s = c ? gl.project(c) : null; return s ? [s.x, s.y] : null; };
      const shot = () => { frames.push({ t: performance.now(), zoom: gl.getZoom(), bearing: gl.getBearing(), refAt: xy(h.reference), at: xy(p) }); };
      shot();
      gl.on('move', shot);
      h.film = { frames, shot };
      return frames[0];
    }, point);
  }

  /**
   * Once the observations around have framed their circle and turn around it, as filmed since film(): the camera then —
   * the flight over (the zoom unchanged for a moment, 300 ms: in every frame of it — a flight changes it in each one),
   * the slow turn under way (the bearing not).
   * @param {Locator} map @returns {Promise<{ t: number, zoom: number, bearing: number, refAt: number[] }>}
   */
  async function framed(map) {
    /** @type {any} */ let at = null;
    await expect.poll(async () => (at = await map.evaluate(m => {
      const f = /** @type {any} */ (m).film.frames;
      for (let j = 1, i = -1; j < f.length; j++) {
        while (f[i + 1].t <= f[j].t - 300) i++;
        if (i < 0) continue;
        if (f.slice(i, j).every((/** @type {any} */ s) => s.zoom === f[j].zoom) && Math.abs(((f[j].bearing - f[i].bearing + 540) % 360) - 180) > 0.05) return f[j];
      }
      return null;
    })), SLOW).not.toBeNull();
    return at;
  }

  /**
   * The camera `ms` after a moment filmed (its first frame since; at rest by then, the camera as it rests), waited for
   * on the page's clock. @param {Locator} map @param {{ t: number }} from @param {number} ms
   */
  const later = (map, from, ms) => map.evaluate((m, [t, wait]) => new Promise(done => {
    const h = /** @type {any} */ (m), f = h.film.frames;
    const look = () => {
      const shot = f.find((/** @type {any} */ s) => s.t >= t + wait);
      if (shot) done(shot);
      else if (performance.now() >= t + wait && !h.gl.glMap.isMoving()) done(f.at(-1));
      else setTimeout(look, 50);
    };
    look();
  }), [from.t, ms]);

  /** @param {number[]} a @param {number[]} b */
  const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  test('la vue se centre sur le repère et tourne autour : molette enfoncée, Maj + →, « Tourner autour du repère » — à 2 px près', async ({ app, page }) => {
    test.slow();
    const { map, canvas, gl, settle, problems } = await open3d(page, app);
    const turn = map.getByRole('button', { name: 'Tourner autour du repère' });
    await expect(turn).toBeHidden();
    const told = await listen(map, ['reference-change']);

    // Proposed (its ghost, standing on the map), confirmed with Entrée: the view centres on it.
    const pressed = await press(page, map, canvas, 0.3, 0.35);
    const at = await map.evaluate((m, p) => /** @type {any} */ (m).gl.glMap.unproject([p.x, p.y]).toArray(), pressed);
    await expect(map.locator('.gf-gl-mk .gf-ref.ghost')).toHaveCount(1);
    await expect(map.locator('gf-point-card').getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    expect((await told())['reference-change']).toHaveLength(1);
    let st = await settle();
    expect(near(st.reference, at, 1e-6)).toBe(true);
    expect(st.pivot).toBe(true);
    const size = await canvas.evaluate(c => [c.clientWidth, c.clientHeight]);
    expect(Math.hypot(st.refAt[0] - size[0] / 2, st.refAt[1] - size[1] / 2)).toBeLessThanOrEqual(2);
    // (Its centre the 2D map's, on a whole pixel of it.)
    expect(near(st.center, st.reference, 1e-4)).toBe(true);
    await expect(turn).toBeVisible();

    // Away from the middle (a pan turns nothing): where it is now on the screen.
    await map.evaluate(m => /** @type {any} */ (m).gl.glMap.panBy([150, 80], { duration: 0 }));
    st = await settle();
    const p0 = st.refAt;
    expect(Math.hypot(p0[0] - size[0] / 2, p0[1] - size[1] / 2)).toBeGreaterThan(100);
    const off = (/** @type {any} */ s) => Math.hypot(s.refAt[0] - p0[0], s.refAt[1] - p0[1]);

    // The wheel pressed, dragged sideways: a turn of 64° (0.8° a pixel), around the reference.
    let before = st;
    await wheelTurn(page, canvas, 64);
    st = await settle();
    expect(Math.abs(turned(before.bearing, st.bearing) + 64)).toBeLessThanOrEqual(1);
    expect(st.pitch).toBe(before.pitch);
    expect(off(st)).toBeLessThanOrEqual(2);

    // Maj + → (MapLibre's own turn, eased): around it too.
    before = st;
    await canvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    st = await settle();
    expect(st.bearing).not.toBe(before.bearing);
    expect(off(st)).toBeLessThanOrEqual(2);

    // « Tourner autour du repère »: 45° a press, said.
    before = st;
    await turn.click();
    st = await settle();
    expect(Math.abs(turned(before.bearing, st.bearing) - 45)).toBeLessThanOrEqual(1);
    expect(off(st)).toBeLessThanOrEqual(2);
    await expect(mapSaid(map)).toContainText('Vue tournée autour du repère : cap');
    // Pressed fast (a key held, quick clicks): the presses add up, never half a turn ahead of the view (MapLibre would
    // turn back the short way) — 3 of 5 taken, clockwise.
    before = st;
    await turn.evaluate(b => { for (let i = 0; i < 5; i++) /** @type {HTMLButtonElement} */ (b).click(); });
    st = await settle();
    expect(Math.abs(turned(before.bearing, st.bearing) - 135)).toBeLessThanOrEqual(1);
    expect(off(st)).toBeLessThanOrEqual(2);

    // Its buttons made again (the search taken back, then given back): the button still among them.
    const among = map.locator('.gf-map-buttons button.turn-ref');
    await map.evaluate(m => { /** @type {any} */ (m).noSearch = true; });
    await expect(map.locator('gf-map-search')).toHaveCount(0);
    await expect(among).toBeVisible();
    await map.evaluate(m => { /** @type {any} */ (m).noSearch = false; });
    await expect(map.locator('gf-map-search')).toHaveCount(1);
    await expect(among).toBeVisible();
    expect((await gl()).turnShown).toBe(true);

    // « Retirer le repère » (what its card's button does) while the view turns slowly around it: the view stops where
    // it is — never back to the centre that turn began from —, the button gone, the view turning around the middle.
    await map.evaluate(m => { const g = /** @type {any} */ (m).gl.glMap; g.easeTo({ bearing: g.getBearing() + 90, duration: 8000, easing: (/** @type {number} */ t) => t }); });
    await page.waitForTimeout(2000);
    const jump = await map.evaluate(async m => {
      const g = /** @type {any} */ (m).gl.glMap, c = g.getCenter();
      /** @type {any} */ (m).removeReference();
      for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
      const a = g.project(c), b = g.project(g.getCenter());
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    expect(jump).toBeLessThan(2);
    await expect(turn).toBeHidden();
    st = await gl();
    expect(st.pivot).toBe(false);
    expect(st.reference).toBeNull();
    expect((await told())['reference-change']).toEqual([expect.anything(), { coordinates: null }]);
    expect(problems).toEqual([]);
  });

  test('sur le relief, le repère garde sa place pendant les tours (la hauteur regardée gardée)', async ({ app, page }) => {
    test.slow();
    // The relief on (hills of some hundreds of metres, tiles.mjs), tilted, close.
    const { map, canvas, gl, settle, problems } = await open3d(page, app, { relief: true, pitch: 50 }, 15);
    await expect.poll(async () => (await gl()).terrain, SLOW).toBe(true);
    /** Until its tiles are drawn (the ground's heights known: the reference's place on the screen depends on them). */
    const idle = () => map.evaluate(m => new Promise(r => { const g = /** @type {any} */ (m).gl.glMap; if (g.loaded() && !g.isMoving()) r(true); else g.once('idle', () => r(true)); }));
    await idle();
    await press(page, map, canvas, 0.5, 0.5);
    await page.keyboard.press('Enter');
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    await settle();
    // Away from the middle, some 400 px: a turn moves the centre over hundreds of metres of slopes.
    await map.evaluate(m => /** @type {any} */ (m).gl.glMap.panBy([300, 220], { duration: 0 }));
    await settle();
    await idle();
    let st = await gl();
    const p0 = st.refAt;
    const off = (/** @type {any} */ s) => Math.hypot(s.refAt[0] - p0[0], s.refAt[1] - p0[1]);
    // The wheel pressed (one camera jump a step), then « Tourner autour du repère » (eased), twice.
    let before = st;
    await wheelTurn(page, canvas, 64);
    await settle();
    await idle();
    st = await gl();
    expect(Math.abs(turned(before.bearing, st.bearing) + 64)).toBeLessThanOrEqual(1);
    expect(off(st)).toBeLessThanOrEqual(2);
    const turn = map.getByRole('button', { name: 'Tourner autour du repère' });
    // (Each move's end, as gf-map hears it: gl-moveend.)
    const ends = map.locator('.gf-map-root');
    await ends.evaluate(r => { /** @type {any} */ (r).ends = 0; r.addEventListener('gl-moveend', () => { /** @type {any} */ (r).ends++; }); });
    for (let i = 0; i < 2; i++) {
      before = st;
      await ends.evaluate(r => { /** @type {any} */ (r).ends = 0; });
      await turn.click();
      await settle();
      await idle();
      st = await gl();
      expect(Math.abs(turned(before.bearing, st.bearing) - 45)).toBeLessThanOrEqual(1);
      expect(off(st)).toBeLessThanOrEqual(2);
      // One turn, one end told — its centre set back on the ground within it, the 2D map given that view once.
      expect(await ends.evaluate(r => /** @type {any} */ (r).ends)).toBe(1);
      const flat = await map.evaluate(m => [/** @type {any} */ (m).center(), /** @type {any} */ (m).zoom()]);
      expect(near(flat[0], st.center, 1e-9)).toBe(true);
      expect(flat[1]).toBeCloseTo(st.zoom + 1, 9);
    }
    expect(problems).toEqual([]);
  });

  test('une adresse choisie dans sa recherche : la vue 3D y vole comme la 2D, jusqu’à son zoom — jamais arrêtée au départ', async ({ app, page }) => {
    test.slow();
    // The IGN's geocoder, as the search pill asks it: one address, some 4 km away.
    await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/completion\?/, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ status: 'OK', results: [{ fulltext: 'Puy de Montaudoux, 63122 Ceyrat', zipcode: '63122', city: 'Ceyrat', kind: 'lieu-dit', x: 3.049, y: 45.752 }] }) }));
    const { map, canvas, settle, problems } = await open3d(page, app, {}, 13);
    const told = await listen(map, ['reference-change']);
    await map.locator('gf-map-search input[type="search"]').fill('Montaudoux');
    await map.locator('gf-map-search').getByRole('button', { name: /Puy de Montaudoux/ }).click();
    // The reference at once (a choice made: no question), the view flown there — to the zoom the search asks (15 at
    // least; MapLibre's one less), as in 2D: not left at the zoom it had, nor stopped short as the Carte's page is laid
    // out again meanwhile (its hint gone with the card open: the map resized).
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    expect((await told())['reference-change']).toEqual([{ coordinates: [3.049, 45.752] }]);
    const st = await settle();
    expect(await map.evaluate(m => /** @type {any} */ (m).zoom())).toBe(15);
    expect(st.zoom).toBeCloseTo(14, 3);
    // (In the middle of the screen, on a whole pixel of the 2D map.)
    expect(near(st.center, [3.049, 45.752], 1e-4)).toBe(true);
    const size = await canvas.evaluate(c => [c.clientWidth, c.clientHeight]);
    expect(Math.hypot(st.refAt[0] - size[0] / 2, st.refAt[1] - size[1] / 2)).toBeLessThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test('une adresse choisie, les Observations autour cadrent son cercle une fois la carte 2D posée — comme après un appui long confirmé —, puis leur lent tour', async ({ app, page }) => {
    test.slow();
    await answerObservations(page);
    await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/completion\?/, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ status: 'OK', results: [{ fulltext: 'Puy de Montaudoux, 63122 Ceyrat', zipcode: '63122', city: 'Ceyrat', kind: 'lieu-dit', x: 3.049, y: 45.752 }] }) }));
    const { map, canvas, gl, problems } = await open3d(page, app);
    const button = map.getByRole('button', { name: 'Observations autour', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await gl()).obs3d.points, SLOW).toBeGreaterThan(0);

    // A long press confirmed — the keyboard's, at the view's centre (a right click could fall on one of their markers,
    // turning with the view) —: the circle there, framed (its centre a little above the middle), then its slow turn
    // around the reference. (The Carte's hint about an empty map goes as the reference's card opens: the map resized
    // in the middle of the circle's flight — framed all the same, for its new size.)
    await canvas.focus();
    await page.keyboard.press('Shift+F10');
    await expect(map.locator('gf-point-card').getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
    await page.keyboard.press('Enter');
    await film(map);
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    await expect.poll(async () => (await gl()).obs3d.why).toBe('reference');
    const a = await framed(map);

    // An address picked: the reference at once, the 2D map flying there (to the search's zoom, 15) — then, landed, the
    // circle framed the same way (not left at the search's zoom), and turned around.
    await map.locator('gf-map-search input[type="search"]').fill('Montaudoux');
    await map.locator('gf-map-search').getByRole('button', { name: /Puy de Montaudoux/ }).click();
    await film(map);
    await expect.poll(async () => (await gl()).obs3d.center).toEqual([3.049, 45.752]);
    const b = await framed(map);
    expect(b.zoom).toBeCloseTo(a.zoom, 2);
    expect(apart(b.refAt, a.refAt)).toBeLessThanOrEqual(2);
    const c = await later(map, b, 2000);
    expect(turned(b.bearing, c.bearing)).toBeGreaterThan(3);
    expect(apart(c.refAt, b.refAt)).toBeLessThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test('l’astuce de la Carte encore là, un appui long confirmé : les Observations autour cadrent leur cercle et tournent lentement autour du repère, la carte 2D finit où la 3D se pose', async ({ app, page }) => {
    test.slow();
    await answerObservations(page);
    const { map, canvas, gl, settle, problems } = await open3d(page, app);
    // The Carte's hint about an empty map, there until the reference's card opens (point-info, as it is confirmed):
    // gone then, the map resized in the middle of the circle's flight (Leaflet's move and its end, no movestart).
    const hint = page.locator('gf-map-page .empty-hint');
    await expect(hint).toBeVisible();
    const button = map.getByRole('button', { name: 'Observations autour', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await gl()).obs3d.points, SLOW).toBeGreaterThan(0);
    // Around the view's centre first: framed (its flight turns the view), turned, then at rest.
    await expect.poll(async () => (await gl()).bearing, SLOW).not.toBe(0);
    const from = await settle();

    // A long press away from the middle, beyond their markers, confirmed: the circle there, framed (its centre a little
    // above the middle) — never stopped half way as the page is laid out again —, then its slow turn around it (filmed
    // from the view at rest: the flight, its turn, as they were — not as late as a slow machine answers).
    await film(map);
    await press(page, map, canvas, 0.06, 0.55);
    await expect(map.locator('gf-point-card').getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
    await expect(hint).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    await expect(hint).toHaveCount(0);
    await expect.poll(async () => (await gl()).obs3d.why).toBe('reference');
    const b = await framed(map);
    const [w, h] = await canvas.evaluate(c => [c.clientWidth, c.clientHeight]);
    expect(Math.abs(b.refAt[0] - w / 2)).toBeLessThanOrEqual(2);
    expect(h / 2 - b.refAt[1]).toBeGreaterThan(0);
    expect(h / 2 - b.refAt[1]).toBeLessThan(h / 8);
    const c = await later(map, b, 2000);
    expect(turned(b.bearing, c.bearing)).toBeGreaterThan(3);
    expect(apart(c.refAt, b.refAt)).toBeLessThanOrEqual(2);

    // The turn over (all of it: the flight's −20°, then 30°), around the reference; the 2D map where the 3D map rests
    // (given once the turn ends) — by the reference, not left between where the view was and it.
    const end = await settle();
    expect(Math.abs(turned(from.bearing, end.bearing) - 10)).toBeLessThanOrEqual(1);
    expect(apart(end.refAt, b.refAt)).toBeLessThanOrEqual(2);
    const flat = await map.evaluate(m => /** @type {any} */ (m).center());
    expect(near(flat, end.center, 2e-4)).toBe(true);
    expect(near(flat, end.reference, 1e-2)).toBe(true);
    expect(near(flat, from.center, 1e-2)).toBe(false);
    expect(problems).toEqual([]);
  });

  test('la carte redimensionnée pendant le vol des Observations autour : leur cercle cadré pour sa nouvelle taille, le tour entier, pas 20° de trop', async ({ app, page }) => {
    test.slow();
    await answerObservations(page);
    const { map, canvas, gl, settle, problems } = await open3d(page, app);
    await page.locator('gf-map-page .empty-hint').getByRole('button', { name: 'Masquer l’astuce' }).click();
    const button = map.getByRole('button', { name: 'Observations autour', exact: true });
    await button.click();
    await expect.poll(async () => (await gl()).obs3d.points, SLOW).toBeGreaterThan(0);
    await expect.poll(async () => (await gl()).bearing, SLOW).not.toBe(0);
    const from = await settle();

    // A long press at the view's centre confirmed: the circle's flight under way (turned a little, not all of its −20°),
    // the map narrowed then — by the page itself, in that very frame (a slow machine's answers would come after the
    // flight) —: framed again for the new size (a new flight), landing at the same bearing (not 20° from where it is).
    await film(map);
    await canvas.focus();
    await page.keyboard.press('Shift+F10');
    await expect(map.locator('gf-point-card').getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
    await map.evaluate((m, from) => {
      const h = /** @type {any} */ (m), gl = h.gl.glMap;
      h.reframed = 0;
      const look = () => {
        if (((gl.getBearing() - from + 540) % 360) - 180 >= -2) { gl.once('move', look); return; }
        gl.on('movestart', (/** @type {any} */ e) => { if (e.gfObs === 'fly') h.reframed++; });
        h.style.width = '860px';
      };
      gl.once('move', look);
    }, from.bearing);
    await page.keyboard.press('Enter');
    const b = await framed(map);
    expect(await map.evaluate(m => /** @type {any} */ (m).reframed)).toBe(1);
    const w = await canvas.evaluate(c => c.clientWidth);
    expect(w).toBeLessThan(1000);
    expect(Math.abs(b.refAt[0] - w / 2)).toBeLessThanOrEqual(2);
    const end = await settle();
    expect(Math.abs(turned(from.bearing, end.bearing) - 10)).toBeLessThanOrEqual(1.5);
    expect(problems).toEqual([]);
  });

  test('un vol de la carte 2D arrêté en chemin (lf.stop()) : les mouvements de la vue 3D lui reviennent ensuite (gl-moveend, view-change)', async ({ app, page }) => {
    test.slow();
    const { map, canvas, settle, problems } = await open3d(page, app);
    const told = await listen(map, ['view-change']);
    // (Each move's end, as gf-map hears it: gl-moveend.)
    const ends = map.locator('.gf-map-root');
    await ends.evaluate(r => { /** @type {any} */ (r).ends = 0; r.addEventListener('gl-moveend', () => { /** @type {any} */ (r).ends++; }); });
    const from = (await settle()).center;
    // A flight of the 2D map (4 s, some 4 km), stopped some 300 m on its way: its last view a move's end alone (no
    // movestart, no zoomend: the same centre, the same zoom).
    await map.evaluate(m => new Promise(done => {
      const lf = /** @type {any} */ (m).gl.lf, start = lf.getCenter();
      lf.flyTo([45.752, 3.049], 15, { duration: 4 });
      const step = () => { if (lf.getCenter().distanceTo(start) < 300) requestAnimationFrame(step); else { lf.stop(); done(true); } };
      requestAnimationFrame(step);
    }));
    const stopped = await settle();
    expect(near(stopped.center, from, 1e-3)).toBe(false);
    expect(near(stopped.center, [3.049, 45.752], 1e-2)).toBe(false);
    await ends.evaluate(r => { /** @type {any} */ (r).ends = 0; });

    // Moved in 3D by itself (no gesture handing the 2D map a movestart): the 2D map there too (within a pixel of
    // it), the move's end told once.
    await map.evaluate(m => /** @type {any} */ (m).gl.glMap.panBy([150, 80], { duration: 0 }));
    const moved = await settle();
    const flat = await map.evaluate(m => /** @type {any} */ (m).center());
    expect(near(flat, moved.center, 2e-4)).toBe(true);
    expect(near(flat, stopped.center, 1e-3)).toBe(false);
    expect(await ends.evaluate(r => /** @type {any} */ (r).ends)).toBe(1);

    // Turned by hand (the wheel pressed: MapLibre's jumps, no movestart handed either): its view told (the view it
    // rests at last — a slow machine may end the gesture, then its inertia, as two moves).
    await wheelTurn(page, canvas, 40);
    const st = await settle();
    await expect.poll(async () => Math.round((await told())['view-change'].at(-1)?.bearing ?? NaN)).toBe(st.bearing);

    // Stopped again, a reference set within that frame (the flight not yet known over: its next step could come): the
    // view centred on it all the same, once that is known — the 2D map there too.
    const ref = await map.evaluate(m => new Promise(done => {
      const g = /** @type {any} */ (m), lf = g.gl.lf, start = lf.getCenter();
      lf.flyTo([45.79, 3.11], 15, { duration: 4 });
      const step = () => {
        if (lf.getCenter().distanceTo(start) < 300) { requestAnimationFrame(step); return; }
        lf.stop();
        const c = lf.getCenter(), at = [c.lng + 0.01, c.lat + 0.005];
        g.showPoint(at);
        done(at);
      };
      requestAnimationFrame(step);
    }));
    const centred = await settle();
    expect(near(centred.center, ref, 1e-4)).toBe(true);
    expect(near(await map.evaluate(m => /** @type {any} */ (m).center()), ref, 1e-4)).toBe(true);
    expect(problems).toEqual([]);
  });

  test('« Me localiser » ne reprend pas la vue : ni le repère confirmé, ni un tour autour de lui', async ({ app, page }) => {
    test.slow();
    // The GPS, from here: each fix given by the test.
    await page.addInitScript(() => {
      /** @type {PositionCallback[]} */ const watchers = [];
      /** @type {GeolocationPosition | null} */ let last = null;
      navigator.geolocation.watchPosition = ok => { watchers.push(ok); if (last) ok(last); return watchers.length; };
      navigator.geolocation.getCurrentPosition = ok => { if (last) ok(last); };
      navigator.geolocation.clearWatch = () => {};
      /** @type {any} */ (window).gfFix = (/** @type {number} */ lat, /** @type {number} */ lon) => {
        last = /** @type {any} */ ({ coords: { latitude: lat, longitude: lon, accuracy: 5 }, timestamp: Date.now() });
        for (const ok of watchers) ok(/** @type {GeolocationPosition} */ (last));
      };
    });
    const { map, canvas, settle, problems } = await open3d(page, app);
    const fix = (/** @type {number} */ lat, /** @type {number} */ lon) => page.evaluate(([y, x]) => /** @type {any} */ (window).gfFix(y, x), [lat, lon]);
    const locate = map.getByRole('button', { name: 'Me localiser' });
    await fix(45.7772, 3.087);
    await locate.click();
    await expect(locate).toHaveAttribute('aria-pressed', 'true');
    await settle();

    // Followed, a long press confirmed: the view on the reference — the next fix leaves it there.
    await press(page, map, canvas, 0.3, 0.35);
    await page.keyboard.press('Enter');
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    let st = await settle();
    expect(near(st.center, st.reference, 1e-4)).toBe(true);
    await expect(locate).toHaveAttribute('aria-pressed', 'false');
    await fix(45.7775, 3.0874);
    await page.waitForTimeout(1000);
    st = await settle();
    expect(near(st.center, st.reference, 1e-4)).toBe(true);

    // Followed again (the view on the position), then a turn around the reference: it moves the centre by hand — the
    // next fix leaves the view where the turn left it.
    await locate.click();
    await expect(locate).toHaveAttribute('aria-pressed', 'true');
    st = await settle();
    expect(near(st.center, [3.0874, 45.7775], 1e-4)).toBe(true);
    await wheelTurn(page, canvas, 40);
    st = await settle();
    await expect(locate).toHaveAttribute('aria-pressed', 'false');
    await fix(45.7778, 3.0878);
    await page.waitForTimeout(1000);
    const after = await settle();
    expect(near(after.center, st.center, 1e-6)).toBe(true);
    expect(after.bearing).toBe(st.bearing);
    expect(problems).toEqual([]);
  });

  test('le lent tour des Observations autour d’un lieu tourne autour de son cercle, pas du repère', async ({ app, page }) => {
    test.slow();
    await answerObservations(page);
    // Its place (a plant in it), near the middle of the view.
    let placeId = '';
    const { map, canvas, gl, settle, problems } = await open3d(page, app, {}, 14, null, async () => {
      placeId = await page.evaluate(async () => {
        const col = await import('/app/core/collections.js');
        let p = col.newPlace([3.0890, 45.7790], { name: 'Jardin Lecoq' });
        p = col.withPlant(p, { id: 1, scientificName: 'Urtica dioica' }, { coordinates: [3.0892, 45.7791], accuracy: 5 });
        await col.savePlace(p);
        return p.id;
      });
    });
    // A reference far from it (a corner of the view), confirmed.
    await press(page, map, canvas, 0.88, 0.15);
    await page.keyboard.press('Enter');
    await expect(map.locator('.gf-gl-mk .gf-ref:not(.ghost)')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(map.locator('gf-point-card')).toHaveCount(0);
    await settle();
    // The observations around, then « Centrer ici » (no longer around the reference: the view's centre).
    const button = map.getByRole('button', { name: 'Observations autour', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await gl()).obs3d.points, SLOW).toBeGreaterThan(0);
    await map.locator('.gf-o3-chip').click();
    await map.locator('.gf-o3-panel').getByRole('button', { name: 'Centrer ici' }).click();
    await expect.poll(async () => (await gl()).obs3d.why).toBe('view');
    await map.locator('.gf-o3-chip').click();
    await settle();
    // The place selected (as the Carte does): its circle, a flight there, then the slow turn of 30° (9 s).
    // (Filmed from then on, its centre on the screen with the camera.)
    await film(map, [3.0890, 45.7790]);
    await map.evaluate((m, id) => { /** @type {any} */ (m).selectedId = id; }, placeId);
    await expect.poll(async () => (await gl()).obs3d.why).toBe('place');
    // Once flown there (1.8 s) and turning: the circle's centre stays near the middle — a turn about the reference,
    // some 500 px away, would carry it some 90 px in 3 s.
    const s0 = await framed(map), s1 = await later(map, s0, 3000);
    expect(turned(s0.bearing, s1.bearing)).toBeGreaterThan(4);
    expect(apart(s1.at, s0.at)).toBeLessThan(20);
    expect(problems).toEqual([]);
  });
});
