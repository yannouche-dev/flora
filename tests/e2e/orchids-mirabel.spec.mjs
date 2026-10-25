// Les orchidées de la colline de Mirabel (#/app/orchidees): its start screen (« Commencer »), then the map — the hill at
// Ménétrol, 500 m around, only the orchids asked of iNaturalist (its taxon 47217) and of GBIF (its key 7689), every
// observation of them in the circle whose point is where the plant was on the map and in the list, by orchid (one
// named to the genus only, or above it, said so) —; the light filters (genus, protection and statuses, a name)
// narrowing the map and the list together, kept after a reload; an observation touched (its row, its point) opening
// the simple sheet, the focus in it — « Médias » (its image, in the address) and the rubric « L'essentiel » only, as
// the Épuré sheet orders and titles it —, beside the map on a wide screen (its plant still named when the filters
// leave it out), over it on a phone (the screen under it out of reach), Échap closing it even from the viewer (the
// focus back on its row); over the start screen, the same simple sheet; the radius from stop to stop, the circle
// moved by a long press and brought back; a source down, none, offline (asked again when back), nothing observed,
// more than the map holds, both modules off, photos off: said, « Réessayer » when it may help, the focus kept on the
// screen; « Quitter » back to the list, and nothing of the app changed at any point (mode, harvest mode, sheet layout,
// any key but its own). No violation (axe).
import { test, expect, plantId, answerOrchids } from './fixtures.mjs';
import { longPress } from './touch.mjs';
import { mapSaid } from './quiet.mjs';
import { AXE, TAGS } from '../../tools/axe-rules.mjs';

test.use({ reducedMotion: 'reduce' });

/** @typedef {import('@playwright/test').Page} Page */

/** @param {Page} page */
const hash = page => page.evaluate(() => location.hash);
/** @param {Page} page */
const screen = page => page.locator('ma-orchids');
/** The orchids of the list, by their names as shown. @param {Page} page */
const names = page => screen(page).locator('ul > li .names b').allTextContents();
/** The circle on the map and its points' plants. @param {Page} page */
const area = page => screen(page).locator('gf-map').evaluate(m => {
  const a = /** @type {any} */ (m).area;
  return { center: a?.center, radius: a?.radius, n: a?.points.length, sci: [...new Set(a?.points.map((/** @type {any} */ p) => p.sci))].sort() };
});
/** The observations drawn on the map (each its plant's photo, or a leaf). @param {Page} page */
const dots = page => screen(page).locator('gf-map .leaflet-marker-pane .gf-obs-leaf');
/** A chip of the filters, by its label. @param {Page} page @param {string} label */
const chip = (page, label) => screen(page).locator('.chips button').filter({ hasText: label });
/** An orchid of the list, by its name as shown (exactly). @param {Page} page @param {string} name */
const row = (page, name) => screen(page).locator('ul > li').filter({ has: page.locator('.names b').getByText(name, { exact: true }) });
/** How many observations and orchids, said. */
const ALL = '10 observations · 4 orchidées et 2 non identifiées à l’espèce';
/** The observations left out for their point (an iNaturalist one obscured, a GBIF one within 2 km). */
const VAGUE = '2 observations à la position masquée ou plus large que le cercle : pas sur la carte.';

/**
 * What the app keeps on the device but this activity's own keys (and the shared cache's purge date; of the backup of
 * Mes plantes, what it holds, not when it was written; of the first steps, all but the plants seen — every activity
 * counts the plants it opens there, on purpose: seen()): to compare before and after it, nothing else changed.
 * @param {Page} page
 */
const footprint = page => page.evaluate(() => {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = /** @type {string} */ (localStorage.key(i));
    if (!k.startsWith('geoflora.') || k.startsWith('geoflora.app.orchidees.') || k === 'geoflora.cachePurgedAt') continue;
    const v = localStorage.getItem(k);
    out[k] = k === 'geoflora.backup' ? JSON.parse(v || 'null')?.features
      : k === 'geoflora.discover' ? { ...JSON.parse(v || '{}'), seen: undefined } : v;
  }
  return out;
});

/** The plants counted as seen by the first steps (every activity counts the plants it opens). @param {Page} page */
const seen = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.discover') || '{}').seen || []);

