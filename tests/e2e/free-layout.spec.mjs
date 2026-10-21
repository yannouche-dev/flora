// « Disposition libre » (app/layout, #/layout/<layout>?<state>): a screen written in its address — columns, a column
// split into rows, each cell a piece of the app — every cell wired to one shared state. Here: the layout read (columns,
// rows, shares), its grips (keyboard: the shares written in the address and kept for the layout on this device, found
// again on a reload and for the same layout opened without them), the wiring (a search keeps the results, whose
// points the map shows; a result touched is the current plant, every plant cell shows it, the address says it, Back
// returns to the one before; the scope's radius keeps the results to the plants observed in it; a point of the map
// touched: its plant), the deck (its top card the current plant, a heart a favourite), « Modifier » (« Créer une app »:
// builder.spec.mjs), each cell's head (the icon and mark of its tab in a
// phone's menu, its name alone read), a phone (the columns as a menu of icons on top: one
// per column, its icons and marks, its whole name; what looked alike once, told apart; tapped, ← → Début Fin; the
// plant's tab brought and lit; twelve columns: the menu scrolls, the tab shown in sight, the smooth scroll too; a
// finger swiped on a panel: the neighbour, never on the map), a window too narrow for its columns (their tabs named
// beside their icons where they have the room), Réglages' presets. And what went wrong once: a first visit (the plant cells drawn while the flora downloads: never a
// false « Plante introuvable », their heads named once it is there), the deck when iNaturalist fails (said, « Réessayer »,
// never « Les cartes arrivent… » for good), a radius between two of the slider's stops (r=3km: shown between them), the
// search's bar in a narrow cell and every preset without a cell overflowing (1280 px and a phone), the grid's Photo
// column and its filter's badge. iNaturalist answered here: the zone's observations, two of each of its 12 plants
// (their plants the list: state.js), those of 3 within 500 m; and 3 of a plant asked alone.
import { test, expect, plantId, answerAround } from './fixtures.mjs';
import { swipe } from './touch.mjs';
import { PRESETS } from '../../app/layout/presets.js';
import { parse } from '../../app/layout/grammar.js';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const ORTIE = 'Urtica dioica', AIL = 'Allium ursinum';
/** The 3 plants observed within 500 m (iNaturalist's taxa 1000…1002: the first of fixtures.mjs' NAMES). */
const NEAR = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum'];
/** The 12 plants observed around (iNaturalist's taxa 1000…1011), NEAR first. */
const PLANTS = [...NEAR, 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const LAYOUT = '[map(r=1km)@40,search,[plant.wikipedia,plant.calendar]]';
const AT = 'at=48.85,2.35';

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => {
    const url = new URL(route.request().url());
    const near = Number(url.searchParams.get('radius')) <= 0.5;
    const results = Array.from({ length: near ? 3 : 12 }, (_, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name: PLANTS[i], preferred_common_name: null } }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results }) });
  });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const url = new URL(route.request().url());
    const taxon = Number(url.searchParams.get('taxon_id')) || 0;
    // The zone's: two of each of its plants (within 500 m, three of them); a plant's own (taxon_id): three.
    const plants = Number(url.searchParams.get('radius')) <= 0.5 ? 3 : 12;
    const n = Number(url.searchParams.get('page') || 1) > 1 ? 0 : taxon ? 3 : plants * 2;
    const results = Array.from({ length: n }, (_, i) => ({
      id: (taxon || 7) * 100 + i, observed_on: '2026-05-01',
      geojson: { coordinates: [2.35 + ((i % 6) - 2.5) * 0.0018 + (taxon ? 0.0005 : 0), 48.85 + (Math.floor(i / 6) - 1.5) * 0.0015] },
      taxon: { id: taxon || 1000 + (i % plants), name: taxon ? 'Plante' : PLANTS[i % plants], preferred_common_name: null },
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
/**
 * Each cell's head, in reading order: the icon drawn (its sprite's symbol) with its mark (drawn by the style, not
 * written), and its heading's text (neither the icon nor the mark in it), the icon and mark hidden from readers. @param {Page} page
 */
const heads = page => page.locator('gf-layout section.cell .cell-head h2').evaluateAll(hs => hs.map(h => ({
  shown: (h.querySelector('svg use')?.getAttribute('href') ?? '').split('#')[1] + (h.querySelector('.cell-mark')?.getAttribute('data-mark') ?? ''),
  text: h.textContent?.trim(), hidden: [...h.querySelectorAll('svg, .cell-mark')].every(e => e.getAttribute('aria-hidden') === 'true') })));
/** One cell of each look the phone's menu tells apart (its marks, a block's own icon, a component mistyped). */
const LOOKS = '[map(r=2km),plant.map,media,plant.photos,mpa,plant.status,plant.lookalikes,search(list=0),search(filters=1),plant.literature,plant.wikipedia,plant(epure)]';
/** Their heads: the icon of the menu's tab with its mark, the cell's title. */
const LOOKS_HEADS = [['map', 'Carte'], ['pin-map', 'Carte'], ['images', 'Photos'], ['image', 'Photos'], ['question-circle', 'mpa'],
  ['shield', 'Protection et statuts'], ['exclamation-triangle-fill', 'Plantes à confondre'], ['search−L', 'Recherche'], ['searchF', 'Recherche'],
  ['journal-text', 'Publications (GBIF)'], ['wikipedia', 'Wikipédia'], ['card-textÉ', 'Fiche']];

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
    // The map shows the zone's 24 observations; the search is kept to their 12 plants.
    await expect.poll(() => app.state('results.total')).toBe(12);
    await expect(cellOf(page, 'search').locator('.sub')).toHaveText('12 espèces');
    await expect(dots(page)).toHaveCount(24);
    // A search: one plant, its points — its two among the zone's; the address says it.
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

  test('l’en-tête de chaque case : l’icône de son onglet sur un téléphone (le bloc de la fiche le sien, un composant inconnu une question), sa marque ; son nom seul lu', async ({ app, page }) => {
    // The same cells in three columns of four rows: room for them all side by side, no menu of columns.
    await app.open(`#/layout/[[map(r=2km),plant.map,media,plant.photos],[mpa,plant.status,plant.lookalikes,search(list=0)],[search(filters=1),plant.literature,plant.wikipedia,plant(epure)]]?${AT}`);
    await expect(page.locator('gf-layout section.cell')).toHaveCount(12);
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toHaveCount(0);
    const all = await heads(page);
    expect(all.map(h => [h.shown, h.text])).toEqual(LOOKS_HEADS);
    expect(all.every(h => h.hidden)).toBe(true);
    await expect(cellOf(page, 'plant.map').getByRole('heading', { level: 2 })).toHaveAccessibleName('Carte');
    await expect(cellOf(page, 'plant').getByRole('heading', { level: 2 })).toHaveAccessibleName('Fiche');
    await expect(cellOf(page, 'search').first().getByRole('heading', { level: 2 })).toHaveAccessibleName('Recherche');
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

  test('les cartes de Rencontres quand iNaturalist ne répond pas : elles le disent, « Réessayer » les fait venir', async ({ app, page }) => {
    let down = true;
    await page.route(/^https:\/\/api\.inaturalist\.org\//, route => down ? route.fulfill({ status: 503, body: '' }) : route.fallback());
    await app.open(`#/layout/[map(r=500m),deck,plant.status]?${AT}`);
    const said = page.locator('dl-deck .empty');
    // Said, with what to do — never « Les cartes arrivent… » for cards that will not come.
    await expect(said).toContainText('iNaturalist ne répond pas');
    await expect(said).not.toContainText('Les cartes arrivent');
    await expect(page.locator('dl-deck ma-deck')).toHaveCount(0);
    // iNaturalist back: « Réessayer » (its failure, remembered a few minutes, forgotten), the cards come.
    down = false;
    await page.locator('dl-deck').getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.locator('dl-deck ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(AIL)));
    await expect.poll(() => param(page, 'p')).toBe(String(plantId(AIL)));
  });

  test('un rayon entre deux crans (r=3km) : le curseur le montre entre 2 et 5 km, l’adresse le garde ; ← → vont aux crans voisins', async ({ app, page }) => {
    await app.open(`#/layout/[map,place]?${AT}&r=3km`);
    // Both sliders (the map's, the place's): between the stops of 2 km (3) and 5 km (4), where 3 km is — not on 2 km.
    for (const cell of ['dl-map', 'dl-place']) {
      const slider = page.locator(cell + ' input[type="range"]');
      await expect(slider).toHaveAttribute('aria-valuetext', '3 km');
      await expect(page.locator(cell + ' .radius b')).toHaveText('3 km');
      const at = Number(await slider.inputValue());
      expect(at).toBeGreaterThan(3.3);
      expect(at).toBeLessThan(3.6);
    }
    await expect.poll(() => param(page, 'r')).toBe('3km');
    // The keys: the stops on either side; touched or dragged, the closest stop.
    const slider = page.locator('dl-place input[type="range"]');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => param(page, 'r')).toBe('5km');
    await expect(slider).toHaveValue('4');
    await expect(page.locator('dl-map input[type="range"]')).toHaveValue('4');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => param(page, 'r')).toBe('1km');
    await expect(slider).toHaveValue('2');
    await slider.fill('5.4');
    await expect.poll(() => param(page, 'r')).toBe('10km');
    await expect(slider).toHaveValue('5');
  });

  test('la grille : le badge du filtre de la colonne Photo sous son nom, jamais par-dessus ni à sa place', async ({ app, page }) => {
    await app.open('#/layout/[search,results(view=grid)]?photo=avec');
    const head = cellOf(page, 'results').locator('gf-plant-list .head');
    const th = head.locator('.th').first();
    const name = th.locator('button.sort'), badge = th.locator('button.funnel');
    await expect(name).toHaveText('Photo');
    await expect(badge).toHaveText('1');
    const [h, t, n, b] = await Promise.all([head, th, name, badge].map(box));
    // The name whole (not « P… »), and the badge over none of it.
    expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(n.x + n.width <= b.x || b.x + b.width <= n.x || n.y + n.height <= b.y || b.y + b.height <= n.y).toBe(true);
    // Both in the column, and in the header's height.
    for (const r of [n, b]) {
      expect(r.x).toBeGreaterThanOrEqual(t.x - 0.5);
      expect(r.x + r.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
      expect(r.y).toBeGreaterThanOrEqual(h.y - 0.5);
      expect(r.y + r.height).toBeLessThanOrEqual(h.y + h.height + 0.5);
    }
  });

  test('la recherche dans une case étroite (sa largeur minimale) : sa barre tient, rien de coupé ; le compte dans l’en-tête, le tri à sa place', async ({ app, page }) => {
    await app.open('#/layout/[search@5,results]?q=ail&photo=avec&family=Amaryllidaceae');
    const cell = cellOf(page, 'search');
    await expect(cell.locator('.sub')).toHaveText(/espèces?$/);
    const c = await box(cell);
    // Nothing past its edge, at its least width (registry.js), however small the share asked.
    expect(await cell.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(Math.round(c.width)).toBe(280);
    // Every control of the bar inside the cell: the field, ✕ and the microphone, the funnel, the sort, the tools, the chips.
    const bar = cell.locator('gf-results-bar');
    const controls = bar.locator('input, select, button, a');
    expect(await controls.count()).toBeGreaterThan(5);
    for (const r of await controls.evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width).map(r => ({ x: r.x, right: r.right })))) {
      expect(r.x).toBeGreaterThanOrEqual(c.x - 0.5);
      expect(r.right).toBeLessThanOrEqual(c.x + c.width + 0.5);
    }
    // The field keeps room to read what is typed. The count, in the cell's head, is not said twice in the bar (kept
    // for screen readers, out of sight): the sort menu takes its place, on the line of the tools — no line of its own.
    expect((await box(bar.locator('gf-plant-search input'))).width).toBeGreaterThan(180);
    const count = bar.locator('.count');
    await expect(count).toHaveText(await cell.locator('.sub').innerText());
    expect((await box(count)).width).toBeLessThanOrEqual(1);
    const [sort, tool] = await Promise.all([bar.locator('select'), bar.locator('.row .tool').first()].map(box));
    expect(Math.abs((sort.y + sort.height / 2) - (tool.y + tool.height / 2))).toBeLessThan(2);
    expect(sort.width).toBeGreaterThan(150);
  });

  test('une fenêtre trop étroite pour ses colonnes : leurs onglets, chacun son icône et son nom à côté, là où ils ont la place ; trop nombreux, leurs icônes seules', async ({ app, page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await app.open(`#/layout/[carte,recherche,filtres,résultats,fiche,photos]?${AT}`);
    const tabs = page.getByRole('tablist', { name: 'Colonnes' }).getByRole('tab');
    await expect(tabs).toHaveCount(6);
    // Each name whole on screen beside its icon, as the text tabs had them; read once.
    for (const [i, name] of ['Carte', 'Recherche', 'Filtres', 'Résultats', 'Fiche', 'Photos'].entries()) {
      const label = tabs.nth(i).locator('.name');
      await expect(label).toHaveText(name);
      expect(await label.evaluate(e => e.getBoundingClientRect().width > 20 && e.scrollWidth <= e.clientWidth), name).toBe(true);
      await expect(tabs.nth(i)).toHaveAccessibleName(name);
      await expect(tabs.nth(i).locator('.glyph')).toHaveCount(1);
    }
    // 680 px: still the room for a name beside each icon.
    await page.setViewportSize({ width: 680, height: 800 });
    await expect.poll(() => tabs.evaluateAll(ts => ts.every(t => /** @type {Element} */ (t.querySelector('.name')).getBoundingClientRect().width > 20))).toBe(true);
    // Twelve columns in 1000 px: no room for their names — icons only (the names read, and shown on hover).
    await page.setViewportSize({ width: 1000, height: 800 });
    await app.go('#/layout/[results(list),search(list=0),filters,place,results(grid),search(filters=1),filters,place,results,filters,place,plant.calendar]');
    await expect(tabs).toHaveCount(12);
    await expect.poll(() => tabs.evaluateAll(ts => ts.every(t => /** @type {Element} */ (t.querySelector('.name')).getBoundingClientRect().width <= 1))).toBe(true);
    await expect(tabs.nth(1)).toHaveAccessibleName('Recherche (sans liste des résultats)');
    await expect(tabs.nth(1)).toHaveAttribute('title', 'Recherche (sans liste des résultats)');
  });
});

/**
 * The IGN geocoder answered (data.geopf.fr/geocodage/search): Ménétrol (63) for a commune asked, the Puy de Mirabel
 * there and a far-away Mirabel (Drôme) for places; nothing else. Each request's query kept, in order.
 * @param {Page} page @returns {Promise<URLSearchParams[]>}
 */
async function answerGeocoder(page) {
  /** @type {URLSearchParams[]} */
  const asked = [];
  const feature = (/** @type {[number, number]} */ at, /** @type {any} */ properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties });
  await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/search\?/, route => {
    const p = new URL(route.request().url()).searchParams;
    asked.push(p);
    const q = (p.get('q') || '').toLowerCase();
    const features = p.get('index') === 'poi'
      ? q === 'mirabel' ? [
        feature([5.099, 44.311], { _type: 'poi', toponym: 'Mirabel', category: ['lieu-dit habité'], city: ['Mirabel-aux-Baronnies'], citycode: ['26187'], postcode: ['26110'], score: 0.99 }),
        feature([3.1093, 45.8732], { _type: 'poi', toponym: 'Puy de Mirabel', category: ['sommet'], city: ['Ménétrol'], citycode: ['63224'], postcode: ['63200'], score: 0.8 })] : []
      : q === 'menetrol' ? [feature([3.1244, 45.8711], { _type: 'address', type: 'municipality', name: 'Ménétrol', label: 'Ménétrol', city: 'Ménétrol', citycode: '63224', postcode: '63200', score: 0.95 })] : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  return asked;
}

test.describe('le titre et un lieu en mots dans l’adresse', () => {
  // A wide screen (every cell in sight), but the last one: a phone's.
  test.beforeEach(({ isMobile }, info) => { test.skip(isMobile !== info.title.startsWith('sur téléphone'), 'a wide screen, or a phone for the last'); });
  const TITLE = 'Orchidées de la colline de Mirabel';
  /** The scope's circle on the map: its centre [lon, lat] and radius, or null. @param {Page} page */
  const circle = page => page.locator('dl-map gf-map').evaluate(m => { const a = /** @type {any} */ (m).area; return a ? { center: a.center, radius: a.radius } : null; });

  test('place= sans at= : le lieu cherché à l’IGN, la zone posée là, l’adresse réécrite (at=, le nom trouvé, r= gardé) ; le titre en tête, dans l’onglet et le partage', async ({ app, page }) => {
    const asked = await answerGeocoder(page);
    await app.open(`#/layout/[map(r=1km),place,results]?title=${encodeURIComponent(TITLE)}&place=${encodeURIComponent('mirabel, menetrol, 63')}`);
    await expect.poll(() => param(page, 'at')).toBe('45.87320,3.10930');
    expect(await param(page, 'place')).toBe('Puy de Mirabel (Ménétrol)');
    expect(await param(page, 'r')).toBe('1km');
    // The title kept, first.
    expect(await page.evaluate(() => location.hash.split('?')[1].split('&')[0])).toBe('title=' + new URLSearchParams({ t: TITLE }).toString().slice(2));
    // The circle there; the label found shown in the Zone cell and on the map, so a wrong guess is seen.
    expect(await circle(page)).toEqual({ center: [3.1093, 45.8732], radius: 1000 });
    await expect(cellOf(page, 'place').locator('.sub')).toHaveText('1 km autour de Puy de Mirabel (Ménétrol)');
    await expect(page.locator('dl-place .where')).toContainText('Puy de Mirabel (Ménétrol)');
    await expect(page.locator('dl-map .where')).toContainText('Puy de Mirabel (Ménétrol)');
    // The requests: the commune first, then the places of that name around its centre.
    expect(asked.map(p => p.toString())).toEqual(['q=menetrol&index=address&type=municipality&limit=20', 'q=mirabel&index=poi&limit=20&lon=3.12440&lat=45.87110']);
    // The title: the page's heading (above the bar), the tab's title.
    await expect(page.locator('gf-layout .titlebar h1')).toHaveText(TITLE);
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page).toHaveTitle(`${TITLE} · GeoFlora`);
    // Reloaded: the address has the point, the geocoder is not asked again.
    await page.reload();
    await app.ready();
    await expect.poll(() => circle(page)).toEqual({ center: [3.1093, 45.8732], radius: 1000 });
    expect(asked).toHaveLength(2);
  });

  test('place= sans at= : les mots demandés comme la barre de recherche de la carte, sa première suggestion dans le département retenue', async ({ app, page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/completion\?/, route => {
      const text = new URL(route.request().url()).searchParams.get('text') ?? '';
      asked.push(text);
      const results = text === 'Mirabel Ménétrol' ? [
        { fulltext: 'Mirabel, 26110 Mirabel-aux-Baronnies', zipcode: '26110', city: 'Mirabel-aux-Baronnies', kind: 'lieu-dit', x: 5.099, y: 44.311 },
        { fulltext: 'Colline de Mirabel, 63200 Ménétrol', zipcode: '63200', city: 'Ménétrol', kind: 'lieu-dit', x: 3.1116, y: 45.8726 },
        { fulltext: 'Rue de Mirabel, 63200 Ménétrol', zipcode: '63200', city: 'Ménétrol', kind: 'street', x: 3.12, y: 45.87 }] : [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'OK', results }) });
    });
    await app.open(`#/layout/[map(r=2km),place,results]?place=${encodeURIComponent('Mirabel, Ménétrol, 63')}`);
    await expect.poll(() => param(page, 'at')).toBe('45.87260,3.11160');
    expect(await param(page, 'place')).toBe('Colline de Mirabel (Ménétrol)');
    expect(await circle(page)).toEqual({ center: [3.1116, 45.8726], radius: 2000 });
    await expect(page.locator('dl-place .where')).toContainText('Colline de Mirabel (Ménétrol)');
    expect(asked).toEqual(['Mirabel Ménétrol']);
  });

  test('une famille gardée : ses seules plantes parmi les observations de la zone, sur la liste et sur la carte — rien de plus demandé', async ({ app, page }) => {
    const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    const taxon = (/** @type {number} */ id, /** @type {string} */ name) => ({ id, name, preferred_common_name: null });
    /** @type {string[]} */
    const asked = [];
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
      const q = new URL(route.request().url()).searchParams;
      asked.push(q.get('taxon_id') ?? 'all');
      // The zone's: 20 nettles and 3 garlics.
      const of = (/** @type {number} */ id, /** @type {string} */ name, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ id: id * 100 + i,
        uri: `https://www.inaturalist.org/observations/${id * 100 + i}`, geojson: { coordinates: [2.35 + i * 0.0005, 48.85] }, observed_on: '2026-05-01', taxon: taxon(id, name) }));
      const results = q.get('page') && q.get('page') !== '1' ? [] : [...of(50, 'Urtica dioica', 20), ...of(51, 'Allium ursinum', 3)];
      return json(route, { total_results: 23, results });
    });
    const points = () => page.locator('dl-map gf-map').evaluate(m => (/** @type {any} */ (m).area?.points ?? []).map((/** @type {any} */ p) => p.taxonId));
    await app.open(`#/layout/[map(r=1km),results]?${AT}&family=Amaryllidaceae`);
    // The garlic alone, in the list and on the map; only the zone's observations asked.
    await expect.poll(() => app.state('results.total')).toBe(1);
    await expect.poll(points).toEqual([51, 51, 51]);
    expect(asked.every(a => a === 'all')).toBe(true);
  });

  test('un lieu introuvable, ou l’IGN qui ne répond pas : aucune zone, la raison dite dans la case Zone et sur la carte, place= gardé', async ({ app, page }) => {
    const asked = await answerGeocoder(page);
    await app.open('#/layout/[map(r=1km),place,results]?place=zzyzx');
    const zone = page.locator('dl-place .where');
    await expect(zone).toHaveText(/Lieu introuvable : zzyzx/);
    await expect(zone).toHaveClass(/error/);
    await expect(page.locator('dl-map .where')).toContainText('Lieu introuvable : zzyzx');
    await expect(cellOf(page, 'place').locator('.sub')).toHaveText('Lieu introuvable : zzyzx');
    expect(await circle(page)).toBe(null);
    expect([await param(page, 'place'), await param(page, 'at')]).toEqual(['zzyzx', null]);
    await expect.poll(() => app.state('results.total')).toBe(300);
    expect(asked.map(p => p.get('index')).sort()).toEqual(['address', 'poi']);
    // ✕: no place to find any more.
    await page.locator('dl-place').getByRole('button', { name: 'Toute la France (sans zone)' }).click();
    await expect.poll(() => param(page, 'place')).toBe(null);
    await expect(zone).toHaveText('Toute la France');
    // The geocoder down (503: fixtures.mjs): said too.
    await page.unroute(/^https:\/\/data\.geopf\.fr\/geocodage\/search\?/);
    await app.go('#/layout/[map(r=1km),place,results]?place=Ménétrol');
    await expect(zone).toHaveText('Lieu introuvable : Ménétrol (le géocodeur de l’IGN ne répond pas)');
    expect(await param(page, 'place')).toBe('Ménétrol');
  });

  test('sur téléphone, le titre au-dessus du menu des colonnes', async ({ app, page }) => {
    await app.open(`#/layout/${LAYOUT}?title=Mes%20plantes&${AT}`);
    const bar = await box(page.locator('gf-layout .titlebar'));
    const menu = await box(page.getByRole('tablist', { name: 'Colonnes' }));
    expect(bar.y + bar.height).toBeLessThanOrEqual(menu.y + 1);
    await expect(page.locator('gf-layout .titlebar h1')).toHaveText('Mes plantes');
  });
});

