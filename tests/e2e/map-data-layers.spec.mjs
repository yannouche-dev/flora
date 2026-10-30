// « Sur cette carte » (gf-map-options.js, in the panel ▦ of a map, right after « Fond »): the layers of data a page
// draws on its map, each its page's own setting — the same as its other controls say it, both ways. The Carte: the
// GBIF distribution of the one plant filtered (its tiles asked, kept), my places (hidden, kept — but the place opened,
// its ✎ with it), the plants observed around (the bar's « Autour »); a plant sheet's map: its distribution (France, the
// world, none: its chips, its ⚙), my places, the observations near me from iNaturalist and GBIF (asked as by their
// chips), the look-alike compared (its chip's ✕; its row gone, the focus on the one above); a free layout's map: its
// points' sources (src=: GBIF's fetched for the whole group) and the current plant's (plante=), written in the address
// and read from it. Réglages › Cartes has none. Every service answered here (fixtures.mjs, tiles.mjs).
import { test, expect, answerAround, answerPlantNear, answerZoneGbif, plantId } from './fixtures.mjs';
import { layoutOf } from './app.mjs';
import { answerTiles } from './tiles.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await answerTiles(page);
});

const AT = 'at=48.85,2.35';

/** A map's panel ▦, open. @param {Locator} map */
async function openPanel(map) {
  await map.evaluate(m => /** @type {any} */ (m).openPanel());
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Affichage' })).toBeVisible();
  return panel;
}

/** The panel closed (its ✕). @param {Locator} panel */
async function closePanel(panel) {
  await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(panel).toBeHidden();
}

/** The headings shown in a panel, top first (as laid out: across the shadow roots of its parts). @param {Locator} panel */
const headings = panel => panel.getByRole('heading').evaluateAll(hs => hs.map(h => /** @type {[number, string]} */ ([h.getBoundingClientRect().top, (h.textContent || '').trim()]))
  .sort((a, b) => a[0] - b[0]).map(([, text]) => text));

/** « Sur cette carte »: its rows, a group named by its heading. @param {Locator} panel */
const onThisMap = panel => panel.getByRole('group', { name: 'Sur cette carte' });

/** A key kept on the device. @param {Page} page @param {string} key */
const kept = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);


/** A plant sheet's map block's settings as kept (core/sheet-blocks.js mapConfig). @param {Page} page */
const sheetConfig = page => page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).mapConfig('map'));

/** One of my places, the nettle noted in it: its id. @param {Page} page @param {[number, number]} at @param {string} [name] */
function seedPlace(page, at, name = 'Jardin des Plantes') {
  return page.evaluate(async ([where, id, called]) => {
    const col = await import('/app/core/collections.js');
    let p = col.newPlace(where, { name: called });
    p = col.withPlant(p, { id, scientificName: 'Urtica dioica' }, { coordinates: [where[0] + 0.0002, where[1] + 0.0001], accuracy: 5 });
    await col.savePlace(p);
    return p.id;
  }, /** @type {[[number, number], number, string]} */ ([at, plantId('Urtica dioica'), name]));
}