/** The addresses of the observations asked of iNaturalist and GBIF, as the page asked them. @param {Page} page */
function asked(page) {
  /** @type {URL[]} */
  const urls = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if ((u.host === 'api.inaturalist.org' && u.pathname.startsWith('/v1/observations')) || (u.host === 'api.gbif.org' && u.pathname === '/v1/occurrence/search')) urls.push(u);
  });
  return urls;
}

/** From its start screen, « Commencer »: the map. @param {Page} page */
async function begin(page) {
  await page.locator('gf-miniapp .start .go').click();
  await expect.poll(() => hash(page)).toBe('#/app/orchidees/map');
}

test('le départ, puis la carte : la colline de Mirabel à 500 m, seules les orchidées demandées, toutes leurs observations ; « Quitter » ramène à la liste, rien de l’app changé', async ({ app, page }) => {
  await answerOrchids(page);
  const urls = asked(page);
  await app.open('#/discover');
  const before = await footprint(page);
  const [mode, harvest] = [await app.state('mode'), await app.state('harvestMode')];
  await page.locator('gf-launcher[page]').getByRole('button', { name: 'Commencer : Orchidées de Mirabel' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/orchidees/start');
  await expect(page.getByRole('heading', { level: 1, name: 'Les orchidées de la colline de Mirabel' })).toBeVisible();
  await expect(page.locator('gf-miniapp .start .lead')).toHaveText('À Ménétrol (Puy-de-Dôme), toutes les orchidées observées, sur la carte ; touchez-en une : ses photos et l’essentiel.');
  await expect(page.locator('gf-miniapp .start .note')).toHaveText('Observations d’iNaturalist et de GBIF ; votre position n’est pas demandée.');
  await expect(page.locator('gf-miniapp .start .go')).toHaveText('Commencer');
  await expect(page.locator('gf-miniapp .start .leave')).toHaveText('Autres activités');
  await expect(page.locator('gf-miniapp .quit')).toHaveAttribute('aria-label', 'Quitter l’activité');
  await begin(page);

  // The screen's title in focus; how many, said; the circle and its ten observations (two beyond it left out, and two
  // in it whose point is not where the plant was: said).
  await expect(screen(page).getByRole('heading', { level: 1, name: 'Les orchidées de la colline de Mirabel' })).toBeFocused();
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  await expect(screen(page).locator('.note')).toHaveText(VAGUE);
  await expect(screen(page).locator('.where')).toContainText('Colline de Mirabel, Ménétrol (Puy-de-Dôme)');
  await expect(screen(page).locator('.radius b')).toHaveText('500 m');
  expect(await area(page)).toEqual({ center: [3.111, 45.869], radius: 500, n: 10,
    sci: ['Dactylorhiza brennensis', 'Epipactis leptochila', 'Ophrys', 'Ophrys holosericea', 'Orchidaceae', 'Traunsteinera globosa'] });
  await expect(dots(page)).toHaveCount(10);
  // Only the orchids, of both sources, around the hill: never a question for every plant.
  expect(urls.length).toBeGreaterThanOrEqual(3);
  for (const u of urls.filter(x => x.host === 'api.inaturalist.org')) {
    expect([u.searchParams.get('taxon_id'), u.searchParams.get('lat'), u.searchParams.get('lng'), u.searchParams.get('radius'), u.searchParams.get('quality_grade')])
      .toEqual(['47217', '45.86900', '3.11100', '0.50', null]);
  }
  const gbif = urls.filter(x => x.host === 'api.gbif.org');
  expect(gbif.length).toBeGreaterThan(0);
  for (const u of gbif) expect([u.searchParams.get('taxonKey'), u.searchParams.get('geoDistance')]).toEqual(['7689', '45.8690,3.1110,0.50km']);

  // The orchids, the most observed first; each its observations, what protects it here; one named to the genus only
  // (« Ophrys L. » for GBIF: its name without its author), one to the family only: no sheet, said why.
  expect(await names(page)).toEqual(['Ophrys bourdon', 'Traunsteinère globuleuse', 'Dactylorhize de la Brenne', 'Épipactide à labelle étroit', 'Ophrys', 'Orchidées']);
  const traun = row(page, 'Traunsteinère globuleuse');
  await expect(traun).toContainText('3 obs. iNat.');
  await expect(traun.locator('.tag')).toHaveText(['Protégée (Auvergne)', 'Liste rouge : vulnérable (Auvergne)']);
  await expect(row(page, 'Ophrys bourdon')).toContainText('3 obs. (2 iNat., 1 GBIF)');
  await expect(row(page, 'Ophrys').locator('button')).toHaveCount(0);
  await expect(row(page, 'Ophrys').locator('.none')).toHaveText('pas de fiche : identifiée au genre seulement');
  await expect(row(page, 'Orchidées').locator('.none')).toHaveText('pas de fiche : genre non précisé');

  // « Quitter »: back to the list; nothing of the app changed — its mode, the harvest mode, the sheet's layout, any key.
  await page.locator('gf-miniapp .quit').click();
  await expect.poll(() => hash(page)).toBe('#/discover');
  expect([await app.state('mode'), await app.state('harvestMode')]).toEqual([mode, harvest]);
  expect(await footprint(page)).toEqual(before);
});

test('les filtres légers : un genre, une protection, un statut, un nom — la carte et la liste ensemble ; gardés après un rechargement', async ({ app, page }) => {
  await answerOrchids(page);
  await app.open('#/app/orchidees');
  const before = await footprint(page);
  await begin(page);
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  // The genera, counted in observations, the most observed first; « Genre non précisé » last.
  expect((await screen(page).locator('.facet').first().locator('button').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()))
    .toEqual(['Ophrys 4', 'Traunsteinera 3', 'Dactylorhiza 1', 'Epipactis 1', 'Genre non précisé 1']);
  await expect(chip(page, 'Ophrys')).toHaveAttribute('aria-label', 'Ophrys, 4 observations');

  await chip(page, 'Ophrys').click();
  await expect(chip(page, 'Ophrys')).toHaveAttribute('aria-pressed', 'true');
  await expect(screen(page).locator('.count')).toHaveText('4 observations sur 10 · 1 orchidée et 1 non identifiée à l’espèce');
  expect(await names(page)).toEqual(['Ophrys bourdon', 'Ophrys']);
  await expect.poll(async () => (await area(page)).sci).toEqual(['Ophrys', 'Ophrys holosericea']);
  await expect(dots(page)).toHaveCount(4);
  await chip(page, 'Ophrys').click();

  // « Protégée ici »: Traunsteinère alone (protected in Auvergne), its three points; the genera counted among them.
  await chip(page, 'Protégée ici').click();
  expect(await names(page)).toEqual(['Traunsteinère globuleuse']);
  await expect(dots(page)).toHaveCount(3);
  expect((await screen(page).locator('.facet').first().locator('button').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim())).toEqual(['Traunsteinera 3']);
  await chip(page, 'Protégée ici').click();
  await chip(page, 'Liste rouge').click();
  expect(await names(page)).toEqual(['Traunsteinère globuleuse', 'Dactylorhize de la Brenne']);
  await chip(page, 'Liste rouge').click();
  await chip(page, 'Endémique').click();
  expect(await names(page)).toEqual(['Dactylorhize de la Brenne']);
  // « Effacer les filtres », gone as it is pressed: the focus on the search, not lost.
  const search = screen(page).getByRole('searchbox', { name: 'Chercher une orchidée par son nom' });
  await screen(page).getByRole('button', { name: 'Effacer les filtres' }).press('Enter');
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  await expect(search).toBeFocused();

  // A name, case and accents aside: French or scientific.
  await search.fill('epipactide');
  expect(await names(page)).toEqual(['Épipactide à labelle étroit']);
  await expect(dots(page)).toHaveCount(1);
  await search.fill('OPHRYS HOLO');
  expect(await names(page)).toEqual(['Ophrys bourdon']);
  await search.fill('rien de tel');
  await expect(screen(page).locator('.empty')).toContainText('Aucune orchidée ne répond à ces filtres.');
  await expect(dots(page)).toHaveCount(0);
  await screen(page).locator('.empty').getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();

  // Kept on the device: after a reload, the genus chosen still is.
  await chip(page, 'Traunsteinera').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.app.orchidees.state') || 'null')?.ctx?.genera)).toEqual(['Traunsteinera']);
  await page.reload();
  await app.ready();
  await expect(chip(page, 'Traunsteinera')).toHaveAttribute('aria-pressed', 'true');
  expect(await names(page)).toEqual(['Traunsteinère globuleuse']);
  expect(await footprint(page)).toEqual(before);
});

test('une observation touchée : sa fiche simple, le focus dedans — « Médias » (son image dans l’adresse) et « L’essentiel » seulement ; Échap la ferme, même depuis la visionneuse, le focus revient ; un point aussi ; sur l’écran de départ, la même', async ({ app, page }) => {
  await answerOrchids(page);
  await app.open('#/app/orchidees');
  const before = await footprint(page);
  await begin(page);
  const id = plantId('Traunsteinera globosa');
  const traun = screen(page).locator(`button.row[data-id="${id}"]`);
  await traun.click();
  await expect.poll(() => hash(page)).toBe(`#/app/orchidees/map?p=${id}`);
  const sheet = page.locator('ma-orchids ma-plant-sheet .sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.sheet-head strong')).toHaveText('Traunsteinère globuleuse');
  await expect(sheet.locator('.sheet-head button')).toHaveAttribute('aria-label', 'Fermer la fiche');
  // The focus in it, on what it shows (named after its plant); on a phone, the screen under it out of reach.
  await expect(sheet.locator('.simple')).toBeFocused();
  await expect(sheet.locator('.simple')).toHaveAttribute('aria-label', 'Traunsteinère globuleuse : médias et l’essentiel');
  expect(await screen(page).locator('.wrap').getAttribute('inert')).toBe(app.phone ? '' : null);

  // « Médias »: its image (the flora's photo of it); the one shown kept in the address (&m=), and given back to it.
  const viewer = sheet.locator('gf-media-viewer');
  await expect(viewer.getByRole('heading', { level: 2, name: 'Médias' })).toBeVisible();
  await expect(viewer.locator('.count')).toHaveText('1 / 1');
  await expect(viewer.locator('.stage img').first()).toBeVisible();
  await viewer.evaluate(v => v.dispatchEvent(new CustomEvent('media-index', { detail: { index: 2 }, bubbles: true, composed: true })));
  await expect.poll(() => hash(page)).toBe(`#/app/orchidees/map?p=${id}&m=2`);
  await expect(viewer).toHaveJSProperty('index', 2);
  // « L'essentiel »: its blocks alone, as Épuré orders and titles them — nothing else of the sheet.
  await expect(sheet.getByRole('heading', { level: 2, name: 'L’essentiel' })).toBeVisible();
  expect(await sheet.locator('gf-plant-detail').evaluateAll(els => els.map(el => el.getAttribute('only')))).toEqual(['name', 'names', 'taxonomy', 'ids']);
  await expect(sheet.locator('gf-plant-detail[only="name"]').getByRole('heading', { level: 2, name: 'Traunsteinère globuleuse' })).toBeVisible();
  // On a phone, the sheet is the screen: its plant's name the screen's title (under the panel's beside the map).
  await expect(sheet.locator('.sheet-head').getByRole('heading', { level: 1 })).toHaveCount(app.phone ? 1 : 0);
  await expect(sheet.locator('gf-plant-detail').getByRole('heading', { level: 3 })).toHaveText(['Noms', 'Classification', 'Identifiants']);
  await expect(sheet.locator('gf-media-viewer')).toHaveCount(1);
  await expect(sheet.locator('gf-add-to')).toHaveCount(0);
  // ‹ Préc. / Suivante ›: the orchids of the list that have a sheet.
  await expect(sheet.locator('.pager span')).toHaveText('2 / 4');
  if (!app.phone) {
    // Beside the map: the map keeps clear of it.
    await expect(screen(page)).toHaveAttribute('sheet', '');
    const [m, s] = [await screen(page).locator('.map').boundingBox(), await sheet.boundingBox()];
    expect(/** @type {any} */ (m).x + /** @type {any} */ (m).width).toBeLessThanOrEqual(/** @type {any} */ (s).x + 2);
    // A filter beside it that leaves its plant out: the sheet still names it, still among the plants it steps through.
    await chip(page, 'Ophrys').click();
    await expect(screen(page).locator('.panel .count')).toHaveText('4 observations sur 10 · 1 orchidée et 1 non identifiée à l’espèce');
    await expect(sheet.locator('.sheet-head strong')).toHaveText('Traunsteinère globuleuse');
    await expect(sheet.locator('.pager span')).toHaveText('2 / 2');
    await chip(page, 'Ophrys').click();
    await expect(sheet.locator('.pager span')).toHaveText('2 / 4');
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/app/orchidees/map');
  await expect(traun).toBeFocused();

  // A point of the map touched: its plant's sheet too; the viewer touched (its heading), Échap still closes it.
  await chip(page, 'Traunsteinera').click();
  await expect(dots(page)).toHaveCount(3);
  await dots(page).first().click();
  await expect.poll(() => hash(page)).toBe(`#/app/orchidees/map?p=${id}`);
  await expect(sheet.locator('.sheet-head strong')).toHaveText('Traunsteinère globuleuse');
  await expect(sheet.locator('.simple')).toBeFocused();
  await viewer.getByRole('heading', { level: 2, name: 'Médias' }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/app/orchidees/map');
  await expect(traun).toBeFocused();
  // A link to a plant, no step named: the map, its simple sheet over it.
  await app.go(`#/app/orchidees?p=${plantId('Ophrys holosericea')}`);
  await expect.poll(() => hash(page)).toBe(`#/app/orchidees/map?p=${plantId('Ophrys holosericea')}`);
  await expect(sheet.locator('.sheet-head strong')).toHaveText('Ophrys bourdon');
  await expect(sheet.locator('gf-plant-detail:not([only])')).toHaveCount(0);
  // The start named with a plant (« Départ » from the steps bar, its sheet open): the start screen, the same simple sheet.
  await app.go(`#/app/orchidees/start?p=${id}`);
  const over = page.locator('gf-miniapp .body > ma-plant-sheet .sheet');
  await expect(over.locator('.sheet-head strong')).toHaveText('Traunsteinère globuleuse');
  await expect(over.locator('.simple gf-media-viewer')).toHaveCount(1);
  await expect(over.locator('gf-plant-detail:not([only])')).toHaveCount(0);
  await over.getByRole('button', { name: 'Fermer la fiche' }).click();
  await expect(over).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/app/orchidees/start');
  await expect(page.locator('gf-miniapp .start .go')).toBeVisible();
  // Nothing of the app changed: the user's sheet layout, any key.
  expect(await footprint(page)).toEqual(before);
});

test('la fiche simple suit la fiche Épurée de l’appareil — l’ordre de « L’essentiel », ses blocs pliés, ses titres —, sans l’écrire', async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('geoflora.sheetLayout',
    JSON.stringify({ order: { epure: ['name', 'taxonomy', 'names', 'ids'] }, hidden: { epure: ['media', 'web', 'ids'] }, titleShown: { epure: { taxonomy: false } } })));
  await answerOrchids(page);
  await app.open('#/app/orchidees');
  const before = await footprint(page);
  await begin(page);
  await screen(page).locator(`button.row[data-id="${plantId('Traunsteinera globosa')}"]`).click();
  const sheet = page.locator('ma-orchids ma-plant-sheet .sheet');
  // « Médias » whatever Épuré does of it (folded there: its large photo instead); its rubric as this device has it.
  await expect(sheet.locator('gf-media-viewer')).toHaveCount(1);
  await expect.poll(() => sheet.locator('gf-plant-detail').evaluateAll(els => els.map(el => el.getAttribute('only')))).toEqual(['name', 'taxonomy', 'names']);
  await expect(sheet.locator('gf-plant-detail').getByRole('heading', { level: 3 })).toHaveText(['Noms']);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await footprint(page)).toEqual(before);
  // The plant opened, counted as seen, as every activity does.
  expect(await seen(page)).toContain(plantId('Traunsteinera globosa'));
});