/** How many cells a layout as written has (grammar.js). @param {string} spec */
const cellsOf = spec => {
  /** @param {import('../../app/layout/grammar.js').LayoutNode} n @returns {number} */
  const count = n => n.t === 'cell' ? 1 : n.kids.reduce((a, k) => a + count(k), 0);
  return count(parse(spec).tree);
};

test('les modèles : aucune case ne déborde, ni la page de côté — même la recherche dans sa colonne étroite (« Grille et photos »)', async ({ app, page }) => {
  await app.open('#/layout');
  const vp = /** @type {{ width: number, height: number }} */ (page.viewportSize());
  // The desktop also at 720 px high: the rows lower than the search's bar there (« Étude », « Grille et photos »).
  for (const height of vp.width > 600 ? [vp.height, 720] : [vp.height]) {
    await page.setViewportSize({ width: vp.width, height });
    for (const preset of PRESETS) {
      // A search with chips (a filter, a family), « Filtrer par » (the genus Allium), the scope: the bar at its fullest.
      await app.go(`#/layout/${preset.spec}?${AT}&q=allium&photo=avec&family=Amaryllidaceae`);
      await expect(cellOf(page, 'search').locator('gf-results-bar .suggestions')).toHaveCount(await cellOf(page, 'search').count());
      await expect(page.locator('gf-layout section.cell')).toHaveCount(cellsOf(preset.spec));
      await expect.poll(() => app.state('results.total')).toBeGreaterThan(0);
      const tabs = page.locator('gf-layout [role="tablist"] [role="tab"]');
      const panes = Math.max(1, await tabs.count());
      for (let i = 0; i < panes; i++) {
        const where = `${preset.id}, ${vp.width}×${height}, ${panes > 1 ? 'onglet ' + (i + 1) : 'l’écran'}`;
        if (await tabs.count()) await tabs.nth(i).click();
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        // No cell cuts what it holds, sideways or below (a cell clips: what passes its edge is out of reach).
        const over = await page.locator('gf-layout section.cell').evaluateAll(cells => cells.flatMap(c => [
          ...c.scrollWidth > c.clientWidth + 1 ? [`${/** @type {HTMLElement} */ (c).dataset.comp} : ${c.scrollWidth - c.clientWidth} px de côté`] : [],
          ...c.scrollHeight > c.clientHeight + 1 ? [`${/** @type {HTMLElement} */ (c).dataset.comp} : ${c.scrollHeight - c.clientHeight} px dessous`] : []]));
        expect(over, where).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // The search's bar taller than its cell: the cell scrolls (the wheel, as a hand would), its last line reached.
        const search = cellOf(page, 'search');
        if (!await search.isVisible()) continue;
        const controls = search.locator('gf-results-bar').locator('input, select, button, a');
        const s = await box(search);
        await page.mouse.move(s.x + s.width / 2, s.y + 44);
        await page.mouse.wheel(0, 1000);
        // How far the lowest control of the bar ends below the cell (≤ 0: in sight).
        await expect.poll(async () => {
          const [cell, bottoms] = await Promise.all([box(search), controls.evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.height).map(r => r.bottom))]);
          return Math.max(...bottoms) - (cell.y + cell.height);
        }, where).toBeLessThanOrEqual(0.5);
      }
    }
  }
});