test('la Carte : « Sur cette carte » après « Fond » — la répartition GBIF de la plante filtrée, mes lieux, les plantes observées autour, chacun comme ses autres commandes', async ({ app, page }) => {
  await answerPlantNear(page);
  /** @type {string[]} */ const asked = [];
  page.on('request', r => { if (/^https:\/\/api\.gbif\.org\/v2\/map\/occurrence\//.test(r.url())) asked.push(r.url()); });
  await app.open('#/collections');
  await seedPlace(page, [2.3505, 48.8505]);
  await app.go(`#/map?plant=${plantId('Urtica dioica')}`);
  const carte = page.locator('gf-map-page');
  const map = carte.locator('gf-map');
  const markers = map.locator('.leaflet-marker-pane .leaflet-marker-icon');
  await expect(markers.first()).toBeAttached();
  const around = carte.locator('.bar .around-toggle');

  let panel = await openPanel(map);
  expect((await headings(panel)).slice(0, 5)).toEqual(['Carte', 'Affichage', 'Fond', 'Sur cette carte', 'Couches affichées']);
  let data = onThisMap(panel);
  // The plant filtered found in GBIF: its distribution offered first, off.
  const distribution = data.getByRole('checkbox', { name: /^Répartition GBIF : / });
  await expect(distribution).not.toBeChecked();
  await expect(data.getByRole('checkbox')).toHaveCount(3);
  await expect(data.getByRole('checkbox', { name: /^Mes lieux/ })).toBeChecked();
  await expect(data.getByRole('checkbox', { name: /^Mes lieux/ })).toHaveAccessibleName(/1 lieu, et leurs plantes/);
  await expect(data.getByRole('checkbox', { name: /^Plantes observées autour/ })).not.toBeChecked();

  // The distribution: its tiles asked for this plant, drawn, kept with the maps' look; off, gone.
  await distribution.check();
  await expect(map.locator('.gf-tiles-gbif')).toHaveCount(1);
  await expect.poll(() => asked.some(u => u.includes('taxonKey=5341'))).toBe(true);
  await expect.poll(async () => (await kept(page, 'geoflora.mapLayer'))?.distribution).toBe(true);
  await distribution.uncheck();
  await expect(map.locator('.gf-tiles-gbif')).toHaveCount(0);
  await expect.poll(async () => (await kept(page, 'geoflora.mapLayer'))?.distribution).toBe(false);

  // My places hidden: none on the map (the bar still counts them), kept; shown again, the key let go.
  await data.getByRole('checkbox', { name: /^Mes lieux/ }).uncheck();
  await expect(markers).toHaveCount(0);
  await expect(carte.locator('.bar .count')).toHaveText('1 lieu');
  await expect.poll(() => kept(page, 'geoflora.mapPlaces')).toBe(false);
  await data.getByRole('checkbox', { name: /^Mes lieux/ }).check();
  await expect(markers.first()).toBeAttached();
  await expect.poll(() => kept(page, 'geoflora.mapPlaces')).toBe(null);
  await data.getByRole('checkbox', { name: /^Mes lieux/ }).uncheck();

  // The plants observed around: the bar's « Autour », opened from here, said here.
  await data.getByRole('checkbox', { name: /^Plantes observées autour/ }).check();
  await expect(around).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.said')).toContainText(/Autour : 12 espèces observées/);
  await closePanel(panel);
  await expect(carte.locator('section.sheet.around')).toBeVisible();
  // Closed by the bar's button: unticked there.
  await around.click();
  await expect(carte.locator('section.sheet.around')).toHaveCount(0);
  panel = await openPanel(map);
  data = onThisMap(panel);
  await expect(data.getByRole('checkbox', { name: /^Plantes observées autour/ })).not.toBeChecked();
  await data.getByRole('checkbox', { name: /^Plantes observées autour/ }).check();
  await expect(around).toHaveAttribute('aria-pressed', 'true');
  await data.getByRole('checkbox', { name: /^Plantes observées autour/ }).uncheck();
  await expect(around).toHaveAttribute('aria-pressed', 'false');
  await closePanel(panel);

  // Kept: my places still hidden after a reload; nothing on the map, the row unticked; no ✎ (nothing to move), the
  // panel's « État » says why.
  await page.reload();
  await app.ready();
  await expect(carte.locator('.bar .count')).toHaveText('1 lieu');
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(markers).toHaveCount(0);
  const edit = map.locator('.gf-map-buttons button.edit');
  await expect(edit).toBeHidden();
  const hiddenSaid = 'Mes lieux masqués : seul le lieu ouvert est sur la carte (▦ › Sur cette carte).';
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).statusLines.map((/** @type {any} */ l) => l.text))).toContain(hiddenSaid);
  panel = await openPanel(map);
  await expect(onThisMap(panel).getByRole('checkbox', { name: /^Mes lieux/ })).not.toBeChecked();
  await expect(panel).toContainText(hiddenSaid);
  await closePanel(panel);

  // Hidden, a place opened (a link, the list, Mes plantes): that one on the map beside its sheet, ✎ to move it; not
  // the other. Closed: none again.
  const other = await seedPlace(page, [2.3605, 48.8605], 'Square du Temple');
  const opened = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listPlaces()).find(p => p.properties.name === 'Jardin des Plantes')?.id);
  await app.go(`#/map?spot=${opened}`);
  await expect(carte.locator('.bar .count')).toHaveText('2 lieux');
  const places = map.locator('.leaflet-marker-pane .gf-place');
  await expect(places).toHaveCount(1);
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).spots.map((/** @type {any} */ s) => s.id))).toEqual([opened]);
  await expect(edit).toBeVisible();
  await expect(edit).toBeEnabled();
  await app.go(`#/map?spot=${other}`);
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).spots.map((/** @type {any} */ s) => s.id))).toEqual([other]);
  await expect(places).toHaveCount(1);
  await app.go('#/map');
  await expect(places).toHaveCount(0);
  await expect(edit).toBeHidden();
});

