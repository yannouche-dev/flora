// « Disposition libre » (app/layout, #/layout/<layout>?<state>): a screen written in its address — columns, a column
// split into rows, each cell a piece of the app — every cell wired to one shared state. Here: the layout read (columns,
// rows, shares), its grips (keyboard: the shares written in the address and kept for the layout on this device, found
// again on a reload and for the same layout opened without them), the wiring (a search keeps the results, whose
// points the map shows; a result touched is the current plant, every plant cell shows it, the address says it, Back
// returns to the one before; the scope's radius keeps the results to the plants observed in it; a point of the map
// touched: its plant), the deck (its top card the current plant, a heart a favourite), the editor (live preview, a
// component unknown said and shown, « Appliquer » a new entry), a phone (the columns as tabs, the plant's tab brought),
// Réglages' presets. iNaturalist answered here: 12 plants around (fixtures.mjs), 3 within 500 m; 24 observations, two
// of each plant, and 3 of a plant asked alone.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const ORTIE = 'Urtica dioica', AIL = 'Allium ursinum';
/** The 3 plants observed within 500 m (iNaturalist's taxa 1000…1002: the first of fixtures.mjs' NAMES). */
const NEAR = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum'];
const LAYOUT = '[map(r=1km)@40,search,[plant.wikipedia,plant.calendar]]';
const AT = 'at=48.85,2.35';

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => {
    const url = new URL(route.request().url());
    const near = Number(url.searchParams.get('radius')) <= 0.5;
    const results = Array.from({ length: near ? 3 : 12 }, (_, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name: i < 3 ? NEAR[i] : ['Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'][i - 3], preferred_common_name: null } }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results }) });
  });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const url = new URL(route.request().url());
    const taxon = Number(url.searchParams.get('taxon_id')) || 0;
    const n = taxon ? 3 : 24;
    const results = Array.from({ length: n }, (_, i) => ({
      id: (taxon || 7) * 100 + i, observed_on: '2026-05-01',
      geojson: { coordinates: [2.35 + ((i % 6) - 2.5) * 0.0018 + (taxon ? 0.0005 : 0), 48.85 + (Math.floor(i / 6) - 1.5) * 0.0015] },
      taxon: { id: taxon || 1000 + (i % 12), name: 'Plante', preferred_common_name: null },
      photos: [{ id: i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${(taxon || 7) * 100 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) A' }]
    }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n, results }) });
  });
});