test('une première visite : les cases de la plante attendent la flore, puis la montrent — jamais « Plante introuvable », leur en-tête nommé', async ({ app, page, context }) => {
  // The flora slow to come (a first visit, 11 MB): held until the layout is drawn, so its cells are seen waiting for it
  // whatever the machine's speed (a fixed delay raced the layout on a busy runner).
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise(done => { release = () => done(undefined); });
  await context.route(/\/data\/plants\.json(\?|$)/, async route => { await held; await route.fallback(); });
  const id = plantId(AIL);
  await page.goto(`#/layout/[media,plant.name]?p=${id}`);
  await expect(cellOf(page, 'media')).toBeAttached();
  expect(await app.state('status')).toBe('loading');
  release();
  await app.ready();
  for (const comp of ['media', 'plant.name']) await expect(cellOf(page, comp).locator('.sub')).toContainText('Ail des ours');
  await expect(cellOf(page, 'plant.name').locator('gf-plant-detail')).toContainText('Allium ursinum');
  await expect(cellOf(page, 'media').locator('gf-media-viewer')).toHaveAttribute('plant-id', String(id));
  await expect(cellOf(page, 'media').locator('gf-media-viewer .empty', { hasText: 'introuvable' })).toHaveCount(0);
  await expect(cellOf(page, 'media')).not.toContainText('Plante introuvable');
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone');

  /** The menu of the columns, on top of the layout. @param {Page} page */
  const menuOf = page => page.getByRole('tablist', { name: 'Colonnes' });
  /** @param {Page} page */
  const tabsOf = page => menuOf(page).getByRole('tab');
  /** Each tab's whole name (its only text, read, and its title, shown on hover), its icons (data-icons), those drawn with their marks, and « +n » (drawn by the style). @param {Page} page */
  const looks = page => tabsOf(page).evaluateAll(ts => ts.map(t => ({
    name: t.querySelector('.name')?.textContent, title: t.getAttribute('title'), icons: /** @type {HTMLElement} */ (t).dataset.icons,
    shown: [...t.querySelectorAll('.glyph')].map(g => /** @type {HTMLElement} */ (g).dataset.icon + (g.querySelector('.mark')?.getAttribute('data-mark') ?? '')),
    more: t.querySelector('.more') ? '+' + t.querySelector('.more')?.getAttribute('data-more') : '' })));
  /** Each tab's name on screen (false: read only, an icon menu). @param {Page} page */
  const namesShown = page => tabsOf(page).evaluateAll(ts => ts.map(t => /** @type {Element} */ (t.querySelector('.name')).getBoundingClientRect().width > 1));
  /** A tab wholly in sight in the menu, and clear of its faded edges. @param {Page} page @param {number} i */
  const inSight = (page, i) => tabsOf(page).nth(i).evaluate(t => {
    const m = /** @type {HTMLElement} */ (t.parentElement), b = m.getBoundingClientRect(), r = t.getBoundingClientRect();
    return r.left - b.left >= (m.hasAttribute('data-before') ? 31.5 : -0.5) && b.right - r.right >= (m.hasAttribute('data-after') ? 31.5 : -0.5);
  });
  /**
   * Each tab as the browser's accessibility tree has it: its name, and its description (null: none — the title, the
   * same words as the name, not read a second time). @param {Page} page
   */
  const axTabs = async page => {
    const { nodes } = await (await page.context().newCDPSession(page)).send('Accessibility.getFullAXTree');
    return nodes.filter(n => n.role?.value === 'tab').map(n => [n.name?.value, n.description?.value ?? null]);
  };
  /** How far the page is wider than the window (0: no sideways scroll). @param {Page} page */
  const sideScroll = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  test('les colonnes en menu d’icônes : une par colonne, ses icônes, son nom entier ; toucher, ← →, Début, Fin ; une plante choisie amène l’onglet de la fiche, éclairé ; jamais de défilement de côté', async ({ app, page }) => {
    await app.open(`#/layout/${LAYOUT}?${AT}`);
    const tabs = tabsOf(page);
    expect(await looks(page)).toEqual([
      { name: 'Carte', title: 'Carte', icons: 'map', shown: ['map'], more: '' },
      { name: 'Recherche', title: 'Recherche', icons: 'search', shown: ['search'], more: '' },
      { name: 'Wikipédia · Calendrier', title: 'Wikipédia · Calendrier', icons: 'wikipedia flower1', shown: ['wikipedia', 'flower1'], more: '' }]);
    // Icons only (the names read, no second time as a description: the title says the same words), as wide as one
    // another, filling the menu, each a finger's room.
    expect(await namesShown(page)).toEqual([false, false, false]);
    for (const [i, name] of ['Carte', 'Recherche', 'Wikipédia · Calendrier'].entries()) {
      await expect(tabs.nth(i)).toHaveAccessibleName(name);
      await expect(tabs.nth(i)).not.toHaveAttribute('aria-label', /./);
    }
    expect(await axTabs(page)).toEqual([['Carte', null], ['Recherche', null], ['Wikipédia · Calendrier', null]]);
    const bar = await box(menuOf(page));
    const boxes = await Promise.all([0, 1, 2].map(i => box(tabs.nth(i))));
    for (const b of boxes) { expect(Math.abs(b.width - boxes[0].width)).toBeLessThan(1); expect(b.height).toBeGreaterThanOrEqual(44); }
    expect(boxes.reduce((a, b) => a + b.width, 0)).toBeGreaterThan(bar.width - 2);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(cellOf(page, 'map')).toBeVisible();
    await expect(cellOf(page, 'search')).toBeHidden();
    // A tap shows its column; the panel is named by its tab.
    await tabs.nth(1).tap();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Recherche' })).toBeVisible();
    await expect(cellOf(page, 'search')).toBeVisible();
    await expect(cellOf(page, 'map')).toBeHidden();
    // The keyboard: ← → (round), Début, Fin; the focus follows the tab shown.
    await tabs.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(cellOf(page, 'plant.calendar')).toBeVisible();
    await tabs.nth(1).tap();
    // A plant chosen in the search: the tab of its sheet comes, its icon lit a moment.
    await expect.poll(() => app.state('results.total')).toBe(12);
    await page.locator('dl-search gf-plant-card a.row').first().click();
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(2)).toHaveClass(/\bbrought\b/);
    await expect(cellOf(page, 'plant.wikipedia').locator('gf-plant-detail')).toHaveAttribute('plant-id', String(plantId(AIL)));
    await expect(tabs.nth(2)).not.toHaveClass(/\bbrought\b/);
    // The rows of the tab, one under the other, side by side never.
    const [w, c] = await Promise.all([cellOf(page, 'plant.wikipedia'), cellOf(page, 'plant.calendar')].map(box));
    expect(w.y + w.height).toBeLessThanOrEqual(c.y + 1);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    // Back: no plant (the tab stays).
    await page.goBack();
    await expect.poll(() => param(page, 'p')).toBe(null);
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  });

  test('deux colonnes du même composant se distinguent : la présentation choisie marquée et dite ; une colonne de plus de trois cases : trois icônes et « +n »', async ({ app, page }) => {
    await app.open(`#/layout/[résultats(liste)@22,fiche(épuré),fiche(standard),fiche(scientifique)]?${AT}`);
    expect(await looks(page)).toEqual([
      { name: 'Résultats (Liste)', title: 'Résultats (Liste)', icons: 'list-ul', shown: ['list-ulL'], more: '' },
      { name: 'Fiche (Épuré)', title: 'Fiche (Épuré)', icons: 'card-text', shown: ['card-textÉ'], more: '' },
      { name: 'Fiche (Standard)', title: 'Fiche (Standard)', icons: 'card-text', shown: ['card-textSt'], more: '' },
      { name: 'Fiche (Scientifique)', title: 'Fiche (Scientifique)', icons: 'card-text', shown: ['card-textSc'], more: '' }]);
    for (const [i, name] of ['Résultats (Liste)', 'Fiche (Épuré)', 'Fiche (Standard)', 'Fiche (Scientifique)'].entries()) await expect(tabsOf(page).nth(i)).toHaveAccessibleName(name);
    // The marks drawn, not written: each name read once, never again as a description.
    expect(await axTabs(page)).toEqual([['Résultats (Liste)', null], ['Fiche (Épuré)', null], ['Fiche (Standard)', null], ['Fiche (Scientifique)', null]]);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    await app.go('#/layout/[[place@22,map]@31,[search(list=0)@16,filters@34,results]@23,[plant.name@16,media@44,plant.calendar]@23,[plant.status,plant.lookalikes,plant.interactions,plant.climate]@23]');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(12);
    expect(await looks(page)).toEqual([
      { name: 'Zone · Carte', title: 'Zone · Carte', icons: 'geo-alt map', shown: ['geo-alt', 'map'], more: '' },
      { name: 'Recherche (sans liste des résultats) · Filtres · Résultats', title: 'Recherche (sans liste des résultats) · Filtres · Résultats', icons: 'search funnel list-ul', shown: ['search−L', 'funnel', 'list-ul'], more: '' },
      { name: 'Nom · Photos · Calendrier', title: 'Nom · Photos · Calendrier', icons: 'tag images flower1', shown: ['tag', 'images', 'flower1'], more: '' },
      { name: 'Protection et statuts · Plantes à confondre · Pollinisateurs et interactions · Climat et pollen', title: 'Protection et statuts · Plantes à confondre · Pollinisateurs et interactions · Climat et pollen',
        icons: 'shield exclamation-triangle-fill bug cloud-sun', shown: ['shield', 'exclamation-triangle-fill', 'bug'], more: '+1' }]);
    // Four columns on a phone: every tab wholly in sight, the menu not scrolling, the page not either.
    for (let i = 0; i < 4; i++) expect(await inSight(page, i), `onglet ${i + 1}`).toBe(true);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    expect((await axTabs(page)).map(([, d]) => d)).toEqual([null, null, null, null]);
    // What looked alike once: the sheet's map and the map, its photos and the photos' viewer, a status and a look-alike,
    // a component mistyped, two searches told by a yes or a no — each its own look, each its own name.
    await app.go('#/layout/[map(r=2km),plant.map,media,plant.photos,mpa,plant.status,plant.lookalikes,search(list=0),search(filters=1),plant.literature,plant.wikipedia]');
    const all = await looks(page);
    expect(all.map(t => [t.shown.join(' '), t.name])).toEqual([
      ['map', 'Carte'], ['pin-map', 'Fiche › Carte'], ['images', 'Photos'], ['image', 'Fiche › Photos'], ['question-circle', 'mpa (inconnu)'],
      ['shield', 'Protection et statuts'], ['exclamation-triangle-fill', 'Plantes à confondre'],
      ['search−L', 'Recherche (sans liste des résultats)'], ['searchF', 'Recherche (filtres ouverts)'], ['journal-text', 'Publications (GBIF)'], ['wikipedia', 'Wikipédia']]);
    for (const [i, t] of all.entries()) await expect(tabsOf(page).nth(i)).toHaveAccessibleName(/** @type {string} */ (t.name));
  });

  test('l’en-tête de chaque panneau : l’icône de son onglet, sa marque ; son nom seul lu', async ({ app, page }) => {
    await app.open(`#/layout/${LOOKS}?${AT}`);
    const tabs = await looks(page);
    expect(tabs).toHaveLength(12);
    // Every panel's head, the shown one and the hidden ones: the same look as its tab's (one cell a column here).
    const all = await heads(page);
    expect(all.map(h => h.shown)).toEqual(tabs.map(t => t.shown.join(' ')));
    expect(all.map(h => [h.shown, h.text])).toEqual(LOOKS_HEADS);
    expect(all.every(h => h.hidden)).toBe(true);
    await tabsOf(page).nth(11).click();
    await expect(cellOf(page, 'plant').getByRole('heading', { level: 2 })).toHaveAccessibleName('Fiche');
    await expect(cellOf(page, 'plant').locator('.cell-head .cell-mark')).toBeVisible();
  });

  test('douze colonnes : le menu défile de côté, sans barre ; l’onglet montré toujours en vue — au clavier, et amené par une plante choisie', async ({ app, page }) => {
    await app.open(`#/layout/[results(list),search(list=0),filters,place,results(grid),search(filters=1),filters,place,results,filters,place,plant.calendar]?${AT}`);
    const tabs = tabsOf(page);
    await expect(tabs).toHaveCount(12);
    const scroll = () => menuOf(page).evaluate(m => ({ left: m.scrollLeft, more: m.scrollWidth - m.clientWidth, before: m.hasAttribute('data-before'), after: m.hasAttribute('data-after'), bar: m.offsetHeight - m.clientHeight }));
    // Wider than the screen: it scrolls in itself (no scrollbar drawn: only its border's pixel), its far edge faded; the page never.
    expect(await scroll()).toMatchObject({ left: 0, before: false, after: true, bar: 1 });
    expect((await scroll()).more).toBeGreaterThan(100);
    for (let i = 0; i < 12; i++) expect((await box(tabs.nth(i))).width).toBeGreaterThanOrEqual(44);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    // Fin: the last tab, scrolled to; Début: the first; ← from the first: the last.
    await tabs.first().focus();
    await page.keyboard.press('End');
    await expect(tabs.nth(11)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => inSight(page, 11)).toBe(true);
    await expect.poll(scroll).toMatchObject({ before: true, after: false });
    await page.keyboard.press('Home');
    await expect.poll(() => inSight(page, 0)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => inSight(page, 11)).toBe(true);
    await page.keyboard.press('Home');
    await expect.poll(() => inSight(page, 0)).toBe(true);
    await expect.poll(scroll).toMatchObject({ left: 0, before: false });
    // A plant chosen in the first column: the sheet's tab, the last, comes into sight, lit.
    await expect.poll(() => app.state('results.total')).toBe(12);
    await page.locator('dl-results gf-plant-card a.row').first().click();
    await expect(tabs.nth(11)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(11)).toHaveClass(/\bbrought\b/);
    await expect.poll(() => inSight(page, 11)).toBe(true);
    await expect(cellOf(page, 'plant.calendar')).toBeVisible();
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
  });

  test('douze colonnes, le défilement animé (320 et 360 px) : ← une à une, l’onglet montré ramené en vue à chaque fois, jamais laissé au bord estompé', async ({ app, page }) => {
    // The focus moved by the keys must not stop the smooth scroll that brings the tab into sight (it did: the tab left
    // past the edge). Animations on, here.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 700 });
      await app.open(`#/layout/[results(list),search(list=0),filters,place,results(grid),search(filters=1),filters,place,results,filters,place,plant.calendar]?${AT}`);
      const tabs = tabsOf(page);
      await expect(tabs).toHaveCount(12);
      await tabs.first().focus();
      await page.keyboard.press('End');
      await expect.poll(() => inSight(page, 11), `${width} px, Fin`).toBe(true);
      for (let i = 10; i >= 5; i--) {
        await page.keyboard.press('ArrowLeft');
        await expect(tabs.nth(i)).toBeFocused();
        await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => inSight(page, i), `${width} px, onglet ${i + 1}`).toBe(true);
      }
    }
  });

  test('un doigt glissé de côté sur un panneau : la colonne voisine — jamais sur la carte, qui se glisse elle-même', async ({ app, page }) => {
    await app.open(`#/layout/${LAYOUT}?${AT}`);
    const tabs = tabsOf(page);
    /** The centre of a locator. @param {import('@playwright/test').Locator} l */
    const at = async l => { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    // On the map itself: the map's own (it pans), the tab stays.
    const map = await at(cellOf(page, 'map').locator('gf-map'));
    await swipe(page, { x: map.x + 80, y: map.y + 120 }, { x: map.x - 80, y: map.y + 120 });
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    // On its head (nothing there moves sideways): to the left, the next column; to the right, the one before.
    const head = await at(cellOf(page, 'map').locator('.cell-head'));
    await swipe(page, { x: head.x + 80, y: head.y }, { x: head.x - 80, y: head.y + 6 });
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(cellOf(page, 'search')).toBeVisible();
    const back = await at(cellOf(page, 'search').locator('.cell-head'));
    await swipe(page, { x: back.x - 80, y: back.y }, { x: back.x + 80, y: back.y });
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    // Mostly downward (a scroll that drifts): no swipe; and none before the first column.
    await swipe(page, { x: head.x + 30, y: head.y }, { x: head.x - 40, y: head.y + 150 });
    await swipe(page, { x: head.x - 80, y: head.y }, { x: head.x + 80, y: head.y });
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  });
});

test('Réglages › Disposition libre : un modèle ouvre sa disposition', async ({ app, page }) => {
  await app.open('#/settings');
  await expect(page.getByRole('heading', { name: 'Disposition libre' })).toBeVisible();
  await page.getByRole('link', { name: /Carte, résultats, Wikipédia et calendrier/ }).click();
  await expect.poll(() => hash(page)).toBe('#/layout/[map(r=2km),search,[plant.wikipedia,plant.calendar]]');
  await expect(cellOf(page, 'plant.calendar')).toBeAttached();
});
