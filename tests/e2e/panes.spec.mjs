// Resizable panes (core/panes.js) in Flore (Filtres ┃ Résultats ┃ Plante), the editor of a new place (carte ┃ lieu)
// and the plant sheet's grips (its panes): drag, keyboard (← →, Début / Fin, Entrée), double click, widths kept
// across a reload, the separators' ARIA; on a phone, the panes stacked, no separator, no horizontal scroll.
import { test, expect, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

const width = (/** @type {Locator} */ el) => el.evaluate(e => Math.round(e.getBoundingClientRect().width));
const stored = (/** @type {Page} */ page, /** @type {string} */ key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
/** No page wider than the window. @param {Page} page */
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Drags a separator by dx px (its guide line follows; the width is taken on release). @param {Page} page @param {Locator} sep @param {number} dx */
async function drag(page, sep, dx) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await sep.boundingBox());
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + dx * i / 5, y);
  await page.mouse.up();
}

test.describe('ordinateur', () => {
  test.skip(({ isMobile }) => isMobile, 'les séparateurs : le bureau');

  test('Flore : Filtres et Plante se redimensionnent (glisser, clavier, double-clic), retenus au rechargement', async ({ app, page }) => {
    await app.open('#/');
    const filters = page.locator('gf-flora section.pane.filters');
    const sep = page.locator('gf-flora [role=separator][aria-controls="flore-filters"]');
    await expect(sep).toHaveAttribute('aria-label', 'Redimensionner le panneau filtres');
    await expect(sep).toHaveAttribute('aria-valuemin', '220');
    await expect(sep).toHaveAttribute('aria-valuenow', '280');
    expect(Number(await sep.getAttribute('aria-valuemax'))).toBe(480);
    expect(await width(filters)).toBe(280);

    await drag(page, sep, 60);
    await expect.poll(() => width(filters)).toBe(340);
    expect((await stored(page, 'geoflora.floraLayout')).widths.filters).toBe(340);

    await sep.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => width(filters)).toBe(356);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => width(filters)).toBe(292);
    await page.keyboard.press('Home');
    await expect.poll(() => width(filters)).toBe(220);
    await page.keyboard.press('End');
    await expect.poll(() => width(filters)).toBe(480);
    await expect(sep).toHaveAttribute('aria-valuenow', '480');

    await page.reload();
    await app.ready();
    await expect.poll(() => width(filters)).toBe(480);
    await sep.dblclick();
    await expect.poll(() => width(filters)).toBe(280);
    await sep.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => width(filters)).toBe(464);
    await page.keyboard.press('Enter');
    await expect.poll(() => width(filters)).toBe(280);
    expect((await stored(page, 'geoflora.floraLayout')).widths.filters).toBeUndefined();

    // A plant open: its pane's separator; ← → on it never passes to the next plant.
    const nettle = plantId('Urtica dioica');
    await app.go(`#/plant/${nettle}`);
    const plant = page.locator('gf-flora section.pane.plant');
    const psep = page.locator('gf-flora [role=separator][aria-controls="flore-plant"]');
    await expect(psep).toHaveAttribute('aria-label', 'Redimensionner le panneau plante');
    expect(await width(plant)).toBe(480);
    await drag(page, psep, -40);
    await expect.poll(() => width(plant)).toBe(520);
    await psep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => width(plant)).toBe(536);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => width(plant)).toBe(520);
    expect(await page.evaluate(() => location.hash)).toBe(`#/plant/${nettle}`);
    await page.keyboard.press('Enter');
    await expect.poll(() => width(plant)).toBe(480);
    expect(await noSideScroll(page)).toBe(true);
  });

  test('Flore : l’ancienne mise en page est reprise ; des largeurs trop grandes ne font jamais défiler de côté', async ({ app, page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('geoflora.floraLayout', JSON.stringify({ filters: 300, plant: 3000, plantPinned: 900, folded: { filters: false, results: false, plant: false } }));
      }
    });
    await app.open(`#/plant/${plantId('Urtica dioica')}`);
    await expect.poll(() => width(page.locator('gf-flora section.pane.filters'))).toBe(300);
    await expect(page.locator('gf-flora section.pane.plant')).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    const results = await width(page.locator('gf-flora section.pane.results'));
    expect(results).toBeGreaterThanOrEqual(280);
  });

  test('Éditeur d’un nouveau lieu : carte ┃ lieu, la largeur du lieu réglable et retenue, la carte reste la même', async ({ app, page }) => {
    await app.open('#/collection/new?kind=place');
    const form = page.locator('gf-spot-editor form#place-form');
    const sep = page.locator('gf-spot-editor [role=separator][aria-controls="place-form"]');
    await expect(sep).toHaveAttribute('aria-label', 'Redimensionner le panneau lieu');
    await expect(sep).toHaveAttribute('aria-valuemin', '360');
    expect(await width(form)).toBe(480);
    const map = page.locator('gf-spot-editor .map-area');
    // Side by side: the map on the left, as tall as the form.
    const [mb, fb] = await Promise.all([map.boundingBox(), form.boundingBox()]);
    expect(mb && fb && mb.x < fb.x && Math.abs(mb.y - fb.y) < 2).toBe(true);

    await drag(page, sep, -100);
    await expect.poll(() => width(form)).toBe(580);
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => width(form)).toBe(596);
    await page.keyboard.press('End');
    await expect.poll(() => width(form)).toBe(1280 - 260 - 1);
    await expect(sep).toHaveAttribute('aria-valuemax', String(1280 - 260 - 1));
    await page.keyboard.press('Home');
    await expect.poll(() => width(form)).toBe(360);
    expect(await page.locator('gf-spot-editor .leaflet-container').count()).toBe(1);

    await page.reload();
    await app.ready();
    await expect.poll(() => width(page.locator('gf-spot-editor form#place-form'))).toBe(360);
    await page.locator('gf-spot-editor [role=separator]').dblclick();
    await expect.poll(() => width(page.locator('gf-spot-editor form#place-form'))).toBe(480);
    expect((await stored(page, 'geoflora.placeLayout')).widths.form).toBeUndefined();
    expect(await noSideScroll(page)).toBe(true);
  });

  test('Fiche : ses poignées entre volets (ARIA, clavier, Entrée), retenues ; une arborescence locale ne touche pas la mise en page du mode', async ({ app, page }) => {
    await app.open('#/');
    await page.evaluate(async () => {
      const sb = await import('/app/core/sheet-blocks.js');
      const { store } = await import('/app/core/store.js');
      sb.dockBlock(store.state.mode, 'taxonomy', 'sheet', 'right');
    });
    await app.go(`#/plant/${plantId('Urtica dioica')}`);
    const grip = page.locator('gf-flora .swipe:not(.under) gf-plant-detail .split-grip').first();
    await expect(grip).toHaveAttribute('aria-label', 'Redimensionner la fiche et « Classification »');
    await expect(grip).toHaveAttribute('aria-valuemin', '8');
    await expect(grip).toHaveAttribute('aria-valuemax', '92');
    const controls = await grip.getAttribute('aria-controls');
    expect(await page.locator(`gf-flora .swipe:not(.under) gf-plant-detail [id="${controls}"]`).count()).toBe(1);
    const now = async () => Number(await grip.getAttribute('aria-valuenow'));
    const start = await now();
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(now).toBe(start + 5);
    await page.keyboard.press('End');
    await expect.poll(now).toBe(92);
    await page.keyboard.press('Home');
    await expect.poll(now).toBe(8);
    await page.keyboard.press('Enter');
    await expect.poll(now).toBe(50);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(now).toBe(45);
    await page.reload();
    await app.ready();
    await expect.poll(() => grip.getAttribute('aria-valuenow')).toBe('45');

    // A tree of the host's (`tree`): the grip moves it, handed back as pane-sizes; the mode's layout stays as it was.
    const before = await page.evaluate(() => localStorage.getItem('geoflora.sheetLayout'));
    await page.evaluate(() => {
      const flora = /** @type {any} */ (document.querySelector('gf-app'))?.shadowRoot.querySelector('gf-flora');
      const el = /** @type {any} */ (flora.shadowRoot.querySelector('.swipe:not(.under) gf-plant-detail'));
      el.tree = { t: 'split', id: 'local', dir: 'row', kids: [{ t: 'sheet', id: 'sheet' }, { t: 'stack', id: 'mine', tabs: ['taxonomy'], active: 'taxonomy' }], sizes: [0.7, 0.3] };
      el.addEventListener('pane-sizes', (/** @type {CustomEvent} */ e) => { el.tree = e.detail; /** @type {any} */ (window).handed = (/** @type {any} */ (window).handed || 0) + 1; });
    });
    await expect.poll(() => grip.getAttribute('aria-valuenow')).toBe('70');
    await grip.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => grip.getAttribute('aria-valuenow')).toBe('65');
    await page.keyboard.press('Enter');
    await expect.poll(() => grip.getAttribute('aria-valuenow')).toBe('50');
    expect(await page.evaluate(() => /** @type {any} */ (window).handed)).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem('geoflora.sheetLayout'))).toBe(before);
  });
});