test('le rayon d’arrêt en arrêt ; un appui long recentre le cercle, « Revenir à la colline » le ramène ; rien de l’app changé', async ({ app, page }) => {
  await answerOrchids(page);
  const urls = asked(page);
  await app.open('#/app/orchidees');
  const before = await footprint(page);
  await begin(page);
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  const slider = screen(page).getByRole('slider', { name: 'Rayon du cercle' });
  await expect(slider).toHaveAttribute('aria-valuetext', '500 mètres');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(screen(page).locator('.radius b')).toHaveText('1 km');
  await expect.poll(async () => (await area(page)).radius).toBe(1000);
  await expect.poll(() => urls.some(u => u.host === 'api.inaturalist.org' && u.searchParams.get('radius') === '1.00' && u.searchParams.get('taxon_id') === '47217')).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(screen(page).locator('.radius b')).toHaveText('500 m');

  // A long press, « Chercher autour d’ici ? », confirmed: the circle there, its orchids asked around it.
  const map = screen(page).locator('gf-map');
  const leaflet = map.locator('.leaflet-container');
  await expect(map).toHaveAttribute('aria-description', 'Appui long sur la carte, puis « Confirmer » : le cercle s’y centre.');
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await leaflet.boundingBox());
  const [x, y] = [Math.round(box.x + box.width * 0.3), Math.round(box.y + box.height * 0.3)];
  if (app.phone) await longPress(page, x, y);
  else await page.mouse.click(x, y, { button: 'right' });
  const card = map.locator('gf-point-card');
  await expect(card.getByRole('heading', { name: 'Chercher autour d’ici ?' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Créer un lieu ici' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(mapSaid(map)).toContainText('Repère posé : la zone s’y centre.');
  await expect(screen(page).locator('.where')).toContainText('Autour du point choisi sur la carte');
  const moved = /** @type {number[]} */ ((await area(page)).center);
  expect(moved[0]).toBeLessThan(3.111);
  expect(moved[1]).toBeGreaterThan(45.869);
  await expect.poll(() => urls.some(u => u.host === 'api.inaturalist.org' && u.searchParams.get('lat') === moved[1].toFixed(5))).toBe(true);
  await expect(screen(page).locator('.count')).toHaveText(ALL);

  // « Revenir à la colline », a target of its own (a phone too); gone as it is pressed: the focus on the screen's title.
  const home = screen(page).getByRole('button', { name: 'Revenir à la colline' });
  expect(/** @type {{ height: number }} */ (await home.boundingBox()).height).toBeGreaterThanOrEqual(app.phone ? 44 : 32);
  await home.press('Enter');
  await expect(screen(page).locator('.where')).toContainText('Colline de Mirabel, Ménétrol (Puy-de-Dôme)');
  expect((await area(page)).center).toEqual([3.111, 45.869]);
  await expect(home).toHaveCount(0);
  await expect(screen(page).locator('#or-title')).toBeFocused();
  // The radius, the circle, moved and back: the activity's own (Carte › Autour's radius untouched), nothing else.
  expect(await footprint(page)).toEqual(before);
});

test('une source en panne, toutes, hors ligne, rien d’observé : dit, et « Réessayer » ; la connexion revenue, demandé à nouveau', async ({ app, page }) => {
  // No answer at all (every outside request 503: fixtures.mjs), then offline.
  await app.open('#/app/orchidees');
  await begin(page);
  const alert = screen(page).locator('.alert');
  await expect(alert).toContainText('iNaturalist et GBIF ne répondent pas : les observations ne sont pas disponibles pour le moment.');
  await expect(screen(page).locator('ul')).toHaveCount(0);
  await page.context().setOffline(true);
  // « Réessayer », gone as it is pressed: the focus on the screen's title.
  await alert.getByRole('button', { name: 'Réessayer' }).press('Enter');
  await expect(alert).toContainText('Hors ligne : les observations d’iNaturalist et de GBIF viendront avec la connexion.');
  await expect(screen(page).locator('#or-title')).toBeFocused();
  // The connection back (GBIF down meanwhile): asked again at once, no « Réessayer » needed; iNaturalist's alone, said.
  await answerOrchids(page, { gbif: false });
  await page.context().setOffline(false);
  await expect(screen(page).locator('.count')).toHaveText('7 observations · 3 orchidées et 1 non identifiée à l’espèce');
  await expect(screen(page).locator('.note')).toHaveText(['GBIF ne répond pas : les observations d’iNaturalist seules.',
    '1 observation à la position masquée ou plus large que le cercle : pas sur la carte.']);
  // Nothing observed in the circle: said, and how to look further.
  await answerOrchids(page, { none: true });
  await screen(page).getByRole('slider', { name: 'Rayon du cercle' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(screen(page).locator('.count')).toHaveText('Aucune orchidée observée dans ce cercle.');
  await expect(screen(page).locator('.empty')).toHaveText('Agrandissez le cercle, ou centrez-le ailleurs : appui long sur la carte.');
  await expect(dots(page)).toHaveCount(0);
});

test('plus d’observations que la carte n’en montre : dit, pour chaque source', async ({ app, page }) => {
  await answerOrchids(page, { totals: { inat: 1234, gbif: 456 } });
  await app.open('#/app/orchidees/map');
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  await expect(screen(page).locator('.note')).toHaveText(['iNaturalist en compte 1 234 : les 1 000 plus récentes sont sur la carte.',
    'GBIF en compte 456 : 300 sont sur la carte.', VAGUE]);
});

test('les modules iNaturalist et GBIF coupés : dit au départ, « Commencer » éteint, la carte sans « Réessayer » ; « Photos en ligne » coupé : dit dans la fiche', async ({ app, page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('gf-mod')) { sessionStorage.setItem('gf-mod', '1'); localStorage.setItem('geoflora.modules', JSON.stringify({ inaturalist: false, gbif: false })); } });
  await answerOrchids(page);
  await app.open('#/app/orchidees');
  await expect(page.locator('gf-miniapp .start .alert'))
    .toHaveText('« iNaturalist » et « GBIF » sont désactivés dans Réglages › Modules : Orchidées de Mirabel en a besoin.');
  await expect(page.locator('gf-miniapp .start .go')).toBeDisabled();
  await app.go('#/app/orchidees/map');
  const alert = screen(page).locator('.alert');
  await expect(alert).toHaveText('Les modules iNaturalist et GBIF sont désactivés (Réglages › Modules) : aucune observation à montrer.');
  await expect(alert.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);

  // The sources back, « Photos en ligne » off: the sheet says it in place of its « Médias ».
  await page.evaluate(() => localStorage.setItem('geoflora.modules', JSON.stringify({ photos: false })));
  await page.reload();
  await app.ready();
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  await screen(page).locator(`button.row[data-id="${plantId('Traunsteinera globosa')}"]`).click();
  const sheet = page.locator('ma-orchids ma-plant-sheet .sheet');
  await expect(sheet.locator('.simple .off')).toHaveText('Médias : Photos en ligne désactivées (Réglages › Modules).');
  await expect(sheet.locator('gf-media-viewer')).toHaveCount(0);
  await expect(sheet.getByRole('heading', { level: 2, name: 'L’essentiel' })).toBeVisible();
});

/**
 * The app's own components that axe already finds fault with on its main screens (tools/axe-baseline.json, the plant
 * sheet and the Carte): the map's compass (target-size), the media viewer's caption and its quality dot
 * (color-contrast, aria-prohibited-attr) — theirs, not this screen's.
 */
const KNOWN = [/^target-size: .* > \.gf-compass$/, /^(color-contrast|aria-prohibited-attr): .* > gf-media-viewer > /];

/** What axe-core finds on the page (WCAG 2.x A and AA, best practices: tools/axe-rules.mjs), the known ones aside. @param {Page} page */
async function axe(page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE);
  const found = await page.evaluate(async tags => {
    const r = await /** @type {any} */ (window).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.flatMap((/** @type {any} */ v) => v.nodes.map((/** @type {any} */ n) => `${v.id}: ${n.target.flat().join(' > ')}`));
  }, TAGS);
  return found.filter(v => !KNOWN.some(k => k.test(v)));
}

test('accessibilité : l’écran de départ, la carte et ses filtres, la fiche simple — sans violation (axe)', async ({ app, page }) => {
  await answerOrchids(page);
  await app.open('#/app/orchidees');
  await expect(page.locator('gf-miniapp .start .go')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await begin(page);
  await expect(screen(page).locator('.count')).toHaveText(ALL);
  await chip(page, 'Ophrys').click();
  expect(await axe(page)).toEqual([]);
  await screen(page).locator(`button.row[data-id="${plantId('Ophrys holosericea')}"]`).click();
  await expect(page.locator('ma-plant-sheet .sheet gf-plant-detail[only="name"]').getByRole('heading', { name: 'Ophrys bourdon' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
