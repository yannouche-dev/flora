// « Écran sur mesure » : the frame every cell shares (registry.js#FRAME), written in its parameters. Its head (tete=non:
// none, the content taking the room; tete=simple: its title alone), a title of its own (titre=: its head, its tab on a
// phone), the actions of its head (agrandir: over the layout, Échap returns; replier: folded to its head, its share to
// the others; partager: a link to a layout of this cell alone, with the same state, copied), its empty state
// (vide=masque: a plant block hidden until a plant is chosen; results hidden only once its search has answered, none
// found — a screen's search never answering for another's: a slowed worker, nothing hidden, counted « 0 espèce » nor
// said empty before its own answer, at a first load, from one screen to the next, through the home; nor a deck hidden or
// at its end, nor results zone=0 « Aucune plante… », its grid sorted from the keyboard keeping its focus, headers and rows —
// twice before its answer, reversed; another screen's rows never shown; nor « Aucune plante… » of an empty search said of
// the next one before its answer), its links (plante=: a plant of its own, whatever the current one; results zone=0: the whole flora whatever the
// zone; toucher=fiche: a result opens its sheet; toucher=rien: nothing), and the editor's « Cadre » writing them in the
// address. iNaturalist answered as in free-layout.spec.mjs: 12 plants around.
import { test, expect, plantId, answerAround } from './fixtures.mjs';
import { layoutOf, screen, screenSearch } from './app.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const ORTIE = 'Urtica dioica', AIL = 'Allium ursinum';
const AT = 'at=48.85,2.35';
const SHOTS = process.env.SHOTS_DIR || '';

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  // The zone's observations: one of each of its 12 plants (their plants, the list); none of a plant asked alone.
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    const names = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
    const results = q.get('taxon_id') || (q.get('page') && q.get('page') !== '1') ? []
      : names.map((name, i) => ({ id: 3000 + i, observed_on: '2026-05-01', geojson: { coordinates: [2.35 + (i - 6) * 0.001, 48.85] }, taxon: { id: 1000 + i, name, preferred_common_name: null } }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: results.length, results }) });
  });
});

const hash = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash));
/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
/** A cell, by its component (data-comp). @param {Page} page @param {string} comp */
const cellOf = (page, comp) => page.locator(`gf-layout section.cell[data-comp="${comp}"]`);
/** @param {import('@playwright/test').Locator} l */
const box = async l => /** @type {{ x: number, y: number, width: number, height: number }} */ (await l.boundingBox());
/** A screenshot for the report, when asked (SHOTS_DIR). @param {Page} page @param {string} name */
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

/**
 * The worker's searches slowed (a phone's: longer than a frame), and, at every frame while the screen's first group
 * searches « ortie » (from the moment the screen follows its address), what its cells show: a results cell hidden, its
 * head's count at 0, its list's « Aucune plante… »; a deck hidden, its end (« toutes les plantes du coin »). Returns
 * what was seen so far. @param {Page} page
 */
async function watchOrtie(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (/** @type {any} */ message, /** @type {any} */ options) {
      if (message?.type === 'search') setTimeout(() => post.call(this, message, options), 400);
      else post.call(this, message, options);
    };
    w.__seen = { hidden: 0, zero: 0, empty: 0, deckHidden: 0, deckEnd: 0 };
    const watch = () => {
      const layout = /** @type {any} */ (document.querySelector('gf-app')?.shadowRoot?.querySelector('gf-layout'));
      if (layout?.shadowRoot && layout.searchOf?.('a')?.query.q === 'ortie') {
        for (const cell of layout.shadowRoot.querySelectorAll('section.cell[data-comp="results"]')) {
          if (cell.closest('.part[hidden]')) w.__seen.hidden++;
          if (/^0 espèce/.test(cell.querySelector('.cell-head .sub')?.textContent?.trim() ?? '')) w.__seen.zero++;
          if (cell.querySelector('dl-results')?.shadowRoot?.querySelector('gf-plant-list')?.shadowRoot?.querySelector('.empty')) w.__seen.empty++;
        }
        for (const cell of layout.shadowRoot.querySelectorAll('section.cell[data-comp="deck"]')) {
          if (cell.closest('.part[hidden]')) w.__seen.deckHidden++;
          if (cell.querySelector('dl-deck')?.shadowRoot?.querySelector('ma-deck')?.shadowRoot?.querySelector('.deck-end')) w.__seen.deckEnd++;
        }
      }
      requestAnimationFrame(watch);
    };
    watch();
  });
  return () => page.evaluate(() => /** @type {any} */ (window).__seen);
}
/** Nothing seen (watchOrtie). */
const NONE = { hidden: 0, zero: 0, empty: 0, deckHidden: 0, deckEnd: 0 };