test.describe('téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'empilé : le téléphone');

  test('Flore, l’éditeur d’un lieu, la fiche : empilés, sans séparateur ni défilement de côté', async ({ app, page }) => {
    // Widths chosen on a computer: nothing of them on a phone.
    await page.addInitScript(() => {
      localStorage.setItem('geoflora.floraLayout', JSON.stringify({ widths: { filters: 480, plant: 900 }, folded: {} }));
      localStorage.setItem('geoflora.placeLayout', JSON.stringify({ widths: { form: 900 }, folded: {} }));
    });
    await app.open('#/');
    expect(await page.locator('gf-flora [role=separator][aria-orientation=vertical]').count()).toBe(0);
    expect(await noSideScroll(page)).toBe(true);
    // (Only the columns' separators: the media viewer keeps its own, for the image's height.)
    // The sheet with a pane docked beside it: on a phone, a band above or under it, no grip.
    await page.evaluate(async () => {
      const sb = await import('/app/core/sheet-blocks.js');
      const { store } = await import('/app/core/store.js');
      sb.dockBlock(store.state.mode, 'taxonomy', 'sheet', 'right');
    });
    await app.go(`#/plant/${plantId('Urtica dioica')}`);
    await expect(page.locator('gf-flora .sheet-plant')).toBeVisible();
    await expect(page.locator('gf-flora .sheet-plant gf-plant-detail [data-pane]').first()).toBeVisible();
    expect(await page.locator('gf-flora [role=separator][aria-orientation=vertical]').count()).toBe(0);
    expect(await page.locator('gf-flora .split-grip').count()).toBe(0);
    expect(await noSideScroll(page)).toBe(true);

    await app.go('#/collection/new?kind=place');
    const form = page.locator('gf-spot-editor form');
    await expect(form).toBeVisible();
    expect(await page.locator('gf-spot-editor [role=separator][aria-orientation=vertical]').count()).toBe(0);
    const [mb, fb] = await Promise.all([page.locator('gf-spot-editor .map-area').boundingBox(), form.boundingBox()]);
    // The map above the form, both the whole width.
    expect(mb && fb && mb.y < fb.y && Math.abs(mb.width - fb.width) < 2).toBe(true);
    expect(await noSideScroll(page)).toBe(true);
  });
});