test('la carte d’une fiche : « Sur cette carte » — la répartition (France, Monde, Non), mes lieux, les observations proches iNaturalist et GBIF, le sosie comparé ; comme ses puces et son ⚙, dans les deux sens', async ({ app, page }) => {
  /** @type {string[]} */ const asked = [];
  await answerPlantNear(page, { inat: 6, gbif: 7, seen: asked });
  await app.open('#/collections');
  await seedPlace(page, [2.3505, 48.8505]);
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const block = page.locator('gf-sheet-map:not([map-3d="off"])').first();
  await block.scrollIntoViewIfNeeded();
  const map = block.locator('gf-map');
  const chip = (/** @type {string} */ layer) => block.locator(`.scope [data-layer="${layer}"]`);
  // Its GBIF key known: the distribution in France, as by default.
  await expect(chip('gbif-fr')).toHaveAttribute('aria-pressed', 'true');

  let panel = await openPanel(map);
  expect((await headings(panel)).slice(0, 5)).toEqual(['Carte', 'Affichage', 'Fond', 'Sur cette carte', 'Couches affichées']);
  let data = onThisMap(panel);
  const distribution = data.getByRole('combobox', { name: /^Répartition GBIF/ });
  await expect(distribution).toHaveValue('fr');
  await expect(data.getByRole('checkbox', { name: /^Mes lieux/ })).toBeChecked();
  await expect(data.getByRole('checkbox', { name: /^Mes lieux/ })).toHaveAccessibleName(/1 lieu avec cette plante/);
  const inat = data.getByRole('checkbox', { name: /^Observations proches : iNaturalist/ });
  const gbif = data.getByRole('checkbox', { name: /^Observations proches : GBIF/ });
  await expect(inat).not.toBeChecked();
  await expect(gbif).not.toBeChecked();
  await expect(inat).toHaveAccessibleName(/votre position précise est envoyée à iNaturalist/);

  // The distribution of the world: its chip pressed, kept for this map; then none.
  await distribution.selectOption('world');
  await expect(chip('gbif-world')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sheetConfig(page)).gbif).toBe('world');
  await expect(map.locator('.gf-tiles-gbif')).toHaveCount(1);
  await distribution.selectOption('off');
  await expect(map.locator('.gf-tiles-gbif')).toHaveCount(0);
  await expect(chip('gbif-fr')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('gbif-world')).toHaveAttribute('aria-pressed', 'false');

  // My places hidden: the place's marker gone, its chip unpressed.
  const markers = map.locator('.leaflet-marker-pane .leaflet-marker-icon');
  await expect(markers.first()).toBeAttached();
  await data.getByRole('checkbox', { name: /^Mes lieux/ }).uncheck();
  await expect(chip('places')).toHaveAttribute('aria-pressed', 'false');
  await expect(markers).toHaveCount(0);

  // The observations near me from iNaturalist: asked at once (this touch, as its chip), drawn, its chip pressed.
  const nearMe = () => asked.filter(u => u.startsWith('https://api.inaturalist.org/v1/observations?') && u.includes('lat=')).length;
  expect(nearMe(), 'nothing asked before').toBe(0);
  await inat.check();
  await expect(chip('inat')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(nearMe).toBeGreaterThan(0);
  await expect(panel.locator('.said')).toContainText(/Autour de vous : 6 observations sur la carte/, { timeout: 15_000 });
  await expect.poll(async () => (await sheetConfig(page)).near).toBe('inat');
  // And GBIF's: both.
  await gbif.check();
  await expect(chip('gbif-near')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sheetConfig(page)).near).toBe('both');
  await closePanel(panel);

  // Back by the chips: the panel says the same.
  await chip('gbif-fr').click();
  await chip('places').click();
  await chip('inat').click();
  await expect.poll(async () => (await sheetConfig(page)).near).toBe('gbif');
  panel = await openPanel(map);
  data = onThisMap(panel);
  await expect(data.getByRole('combobox', { name: /^Répartition GBIF/ })).toHaveValue('fr');
  await expect(data.getByRole('checkbox', { name: /^Mes lieux/ })).toBeChecked();
  await expect(data.getByRole('checkbox', { name: /^Observations proches : iNaturalist/ })).not.toBeChecked();
  await expect(data.getByRole('checkbox', { name: /^Observations proches : GBIF/ })).toBeChecked();
  // No look-alike compared: no row for it.
  await expect(data.getByRole('checkbox', { name: /^Sosie/ })).toHaveCount(0);
  await closePanel(panel);

  // A look-alike compared (its chip, as « Plantes à confondre » would): its row, ticked; unticked, let go as by its ✕ —
  // by the keyboard, its row gone with it, the focus on the row above (never lost to the page).
  await block.evaluate(el => el.dispatchEvent(new CustomEvent('gf-map-focus', { detail: { kind: 'compare', label: 'Ortie brûlante', taxon: 'Urtica urens' }, bubbles: true, composed: true })));
  await expect(block.locator('.chip[data-kind="compare"]')).toHaveText('Comparaison : Ortie brûlante');
  panel = await openPanel(map);
  const sosie = onThisMap(panel).getByRole('checkbox', { name: /^Sosie : Ortie brûlante/ });
  await expect(sosie).toBeChecked();
  await sosie.focus();
  await page.keyboard.press('Space');
  await expect(block.locator('.chip[data-kind="compare"]')).toHaveCount(0);
  await expect(onThisMap(panel).getByRole('checkbox', { name: /^Sosie/ })).toHaveCount(0);
  await expect(onThisMap(panel).getByRole('checkbox', { name: /^Observations proches : GBIF/ })).toBeFocused();
});