const hash = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash));
/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
/** A cell, by its component (data-comp: map, search, plant.wikipedia…). @param {Page} page @param {string} comp */
const cellOf = (page, comp) => page.locator(`gf-layout section.cell[data-comp="${comp}"]`);
/** @param {import('@playwright/test').Locator} l */
const box = async l => /** @type {{ x: number, y: number, width: number, height: number }} */ (await l.boundingBox());
/** The map's points shown (the observations of the plants found). @param {Page} page */
const dots = page => page.locator('dl-map .leaflet-marker-pane .gf-obs-leaf:not(.gf-leave):not(.hl)');

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('colonnes, lignes et parts ; les poignées au clavier, écrites dans l’adresse, gardées au rechargement et pour la même disposition', async ({ app, page }) => {
    await app.open(`#/layout/${LAYOUT}?${AT}`);
    const map = cellOf(page, 'map'), search = cellOf(page, 'search'), wiki = cellOf(page, 'plant.wikipedia'), cal = cellOf(page, 'plant.calendar');
    await expect(map).toBeVisible();
    // Three columns side by side, the map's 40 %; the third split in two rows.
    const grid = await box(page.locator('gf-layout .grid'));
    const [m, s, w, c] = await Promise.all([map, search, wiki, cal].map(box));
    expect(m.x + m.width).toBeLessThanOrEqual(s.x + 1);
    expect(s.x + s.width).toBeLessThanOrEqual(w.x + 1);
    expect(Math.abs(m.width / grid.width - 0.4)).toBeLessThan(0.02);
    expect(Math.abs(w.x - c.x)).toBeLessThan(1);
    expect(w.y + w.height).toBeLessThanOrEqual(c.y + 1);
    expect(Math.abs(w.height - c.height)).toBeLessThan(4);
    // The address, written as the app writes it: the radius the map gives, the scope.
    await expect.poll(() => hash(page)).toBe(`#/layout/${LAYOUT}?at=48.85000,2.35000&r=1km`);
    // The grip between the map and the search: → 5 % more for the map; written, kept.
    const grip = page.locator('gf-layout .grid > .split.row > .split-grip').first();
    await expect(grip).toHaveAttribute('aria-valuenow', '40');
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expect(grip).toHaveAttribute('aria-valuenow', '45');
    await expect.poll(async () => (await box(map)).width / grid.width).toBeCloseTo(0.45, 1);
    await expect.poll(() => hash(page)).toContain('map(r=1km)@45');
    expect(await page.evaluate(() => localStorage.getItem('geoflora.freeLayout'))).toContain('[map,search,[plant.wikipedia,plant.calendar]]');
    // The grip between the two rows: ↓ gives the article more.
    const rows = page.locator('gf-layout .split.col > .split-grip').first();
    await rows.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await box(wiki)).height - (await box(cal)).height).toBeGreaterThan(40);
    await expect.poll(() => hash(page)).toContain('[plant.wikipedia@55,plant.calendar@45]');
    // Reloaded: the same shares.
    await page.reload();
    await app.ready();
    await expect.poll(async () => (await box(cellOf(page, 'map'))).width / grid.width).toBeCloseTo(0.45, 1);
    // The same layout without shares in its address (a preset): the shares kept on this device.
    await app.go('#/layout/[map(r=1km),search,[plant.wikipedia,plant.calendar]]?' + AT);
    await expect.poll(async () => (await box(cellOf(page, 'map'))).width / grid.width).toBeCloseTo(0.45, 1);
    await expect.poll(async () => (await box(cellOf(page, 'plant.wikipedia'))).height - (await box(cellOf(page, 'plant.calendar'))).height).toBeGreaterThan(40);
    // Entrée: equal shares.
    await page.locator('gf-layout .grid > .split.row > .split-grip').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hash(page)).toContain('[map(r=1km)@33.3,search@33.3,');
    // Dragged with the pointer: the map 128 px wider on release, written.
    const g = await box(page.locator('gf-layout .grid > .split.row > .split-grip').first());
    const before = (await box(cellOf(page, 'map'))).width;
    await page.mouse.move(g.x + 1, g.y + 300);
    await page.mouse.down();
    await page.mouse.move(g.x + 65, g.y + 300, { steps: 4 });
    await page.mouse.move(g.x + 129, g.y + 300, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await box(cellOf(page, 'map'))).width - before).toBeGreaterThan(110);
    await expect.poll(() => hash(page)).not.toContain('[map(r=1km)@33.3,search@33.3,');
  });

  test('le câblage : la recherche garde les résultats, la carte leurs points ; un résultat est la plante de toutes les cases et de l’adresse ; Retour', async ({ app, page }) => {
    await app.open(`#/layout/${LAYOUT}?${AT}`);
    // The scope keeps the search to the 12 plants observed around; the map shows their 24 points.
    await expect.poll(() => app.state('results.total')).toBe(12);
    await expect(cellOf(page, 'search').locator('.sub')).toHaveText('12 espèces');
    await expect(dots(page)).toHaveCount(24);
    // A search: one plant, its two points; the address says it.
    await page.locator('dl-search gf-plant-search input').fill('ortie');
    await expect.poll(() => app.state('results.total')).toBe(1);
    await expect(dots(page)).toHaveCount(2);
    await expect.poll(() => param(page, 'q')).toBe('ortie');
    // No plant yet: the plant cells say how to choose one.
    await expect(cellOf(page, 'plant.wikipedia').locator('.placeholder')).toContainText('Aucune plante choisie');
    // The result touched: the current plant, in every plant cell, in the address (a new entry), lit on the map.
    await page.locator('dl-search gf-plant-card a.row').first().click();
    const id = plantId(ORTIE);
    await expect.poll(() => param(page, 'p')).toBe(String(id));
    for (const comp of ['plant.wikipedia', 'plant.calendar']) {
      await expect(cellOf(page, comp).locator('gf-plant-detail')).toHaveAttribute('plant-id', String(id));
      await expect(cellOf(page, comp).locator('.sub')).toContainText('Ortie dioïque');
    }
    await expect(page.locator('dl-map .leaflet-marker-pane .gf-obs-leaf.hl')).toHaveCount(3);
    await expect(page.locator('dl-search gf-plant-card[current]')).toHaveCount(1);
    // Back: no plant; Forward: the plant again (and the search kept throughout).
    await page.goBack();
    await expect.poll(() => param(page, 'p')).toBe(null);
    await expect(cellOf(page, 'plant.wikipedia').locator('.placeholder')).toBeVisible();
    await page.goForward();
    await expect.poll(() => param(page, 'p')).toBe(String(id));
    await expect(cellOf(page, 'plant.calendar').locator('gf-plant-detail')).toHaveAttribute('plant-id', String(id));
    // A reload: the same screen (the plant, the search, the scope).
    await page.reload();
    await app.ready();
    await expect(cellOf(page, 'plant.wikipedia').locator('gf-plant-detail')).toHaveAttribute('plant-id', String(id));
    await expect.poll(() => app.state('query.q')).toBe('ortie');
    await expect.poll(() => app.state('results.total')).toBe(1);
    await expect(page.locator('dl-search gf-plant-search input')).toHaveValue('ortie');
  });

  test('la zone : le rayon change, les résultats suivent ; un point de la carte touché : sa plante ; « Toute la France »', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km),results,plant.status]?${AT}`);
    await expect.poll(() => app.state('results.total')).toBe(12);
    // 500 m: three plants left (the slider, one step down), the address says it.
    const slider = page.locator('dl-map input[type="range"]');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => param(page, 'r')).toBe('500m');
    await expect.poll(() => app.state('results.total')).toBe(3);
    await expect(cellOf(page, 'map').locator('.sub')).toHaveText('500 m autour du point choisi');
    await expect(dots(page)).toHaveCount(6);
    // A point of the map: its plant is the current one, with this observation.
    await dots(page).first().click();
    await expect.poll(() => param(page, 'p')).not.toBe(null);
    expect(NEAR.map(plantId).map(String)).toContain(await param(page, 'p'));
    await expect.poll(() => param(page, 'o')).toMatch(/^7\d\d$/);
    await expect(cellOf(page, 'plant.status').locator('gf-plant-detail')).toHaveAttribute('plant-id', /** @type {string} */ (await param(page, 'p')));
    // No scope: the whole flora again.
    await page.locator('dl-map').getByRole('button', { name: 'Toute la France (sans zone)' }).click();
    await expect.poll(() => param(page, 'at')).toBe(null);
    await expect.poll(() => app.state('results.total')).toBe(300);
  });

  test('les cartes de Rencontres : celle du dessus est la plante de toutes les cases ; un cœur, un favori, et la suivante', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=500m),deck,plant.status]?${AT}`);
    // The first card (the search's order: French names) is the current plant.
    const top = page.locator('dl-deck ma-deck .swipe-card.top');
    await expect(top).toHaveAttribute('data-id', String(plantId(AIL)));
    await expect.poll(() => param(page, 'p')).toBe(String(plantId(AIL)));
    await expect(cellOf(page, 'plant.status').locator('gf-plant-detail')).toHaveAttribute('plant-id', String(plantId(AIL)));
    // A heart: a favourite, and the next card is the current plant.
    await page.locator('dl-deck ma-deck .round.like').click();
    await expect.poll(() => page.evaluate(async () => (await import('/app/core/collections.js')).isFavorite(81541))).toBe(true);
    await expect(top).not.toHaveAttribute('data-id', String(plantId(AIL)));
    const next = await top.getAttribute('data-id');
    await expect.poll(() => param(page, 'p')).toBe(next);
    await expect(cellOf(page, 'plant.status').locator('gf-plant-detail')).toHaveAttribute('plant-id', /** @type {string} */ (next));
    // A plant chosen elsewhere (a link to it): on top of the deck.
    await app.go(`#/layout/[map(r=500m),deck,plant.status]?p=${plantId(ORTIE)}&${AT}&r=500m`);
    await expect(top).toHaveAttribute('data-id', String(plantId(ORTIE)));
  });

  test('l’éditeur : le texte en aperçu direct, ce qui ne va pas dit, un composant inconnu montré ; les outils d’une case ; « Appliquer » ; Retour', async ({ app, page }) => {
    await app.open(`#/layout/[map,search]?${AT}`);
    await page.getByRole('button', { name: 'Modifier la disposition' }).click();
    const field = page.locator('gf-layout #layout-text');
    await expect(field).toHaveValue('[map,search]');
    await field.fill('[mpa,search(filtres),[plant.wiki,plant.calendrier]');
    // The preview: four cells, the unknown one saying so; what is wrong listed.
    await expect(page.locator('gf-layout .editor .problems')).toContainText('Crochet fermant « ] » manquant');
    await expect(page.locator('gf-layout .editor .problems')).toContainText('Composant inconnu « mpa » : vouliez-vous dire « map » ?');
    await expect(cellOf(page, 'unknown')).toContainText('Composant inconnu : « mpa »');
    await expect(cellOf(page, 'plant.calendar')).toBeVisible();
    await expect(cellOf(page, 'search').locator('dl-search gf-filter-panel')).toBeVisible();
    // The address is not touched while editing.
    expect(await hash(page)).toContain('#/layout/[map,search]?');
    // The cell's tools: the unknown one becomes the map; a cell under the search.
    await cellOf(page, 'unknown').getByLabel('Composant').selectOption('map');
    await expect(field).toHaveValue('[map,search(filters=1),[plant.wikipedia,plant.calendar]]');
    await cellOf(page, 'search').getByRole('button', { name: 'Ajouter une cellule en dessous' }).click();
    await expect(field).toHaveValue('[map,[search(filters=1),plant],[plant.wikipedia,plant.calendar]]');
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expect.poll(() => hash(page)).toBe('#/layout/[map,[search(filters=1),plant],[plant.wikipedia,plant.calendar]]?at=48.85000,2.35000&r=2km');
    await expect(page.locator('gf-layout .editor')).toHaveCount(0);
    await expect(page.locator('gf-layout section.cell')).toHaveCount(5);
    // Back: the layout before.
    await page.goBack();
    await expect.poll(() => hash(page)).toContain('#/layout/[map,search]?');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(2);
  });

  test('une adresse bancale ne casse rien : la disposition lue au mieux, les remarques dites, sans erreur', async ({ app, page }) => {
    await app.open('#/layout/[carte,fiche(nuit),foo,[plant.wiki');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(4);
    await expect(cellOf(page, 'unknown')).toContainText('Composant inconnu : « foo »');
    await expect(page.locator('gf-layout .remarks')).toContainText('4 remarques');
    // Two brackets left open, a mode unknown, a component unknown. Written as typed until it is corrected (nothing lost).
    expect(await hash(page)).toBe('#/layout/[carte,fiche(nuit),foo,[plant.wiki');
    // An empty layout: the presets.
    await app.go('#/layout');
    await expect(page.getByRole('heading', { name: 'Composez votre écran' })).toBeVisible();
    await expect(page.locator('gf-layout .empty li')).toHaveCount(5);
  });
});