/**
 * The worker's searches slowed, and, at every frame, what a results(zone=0) cell lists while its search over the whole
 * flora has not answered the one on screen (state.js wholeOf): no row though it had an answer (`bare`), or the nettle's
 * rows while the screen's first group searches « ail » (`foreign`: another screen's). Returns what was seen so far.
 * @param {Page} page
 */
async function watchWhole(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (/** @type {any} */ message, /** @type {any} */ options) {
      if (message?.type === 'search') setTimeout(() => post.call(this, message, options), 400);
      else post.call(this, message, options);
    };
    w.__whole = { bare: 0, foreign: 0 };
    const watch = () => {
      const layout = /** @type {any} */ (document.querySelector('gf-app')?.shadowRoot?.querySelector('gf-layout'));
      for (const el of layout?.shadowRoot?.querySelectorAll('section.cell[data-comp="results"] dl-results') ?? []) {
        const s = /** @type {any} */ (el).state;
        const cards = [...(el.shadowRoot?.querySelector('gf-plant-list')?.shadowRoot?.querySelectorAll('gf-plant-card') ?? [])];
        if (s?.whole && s.whole.key !== s.wholeFor && !cards.length) w.__whole.bare++;
        if (layout.searchOf?.('a')?.query.q === 'ail' && cards.some(c => /^Urtica/.test(/** @type {any} */ (c).plant?.scientificName ?? ''))) w.__whole.foreign++;
      }
      requestAnimationFrame(watch);
    };
    watch();
  });
  return () => page.evaluate(() => /** @type {any} */ (window).__whole);
}
/** A results(zone=0) cell's search over the whole flora (state.js#wholeOf): the sort it asks, answered or not. @param {import('@playwright/test').Locator} cell */
const wholeSearch = cell => cell.locator('dl-results').evaluate(el => {
  const s = /** @type {any} */ (el).state;
  return { sort: new URLSearchParams(s.wholeFor.split('?')[1] || '').get('sort'), answered: s.whole?.key === s.wholeFor };
});

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('l’en-tête : aucun (tete=non), le titre seul (tete=simple), un titre à soi (titre=)', async ({ app, page }) => {
    await app.open(`#/layout/[results(list,tete=non),plant.wikipedia(en-tête=simple),plant(Titre=Ma fiche à moi)]?p=${plantId(ORTIE)}`);
    const results = cellOf(page, 'results'), wiki = cellOf(page, 'plant.wikipedia'), sheet = cellOf(page, 'plant');
    await expect(sheet.locator('.cell-head h2')).toHaveText('Ma fiche à moi');
    // No head: the list from the cell's very top.
    await expect(results.locator('.cell-head')).toHaveCount(0);
    expect(Math.abs((await box(results.locator('gf-plant-list'))).y - (await box(results)).y)).toBeLessThan(2);
    await expect(results).toHaveAttribute('aria-label', 'Résultats');
    // Its title alone: neither the icon nor what it shows.
    await expect(wiki.locator('.cell-head h2')).toHaveText('Wikipédia');
    await expect(wiki.locator('.cell-head svg, .cell-head .sub')).toHaveCount(0);
    // The full head, its own title, the plant shown beside it.
    await expect(sheet.locator('.cell-head .sub')).toContainText('Ortie dioïque');
    await expect(sheet).toHaveAttribute('aria-label', 'Ma fiche à moi');
    // Written as the app writes it: the frame after the cell's own, canonical.
    await expect.poll(() => hash(page)).toBe(`#/layout/[results(view=list,tete=non),plant.wikipedia(tete=simple),plant(titre=Ma fiche à moi)]?p=${plantId(ORTIE)}`);
    await shot(page, 'tete-titre');
  });

  test('vide=masque : un bloc de la fiche caché tant qu’il n’y a pas de plante, sa part aux autres ; une plante choisie, il revient', async ({ app, page }) => {
    await app.open('#/layout/[results(list),plant.wikipedia(vide=masque),plant.calendar]?q=ortie');
    const results = cellOf(page, 'results'), wiki = cellOf(page, 'plant.wikipedia'), cal = cellOf(page, 'plant.calendar');
    const row = results.locator('gf-plant-card a.row').first();
    const id = /** @type {string} */ (/\d+/.exec(/** @type {string} */ (await row.getAttribute('href')))?.[0]);
    await expect(wiki).toBeHidden();
    // The other plant block says how to choose one (vide=message, the default).
    await expect(cal.locator('.placeholder')).toContainText('Aucune plante choisie');
    const grid = await box(page.locator('gf-layout .grid'));
    expect((await box(results)).width + (await box(cal)).width).toBeGreaterThan(grid.width - 4);
    await shot(page, 'vide-masque-avant');
    await row.click();
    await expect.poll(() => param(page, 'p')).toBe(id);
    await expect(wiki).toBeVisible();
    await expect(wiki.locator('gf-plant-detail')).toHaveAttribute('plant-id', id);
    expect((await box(wiki)).width).toBeGreaterThan(grid.width / 4);
    // Back: no plant, hidden again.
    await page.goBack();
    await expect.poll(() => param(page, 'p')).toBe(null);
    await expect(wiki).toBeHidden();
  });

  test('results(vide=masque) n’est jamais caché avant sa première réponse : rien n’est dit vide avant que sa recherche ait répondu', async ({ app, page }) => {
    // From the screen's first frame, every change of its parts: a results cell hidden even once is counted.
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__resultsHidden = 0;
      const watch = () => {
        const root = document.querySelector('gf-app')?.shadowRoot?.querySelector('gf-layout')?.shadowRoot;
        if (!root) { requestAnimationFrame(watch); return; }
        const check = () => { for (const part of root.querySelectorAll('.part[hidden]')) if (part.querySelector('section.cell[data-comp="results"]')) w.__resultsHidden++; };
        new MutationObserver(check).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
        w.__watching = true;
        check();
      };
      watch();
    });
    await app.open('#/layout/[results(list,vide=masque),plant.calendar]?q=ortie');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__watching)).toBe(true);
    await expect(cellOf(page, 'results').locator('gf-plant-card a.row').first()).toBeVisible();
    expect((await screenSearch(page))?.total).toBeGreaterThan(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__resultsHidden)).toBe(0);
    // Nothing found, once answered: hidden, its share to the other.
    await page.evaluate(() => { location.hash = '#/layout/[results(list,vide=masque),plant.calendar]?q=zzzz'; });
    await expect(cellOf(page, 'results')).toBeHidden();
  });

  test('la recherche d’un écran ne répond jamais pour une autre : rien de caché, de compté « 0 espèce » ni de dit vide avant sa propre réponse — au premier chargement, d’un écran à l’autre, par l’accueil', async ({ app, page }) => {
    const seen = await watchOrtie(page);
    const listed = () => expect(cellOf(page, 'results').locator('gf-plant-card a.row').first()).toBeVisible();
    // Its first load: the flora ready, its search not answered yet.
    await app.open('#/layout/[results(list,vide=masque),plant.calendar]?q=ortie');
    await listed();
    expect(await seen()).toEqual(NONE);
    // After a screen that found nothing (hidden there): another screen, another search.
    await app.go('#/layout/[results(list,vide=masque),plant.calendar]?q=zzzz');
    await expect(cellOf(page, 'results')).toBeHidden();
    await app.go('#/layout/[plant.calendar,results(list,vide=masque)]?q=ortie');
    await listed();
    expect(await seen()).toEqual(NONE);
    // The same through the home.
    await app.go('#/layout/[results(list,vide=masque),plant.calendar]?q=zzzz');
    await expect(cellOf(page, 'results')).toBeHidden();
    await app.go('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
    await app.go('#/layout/[results(list,vide=masque),plant.calendar]?q=ortie');
    await listed();
    expect(await seen()).toEqual(NONE);
    expect(await cellOf(page, 'results').locator('.cell-head .sub').textContent()).toMatch(/^\d+ espèces?$/);
  });

  test('deck(vide=masque) n’est jamais caché ni au bout de ses cartes avant la réponse de sa recherche — au premier chargement, d’un écran à l’autre, par l’accueil', async ({ app, page }) => {
    const seen = await watchOrtie(page);
    const deck = cellOf(page, 'deck');
    const dealt = () => expect(deck.locator('ma-deck .swipe-card.top')).toBeVisible();
    // Its first load: the flora ready, its search not answered yet.
    await app.open(`#/layout/[deck(vide=masque),plant.status]?${AT}&r=1km&q=ortie`);
    await dealt();
    expect(await seen()).toEqual(NONE);
    // After a screen whose deck had no card (hidden there): another screen, another search.
    await app.go(`#/layout/[deck(vide=masque),plant.status]?${AT}&r=1km&q=zzzz`);
    await expect(deck).toBeHidden();
    await app.go(`#/layout/[plant.status,deck(vide=masque)]?${AT}&r=1km&q=ortie`);
    await dealt();
    expect(await seen()).toEqual(NONE);
    // The same through the home.
    await app.go(`#/layout/[deck(vide=masque),plant.status]?${AT}&r=1km&q=zzzz`);
    await expect(deck).toBeHidden();
    await app.go('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
    await app.go(`#/layout/[deck(vide=masque),plant.status]?${AT}&r=1km&q=ortie`);
    await dealt();
    expect(await seen()).toEqual(NONE);
  });

  test('results(zone=0) ne dit jamais « Aucune plante… » avant la réponse de sa recherche sur toute la flore — au premier chargement, d’un écran à l’autre, par l’accueil', async ({ app, page }) => {
    const seen = await watchOrtie(page);
    const whole = cellOf(page, 'results');
    const listed = () => expect(whole.locator('gf-plant-card a.row').first()).toBeVisible();
    // Its first load: the flora ready, its search over the whole flora not answered yet.
    await app.open(`#/layout/[results(list,zone=0,vide=masque),plant.calendar]?${AT}&q=ortie`);
    await listed();
    expect(await seen()).toEqual(NONE);
    // After a screen that found nothing (hidden there): another screen, another search.
    await app.go(`#/layout/[results(list,zone=0,vide=masque),plant.calendar]?${AT}&q=zzzz`);
    await expect(whole).toBeHidden();
    await app.go(`#/layout/[plant.calendar,results(list,zone=0,vide=masque)]?${AT}&q=ortie`);
    await listed();
    expect(await seen()).toEqual(NONE);
    // The same through the home.
    await app.go(`#/layout/[results(list,zone=0,vide=masque),plant.calendar]?${AT}&q=zzzz`);
    await expect(whole).toBeHidden();
    await app.go('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
    await app.go(`#/layout/[results(list,zone=0,vide=masque),plant.calendar]?${AT}&q=ortie`);
    await listed();
    expect(await seen()).toEqual(NONE);
    expect(await whole.locator('.cell-head .sub').textContent()).toMatch(/^\d+ espèces? · toute la France$/);
  });

  test('results(grid,zone=0) trié au clavier : le focus reste sur son bouton, la grille garde ses en-têtes pendant la réponse de sa recherche', async ({ app, page }) => {
    const seen = await watchOrtie(page);
    await app.open(`#/layout/[results(grid,zone=0)]?${AT}&q=ortie`);
    const whole = cellOf(page, 'results'), list = whole.locator('gf-plant-list');
    await expect(list.locator('gf-plant-card').first()).toBeVisible();
    const head = list.locator('.head[role="row"]'), sort = head.locator('button.sort').first();
    await expect(sort).toHaveText('Photo');
    await sort.focus();
    await sort.press('Enter');
    // Its search over the whole flora asked again, sorted (the worker slowed): the button keeps the focus, the grid its headers.
    await expect.poll(async () => (await wholeSearch(whole)).sort).toBe('photo');
    await expect(sort).toBeFocused();
    await expect(head).toBeVisible();
    // Answered: the same, its rows (kept meanwhile) sorted.
    await expect.poll(async () => (await wholeSearch(whole)).answered).toBe(true);
    await expect(list.locator('gf-plant-card').first()).toBeVisible();
    await expect(sort).toBeFocused();
    await expect(head.locator('[role="columnheader"]').first()).toHaveAttribute('aria-sort', 'ascending');
    expect(await seen()).toEqual(NONE);
  });

  test('la grille triée deux fois au clavier avant la réponse : l’ordre inverse, comme deux fois après', async ({ app, page }) => {
    await watchOrtie(page);
    await app.open(`#/layout/[results(grid,zone=0)]?${AT}&q=ortie`);
    const whole = cellOf(page, 'results'), list = whole.locator('gf-plant-list');
    await expect(list.locator('gf-plant-card').first()).toBeVisible();
    const sort = list.locator('.head[role="row"] button.sort').first();
    await expect(sort).toHaveText('Photo');
    // Twice in a row (the worker slowed: the first answer not come): the second reverses the first.
    await sort.press('Enter');
    await sort.press('Enter');
    await expect.poll(() => param(page, 'sort')).toBe('-photo');
    await expect.poll(async () => (await wholeSearch(whole)).sort).toBe('-photo');
    await expect.poll(async () => (await wholeSearch(whole)).answered).toBe(true);
    await expect(list.locator('[role="columnheader"]').first()).toHaveAttribute('aria-sort', 'descending');
  });

  test('« Aucune plante… » d’une recherche vide ne reste pas sur la suivante : retenu tant que sa réponse n’est pas venue', async ({ app, page }) => {
    const seen = await watchOrtie(page);
    await app.open('#/layout/[search(list=0),results(list)]?q=zzzz');
    const empty = cellOf(page, 'results').locator('gf-plant-list .empty');
    await expect(empty).toHaveText('Aucune plante ne correspond à cette recherche.');
    // Another text typed (the worker slowed): nothing said empty of it before its answer, its rows then.
    await cellOf(page, 'search').locator('gf-plant-search input').fill('ortie');
    await expect(cellOf(page, 'results').locator('gf-plant-card a.row').first()).toBeVisible();
    expect((await seen()).empty).toBe(0);
    await expect(empty).toHaveCount(0);
  });

  test('results(grid,zone=0) : pendant la réponse d’une autre recherche, ses lignes d’avant restent ; un autre écran ne montre jamais celles du précédent', async ({ app, page }) => {
    const seen = await watchWhole(page);
    await app.open(`#/layout/[results(grid,zone=0)]?${AT}&q=ortie`);
    const whole = cellOf(page, 'results'), list = whole.locator('gf-plant-list');
    await expect(list.locator('gf-plant-card').first()).toBeVisible();
    // Sorted from its header (the worker slowed): asked again, its rows kept until the answer.
    await list.locator('.head[role="row"] button.sort').first().press('Enter');
    await expect.poll(async () => (await wholeSearch(whole)).sort).toBe('photo');
    await expect.poll(async () => (await wholeSearch(whole)).answered).toBe(true);
    await expect(list.locator('gf-plant-card').first()).toBeVisible();
    // Another screen, another search: never the nettle's rows while its own come.
    await app.go(`#/layout/[plant.calendar,results(list,zone=0)]?${AT}&q=ail`);
    await expect.poll(async () => (await wholeSearch(cellOf(page, 'results'))).answered).toBe(true);
    await expect(cellOf(page, 'results').locator('gf-plant-card').first()).toBeVisible();
    expect(await seen()).toEqual({ bare: 0, foreign: 0 });
  });

  test('plante=<id> : un bloc à sa plante, quelle que soit la plante courante', async ({ app, page }) => {
    const ortie = plantId(ORTIE), ail = plantId(AIL);
    await app.open(`#/layout/[results(list),plant.status(plante=${ail}),plant.calendar]?p=${ortie}&q=allium`);
    const fixed = cellOf(page, 'plant.status'), cal = cellOf(page, 'plant.calendar');
    await expect(fixed.locator('gf-plant-detail')).toHaveAttribute('plant-id', String(ail));
    await expect(cal.locator('gf-plant-detail')).toHaveAttribute('plant-id', String(ortie));
    // Its head: a pin, its own plant's names.
    await expect(fixed.locator('.cell-head .pin')).toBeVisible();
    await expect(fixed.locator('.cell-head .sub')).toContainText('Plante fixée');
    await expect(cal.locator('.cell-head .pin')).toHaveCount(0);
    // Another plant chosen: the calendar follows, the fixed block does not.
    await cellOf(page, 'results').locator('gf-plant-card a.row').first().click();
    await expect.poll(() => param(page, 'p')).not.toBe(String(ortie));
    const now = /** @type {string} */ (await param(page, 'p'));
    await expect(cal.locator('gf-plant-detail')).toHaveAttribute('plant-id', now);
    await expect(fixed.locator('gf-plant-detail')).toHaveAttribute('plant-id', String(ail));
  });

  test('zone=0 : des résultats sur toute la France, à côté d’une recherche gardée à la zone', async ({ app, page }) => {
    await app.open(`#/layout/[place(r=1km),search(list=0),results(list,france)]?${AT}`);
    await expect.poll(async () => (await screenSearch(page))?.total).toBe(12);
    await expect(cellOf(page, 'search').locator('.sub')).toHaveText('12 espèces');
    const whole = cellOf(page, 'results');
    await expect(whole.locator('.sub')).toHaveText('300 espèces · toute la France');
    await expect(whole.locator('.scope')).toContainText('ne suit pas la zone');
    // The search typed: both follow, each in its own scope.
    await page.locator('dl-search gf-plant-search input').fill('ortie');
    await expect(cellOf(page, 'search').locator('.sub')).toHaveText('1 espèce');
    await expect(whole.locator('.sub')).toContainText('· toute la France');
    await expect.poll(() => hash(page)).toContain('results(view=list,zone=0)');
    await shot(page, 'zone-0');
  });

  test('les actions de l’en-tête : agrandir (Échap revient), replier (sa part aux autres), partager (le lien de la case seule)', async ({ app, page }) => {
    await page.addInitScript(() => {
      /** @type {any} */ (window).__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (/** @type {string} */ t) => { /** @type {any} */ (window).__copied.push(t); } } });
    });
    const ortie = plantId(ORTIE);
    await app.open(`#/layout/[results(list),plant(actions=Agrandir+replier+partager)]?p=${ortie}&q=ortie`);
    const sheet = cellOf(page, 'plant'), results = cellOf(page, 'results');
    const acts = sheet.locator('.cell-acts');
    await expect(acts.locator('button')).toHaveCount(3);
    const body = await box(page.locator('gf-layout .body'));
    // Agrandir: over the whole layout; Échap: back in its place, the focus on its button.
    await acts.getByRole('button', { name: 'Agrandir « Fiche »' }).click();
    await expect(sheet).toHaveClass(/maxed/);
    await expect.poll(async () => (await box(sheet)).width).toBeGreaterThan(body.width - 2);
    await shot(page, 'agrandir');
    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveClass(/maxed/);
    expect((await box(sheet)).width).toBeLessThan(body.width * 0.7);
    await expect(acts.locator('[data-act="agrandir"]')).toBeFocused();
    // ✕ (the same button) as well.
    await acts.locator('[data-act="agrandir"]').click();
    await expect(sheet).toHaveClass(/maxed/);
    await acts.getByRole('button', { name: /Revenir à l’écran/ }).click();
    await expect(sheet).not.toHaveClass(/maxed/);
    // Replier: its head alone, its share to the results; kept in the layout (etat=replie), as the app is sent.
    const before = (await box(results)).width;
    await acts.getByRole('button', { name: 'Replier « Fiche »' }).click();
    await expect(sheet.locator('.cell-body')).toBeHidden();
    await expect.poll(async () => (await box(results)).width).toBeGreaterThan(before + 200);
    await shot(page, 'replier');
    await expect.poll(() => hash(page)).toBe(`#/layout/[results(view=list),plant(actions=agrandir+replier+partager,etat=replie)]?p=${ortie}&q=ortie`);
    await page.reload();
    await app.ready();
    await expect(sheet.locator('.cell-body')).toBeHidden();
    await acts.getByRole('button', { name: 'Déplier « Fiche »' }).click();
    await expect(sheet.locator('gf-plant-detail')).toBeVisible();
    await expect.poll(() => hash(page)).toBe(`#/layout/[results(view=list),plant(actions=agrandir+replier+partager)]?p=${ortie}&q=ortie`);
    // Partager: a layout of this cell alone, with the same state.
    await acts.locator('[data-act="partager"]').click();
    await expect(acts.locator('[data-act="partager"]')).toHaveAttribute('aria-label', 'Lien copié');
    const copied = await page.evaluate(() => /** @type {any} */ (window).__copied.map((/** @type {string} */ u) => decodeURIComponent(new URL(u).hash)));
    expect(copied).toEqual([`#/layout/[plant(actions=agrandir+replier+partager)]?p=${ortie}&q=ortie`]);
  });

  test('toucher : un résultat qui ouvre sa fiche (toucher=fiche), un qui ne fait rien (toucher=rien) ; ecrit=0', async ({ app, page }) => {
    await app.open('#/layout/[results(list,toucher=rien),plant.calendar]?q=ortie');
    const row = cellOf(page, 'results').locator('gf-plant-card a.row').first();
    await row.click();
    await page.waitForTimeout(300);
    expect(await param(page, 'p')).toBe(null);
    expect(await hash(page)).toMatch(/^#\/layout\//);
    await app.go('#/layout/[results(list,ecrit=0),plant.calendar]?q=ortie');
    await cellOf(page, 'results').locator('gf-plant-card a.row').first().click();
    await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+/);
  });

  test('en modification : « Cadre » et « Liens » dans le choix du contenu, écrits dans l’adresse ; l’écran en usage les montre', async ({ app, page }) => {
    await app.open(screen('[results(list),plant.wikipedia]', `p=${plantId(ORTIE)}`, true));
    const p = page.locator('gf-block-picker:not([inline])');
    await page.locator('gf-layout section.cell[data-comp="plant.wikipedia"] .cell-head .pick').click();
    await expect(p.locator('.row')).toHaveText([/Réglages/, /Cadre/, /Liens/]);
    await p.locator('.row[data-group="Cadre"]').click();
    await p.locator('[data-param="tete"] button[data-value="simple"]').click();
    await p.locator('[data-param="actions"] button[data-value="agrandir"]').click();
    await p.locator('[data-param="vide"] button[data-value="masque"]').click();
    await p.locator('[data-param="titre"] input').fill('Article, (le) mien');
    await p.locator('[data-param="titre"] input').press('Enter');
    await p.locator('.back').click();
    // The current plant fixed in one touch.
    await p.locator('.row[data-group="Liens"]').click();
    await p.locator('[data-param="plante"] [data-act="fix"]').click();
    await shot(page, 'editeur-cadre');
    const spec = `[results(view=list),plant.wikipedia(tete=simple,actions=agrandir,vide=masque,plante=${plantId(ORTIE)},titre=Article le mien)]`;
    await expect.poll(() => layoutOf(page)).toBe(spec);
    await page.keyboard.press('Escape');
    // « Terminé »: the screen in use, the same layout and state.
    await page.locator('gf-layout [data-act="modifier"]').click();
    await expect.poll(() => hash(page)).toBe(`#/layout/${spec}?p=${plantId(ORTIE)}`);
    await expect(cellOf(page, 'plant.wikipedia').locator('.cell-head h2')).toHaveText('Article le mien');
    // A component that cannot be empty has no « Sans rien à montrer »; the results, not the plant links but the zone.
    await page.locator('gf-layout [data-act="modifier"]').click();
    await page.locator('gf-layout section.cell[data-comp="results"] .cell-head .pick').click();
    await p.locator('.row[data-group="Cadre"]').click();
    await expect(p.locator('[data-param="vide"]')).toHaveCount(1);
    await p.locator('.back').click();
    await p.locator('.row[data-group="Liens"]').click();
    await expect(p.locator('[data-param="plante"]')).toHaveCount(0);
    await expect(p.locator('[data-param="zone"] [role="switch"]')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone');

  test('titre= nomme l’onglet ; tete=non : la case sans en-tête, son onglet la nomme', async ({ app, page }) => {
    await app.open(`#/layout/[results(list),plant(titre=Ma plante,tete=non)]?p=${plantId(ORTIE)}`);
    const tabs = page.getByRole('tablist', { name: 'Colonnes' }).getByRole('tab');
    await expect(tabs.nth(1)).toHaveAccessibleName('Ma plante');
    await tabs.nth(1).click();
    const sheet = cellOf(page, 'plant');
    await expect(sheet.locator('gf-plant-detail')).toBeVisible();
    await expect(sheet.locator('.cell-head')).toHaveCount(0);
    await shot(page, 'telephone-titre');
  });
});