test('une carte de disposition : « Sur cette carte » — les sources de ses points (src=) et les points de la plante choisie (plante=), écrits dans l’adresse et relus', async ({ app, page }) => {
  // GBIF asked by default beside iNaturalist (its 30 points): three occurrences of the zone.
  /** @type {string[]} */ const seen = [];
  await answerZoneGbif(page, 3, { seen });
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const points = () => map.evaluate(m => /** @type {any} */ (m).area?.points?.length ?? 0);
  const kinds = () => map.evaluate(m => [...new Set((/** @type {any} */ (m).area?.points ?? []).map((/** @type {any} */ p) => p.kind))].sort());
  await expect.poll(points).toBe(33);
  expect(seen.length).toBeGreaterThan(0);

  let panel = await openPanel(map);
  expect((await headings(panel)).slice(0, 5)).toEqual(['Carte', 'Affichage', 'Fond', 'Sur cette carte', 'Couches affichées']);
  let data = onThisMap(panel);
  const inat = data.getByRole('checkbox', { name: /^iNaturalist/ });
  const gbif = data.getByRole('checkbox', { name: /^GBIF/ });
  const plant = data.getByRole('checkbox', { name: /^Points de la plante choisie/ });
  // Both sources by default (every observation).
  await expect(inat).toBeChecked();
  await expect(gbif).toBeChecked();
  await expect(gbif).toBeEnabled();
  await expect(plant).toBeChecked();
  await expect(plant).toHaveAccessibleName(/aucune choisie pour l’instant/);

  // GBIF's let go: src=inat; iNaturalist's too: src=aucune, no point; back: src=inat, every point.
  await gbif.uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat)]');
  await expect.poll(points).toBe(30);
  await inat.uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=aucune)]');
  await expect.poll(points).toBe(0);
  await inat.check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat)]');
  await expect.poll(points).toBe(30);
  // The current plant's points not shown: plante=non; shown again, not written.
  await plant.uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat,plante=non)]');
  await plant.check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat)]');
  // GBIF's again: src=inat+gbif — the whole group asks GBIF too, its points on the map; let go: iNaturalist's alone.
  await gbif.check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat+gbif)]');
  await expect.poll(kinds).toEqual(['gbif', 'inat']);
  await expect.poll(points).toBe(33);
  await expect(gbif).toBeChecked();
  await expect(inat).toBeChecked();
  await gbif.uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,src=inat)]');
  await expect.poll(kinds).not.toContain('gbif');
  await closePanel(panel);

  // Read from the address: a map of GBIF's points alone, the current plant's not shown — while the address says the
  // group asks iNaturalist only (sources=): GBIF there, disabled, why said.
  await app.open(`#/layout/[map(r=1km,src=gbif,plante=non)]?${AT}&sources=inat`);
  await expect.poll(points).toBe(0);
  panel = await openPanel(map);
  data = onThisMap(panel);
  await expect(data.getByRole('checkbox', { name: /^iNaturalist/ })).not.toBeChecked();
  const onlyGbif = data.getByRole('checkbox', { name: /^GBIF/ });
  await expect(onlyGbif).toBeChecked();
  await expect(onlyGbif).toBeDisabled();
  await expect(onlyGbif).toHaveAccessibleDescription('Les observations de la zone ne viennent pas de GBIF : à cocher dans les filtres, « Observations de la zone ».');
  await expect(data.getByRole('checkbox', { name: /^Points de la plante choisie/ })).not.toBeChecked();
});

test('Réglages › Cartes : pas de « Sur cette carte » (les données sont celles d’une carte)', async ({ app, page }) => {
  await app.open('#/settings');
  const options = page.locator('gf-settings gf-map-options[scope="defaults"]');
  await expect(options.getByRole('heading', { name: 'Fond' })).toBeVisible();
  await expect(options.getByRole('heading', { name: 'Sur cette carte' })).toHaveCount(0);
  await expect(options.getByRole('group', { name: 'Sur cette carte' })).toHaveCount(0);
});