test('un téléphone : les colonnes en onglets ; une plante choisie amène l’onglet de la fiche ; jamais de défilement de côté', async ({ app, page, isMobile }) => {
  test.skip(!isMobile, 'a phone');
  await app.open(`#/layout/${LAYOUT}?${AT}`);
  const tabs = page.locator('gf-layout .tabs [role="tab"]');
  await expect(tabs).toHaveText(['Carte', 'Recherche', 'Wikipédia · Calendrier']);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(cellOf(page, 'map')).toBeVisible();
  await expect(cellOf(page, 'search')).toBeHidden();
  await tabs.nth(1).click();
  await expect(cellOf(page, 'search')).toBeVisible();
  await expect(cellOf(page, 'map')).toBeHidden();
  await expect.poll(() => app.state('results.total')).toBe(12);
  await page.locator('dl-search gf-plant-card a.row').first().click();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(cellOf(page, 'plant.wikipedia').locator('gf-plant-detail')).toHaveAttribute('plant-id', String(plantId(AIL)));
  // The rows of the tab, one under the other, side by side never.
  const [w, c] = await Promise.all([cellOf(page, 'plant.wikipedia'), cellOf(page, 'plant.calendar')].map(box));
  expect(w.y + w.height).toBeLessThanOrEqual(c.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Back: no plant (the tab stays).
  await page.goBack();
  await expect.poll(() => param(page, 'p')).toBe(null);
});

test('Réglages › Disposition libre : un modèle ouvre sa disposition', async ({ app, page }) => {
  await app.open('#/settings');
  await expect(page.getByRole('heading', { name: 'Disposition libre' })).toBeVisible();
  await page.getByRole('link', { name: /Carte, résultats, Wikipédia et calendrier/ }).click();
  await expect.poll(() => hash(page)).toBe('#/layout/[map(r=2km),search,[plant.wikipedia,plant.calendar]]');
  await expect(cellOf(page, 'plant.calendar')).toBeAttached();
});
