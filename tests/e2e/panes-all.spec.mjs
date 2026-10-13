// « Tous les volets sont redimensionnables horizontalement, toutes les dispositions sont responsives » (README,
// « Disposition et panneaux »), checked on every screen: at 320, 390, 768, 1024, 1280 and 1920 px, the page never
// scrolls sideways (the window resized in place, as a rotation does: the widths kept are clamped anew), and every
// separator between two panneaux answers ← → (a width changes) and Entrée (its default back). Then the separators
// added for it — « À propos de l’image » beside a photo, a plant's sheet beside the cards of a mini-app —: kept across
// a reload, forgotten by « Recommencer »; a finger gets 44 px to hold; a new visitor who drags one keeps the first steps.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('./app.mjs').App} App */

const WIDTHS = [1280, 1920, 1024, 768, 390, 320];
const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
const stored = (/** @type {Page} */ page, /** @type {string} */ key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
/** How far the page is wider than the window (0: no sideways scroll). @param {Page} page */
const sideScroll = (page) => page.evaluate(() => /** @type {Element} */ (document.scrollingElement).scrollWidth - innerWidth);

/** A place with two plants, a list with one. @param {Page} page */
const seed = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const [ail, ortie] = await Promise.all(ids.map(id => db.get('plants', id)));
  const place = c.withPlant(c.withPlant(c.newPlace([2.351, 48.851], { name: 'Bois de la Source' }), ail), ortie, [2.3512, 48.8509]);
  await c.saveCollection(place);
  const list = c.withPlant(c.newCollection('list', { name: 'À cueillir' }), ail);
  await c.saveCollection(list);
  return { place: place.id, list: list.id };
}, [plantId('Allium ursinum'), plantId('Urtica dioica')]);

/** A mini-app around a place, played to its cards. @param {Page} page @param {string} id */
async function toCards(page, id) {
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/map`);
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/cards`);
}

/** The photos of a plant beside its sheet, « À propos de l’image » open. @param {App} app @param {Page} page */
async function mediaInfo(app, page) {
  await app.open(`#/plant/${plantId('Urtica dioica')}?pane=media`);
  await page.locator('gf-media-viewer').first().getByRole('button', { name: 'À propos de cette image' }).click();
  await expect(page.locator('gf-media-viewer aside#media-info')).toBeVisible();
}

/** Mosaïque's cards, the first plant open in its sheet beside them. @param {App} app @param {Page} page */
async function mosaicPlant(app, page) {
  await app.open('#/app/mosaique');
  await toCards(page, 'mosaique');
  await page.locator('ma-around-list .grid.mosaic .card').first().click();
  await expect(page.locator('ma-plant-sheet .sheet')).toBeVisible();
}

/** Every screen, as a visitor reaches it. @type {Record<string, (app: App, page: Page) => Promise<unknown>>} */
const SCREENS = {
  'Découvrir': app => app.open('#/discover'),
  'Flore': app => app.open('#/'),
  'Flore, une plante': app => app.open(`#/plant/${plantId('Urtica dioica')}`),
  'Flore, ses médias en volet, « À propos de l’image »': mediaInfo,
  'Mes plantes, une liste ouverte': async (app, page) => { await app.open('#/'); const { list } = await seed(page); await app.open(`#/collections?c=${list}`); },
  'Mes plantes, un lieu et une plante': async (app, page) => {
    await app.open('#/'); const { place } = await seed(page); await app.open(`#/collections?c=${place}&plant=${plantId('Urtica dioica')}`);
  },
  'Nouveau lieu': app => app.open('#/collection/new?kind=place'),
  'Éditeur d’un lieu': async (app, page) => { await app.open('#/'); const { place } = await seed(page); await app.open(`#/collection/${place}`); },
  'Carte': app => app.open('#/map'),
  'Carte, un lieu': async (app, page) => { await app.open('#/'); const { place } = await seed(page); await app.open(`#/map?spot=${place}`); },
  'Réglages': app => app.open('#/settings'),
  'Mentions légales': app => app.open('#/legal'),
  'Rencontres, ses cartes': async (app, page) => { await app.open('#/app/rencontres'); await toCards(page, 'rencontres'); },
  'Rencontres, photos à côté des cartes': async (app, page) => {
    await app.open('#/app/rencontres'); await toCards(page, 'rencontres');
    await page.locator('ma-deck .round.like').click();
    await expect(page.locator('ma-meet-media#meet-media-pane')).toBeVisible();
  },
  'Cueillette, ses cartes': async (app, page) => { await app.open('#/app/cueillette'); await toCards(page, 'cueillette'); },
  'Mosaïque, une plante à côté': mosaicPlant,
  'Parcours, en marche': async (app, page) => { await app.open('#/app/parcours'); await page.locator('gf-miniapp .go').click(); await expect(page.locator('gf-miniapp .card input.name')).toBeVisible(); }
};

/** The screens of one column (no panneaux side by side, at any width): cards, lists, settings, a map alone. */
const ONE_COLUMN = ['Découvrir', 'Carte', 'Réglages', 'Mentions légales', 'Rencontres, ses cartes', 'Cueillette, ses cartes'];

/**
 * Each separator between two panneaux (side by side) on screen: ← and → change a width (one of them at least: a pane
 * at its least or widest moves one way only), Entrée gives back the one it had. @param {Page} page @param {string} where
 */
async function separatorsAnswer(page, where) {
  const seps = page.locator('[role=separator][aria-orientation=vertical]');
  const n = await seps.count();
  let seen = 0;
  for (let i = 0; i < n; i++) {
    const sep = seps.nth(i);
    if (!await sep.isVisible()) continue;
    seen++;
    const label = await sep.getAttribute('aria-label');
    expect(label, where).toMatch(/^Redimensionner /);
    const now = async () => Number(await sep.getAttribute('aria-valuenow'));
    const v0 = await now();
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    const v1 = await now();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const v2 = await now();
    expect(v1 !== v0 || v2 !== v1, `${where} · ${label} : ← → change sa largeur`).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(now, { message: `${where} · ${label} : Entrée` }).toBe(v0);
  }
  return seen;
}

test.describe('chaque écran, chaque largeur', () => {
  test.skip(({ isMobile }) => isMobile, 'les largeurs, du téléphone au grand écran : une fois, au bureau');
  test.use({ reducedMotion: 'reduce' });
  test.beforeEach(({ context }) => answerAround(context));

  for (const [name, open] of Object.entries(SCREENS)) {
    test(`${name} : jamais de défilement de côté ; ses séparateurs répondent au clavier`, async ({ app, page }) => {
      await open(app, page);
      let separators = 0;
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
        await expect.poll(() => sideScroll(page), { message: `${name} à ${w} px` }).toBeLessThanOrEqual(0);
        separators += await separatorsAnswer(page, `${name} à ${w} px`);
        expect(await sideScroll(page), `${name} à ${w} px, après le clavier`).toBeLessThanOrEqual(0);
      }
      // A phone: the panneaux stacked, no separator between them.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.locator('[role=separator][aria-orientation=vertical]').evaluateAll(els => els.filter(e => e.getBoundingClientRect().width > 0).length)).toBe(0);
      // The screens with panneaux side by side had their separators tried (the others have none: one column).
      if (!ONE_COLUMN.includes(name)) expect(separators, name).toBeGreaterThan(0);
    });
  }

  test('« À propos de l’image » à côté de la photo : sa largeur se règle, retenue au rechargement, Entrée la rend', async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mediaInfo(app, page);
    const info = page.locator('gf-media-viewer aside#media-info');
    const sep = page.locator('gf-media-viewer [role=separator][aria-controls="media-info"]');
    await expect(sep).toHaveAttribute('aria-label', 'Redimensionner le panneau à propos de l’image');
    await expect(sep).toHaveAttribute('aria-valuemin', '240');
    const width = () => info.evaluate(e => Math.round(e.getBoundingClientRect().width));
    const w0 = await width();
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width).toBe(w0 + 16);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(width).toBe(w0 + 80);
    expect((await stored(page, 'geoflora.mediaLayout')).widths.info).toBe(w0 + 80);
    await page.reload();
    await app.ready();
    await page.locator('gf-media-viewer').first().getByRole('button', { name: 'À propos de cette image' }).click().catch(() => {});
    await expect.poll(width).toBe(w0 + 80);
    // Narrower than the photo needs: the details under it, no separator.
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(() => sideScroll(page)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sep.focus();
    await page.keyboard.press('Enter');
    await expect.poll(width).toBe(w0);
    expect((await stored(page, 'geoflora.mediaLayout')).widths.info).toBeUndefined();
  });

  test('une plante à côté des cartes (Mosaïque) : sa largeur se règle et se garde ; « Recommencer » l’oublie', async ({ app, page }) => {
    await mosaicPlant(app, page);
    const body = page.locator('ma-plant-sheet #ma-sheet-body');
    const sep = page.locator('ma-plant-sheet [role=separator][aria-controls="ma-sheet-body"]');
    await expect(sep).toHaveAttribute('aria-label', 'Redimensionner le panneau plante');
    await expect(sep).toHaveAttribute('aria-valuemin', '360');
    await expect(sep).toHaveAttribute('aria-valuemax', String(1280 - 320));
    const width = () => body.evaluate(e => Math.round(e.getBoundingClientRect().width));
    const w0 = await width();
    expect(w0).toBe(Math.round(Math.min(560, 0.48 * 1280) - 1));
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width).toBe(w0 + 16);
    // The cards keep clear of it.
    const list = page.locator('ma-around-list section.list');
    await expect.poll(() => list.evaluate(e => Math.round(innerWidth - e.getBoundingClientRect().right))).toBeGreaterThanOrEqual(w0 + 16);
    expect((await stored(page, 'geoflora.app.mosaique.sheet')).widths.sheet).toBe(w0 + 16);
    await page.reload();
    await app.ready();
    await expect(page.locator('ma-plant-sheet .sheet')).toBeVisible();
    await expect.poll(width).toBe(w0 + 16);
    // A narrower window: clamped to it (the cards keep 320 px), the width kept; back, it has it again.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(width).toBe(Math.min(w0 + 16, 900 - 320));
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(width).toBe(w0 + 16);
    // « Recommencer » (the mini-app's own storage): the width forgotten.
    await page.evaluate(async () => {
      const { replayApp } = await import('/app/miniapp/runtime.js');
      await replayApp((await import('/app/miniapps/mosaique.js')).default);
    });
    expect(await stored(page, 'geoflora.app.mosaique.sheet')).toBeNull();
  });

  test('une fenêtre agrandie puis réduite : les largeurs gardées se recalent, la page ne défile jamais de côté', async ({ app, page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      for (const k of ['geoflora.collectionsLayout', 'geoflora.mapLayout']) localStorage.setItem(k, JSON.stringify({ widths: { list: 1800, place: 1800, plant: 1800 }, folded: {} }));
    });
    await app.open('#/');
    const { place } = await seed(page);
    for (const route of [`#/collections?c=${place}&plant=${plantId('Urtica dioica')}`, `#/map?spot=${place}`]) {
      await app.go(route);
      for (const w of [1920, 1024, 768, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        await expect.poll(() => sideScroll(page), { message: `${route} à ${w} px` }).toBeLessThanOrEqual(0);
        // Each separator's value within its bounds, its maximum the room there is now.
        const bad = await page.locator('[role=separator][aria-orientation=vertical]').evaluateAll(els => els
          .filter(e => e.getBoundingClientRect().width > 0)
          .filter(e => { const [v, lo, hi] = ['now', 'min', 'max'].map(k => Number(e.getAttribute('aria-value' + k))); return v < lo || v > hi || hi > innerWidth; })
          .map(e => e.getAttribute('aria-label')));
        expect(bad, `${route} à ${w} px`).toEqual([]);
      }
    }
  });
});

test.describe('au doigt', () => {
  test.skip(({ isMobile }) => !isMobile, 'un écran tactile');

  test('une tablette : chaque séparateur offre 44 px à tenir', async ({ app, page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await app.open(`#/plant/${plantId('Urtica dioica')}`);
    const seps = page.locator('[role=separator][aria-orientation=vertical]');
    await expect.poll(() => seps.count()).toBeGreaterThan(0);
    const widths = await seps.evaluateAll(els => els.filter(e => e.getBoundingClientRect().height > 0).map(e => Math.round(e.getBoundingClientRect().width)));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(44);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
  });

  test('320 et 390 px : aucun écran ne défile de côté', async ({ app, page }) => {
    for (const w of [320, 390]) {
      await page.setViewportSize({ width: w, height: 700 });
      for (const route of ['#/', '#/discover', '#/collections', '#/collection/new?kind=place', '#/map', '#/settings', '#/legal', `#/plant/${plantId('Urtica dioica')}`]) {
        await app.open(route);
        await expect.poll(() => sideScroll(page), { message: `${route} à ${w} px` }).toBeLessThanOrEqual(0);
      }
    }
  });
});

test.describe('premier lancement', () => {
  test.use({ firstVisit: true });
  test.skip(({ isMobile }) => isMobile, 'une fois suffit : le bureau');

  test('des largeurs de volets gardées ne font pas un « habitué » : les premiers pas restent', async ({ app, page }) => {
    await page.addInitScript(async () => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      for (const k of ['geoflora.discoverLayout', 'geoflora.trailLayout', 'geoflora.floraLayout', 'geoflora.collectionsLayout', 'geoflora.mapLayout',
        'geoflora.placeLayout', 'geoflora.mediaLayout', 'geoflora.app.mosaique.sheet', 'geoflora.app.rencontres.layout']) {
        localStorage.setItem(k, JSON.stringify({ widths: { a: 300 }, folded: {} }));
      }
    });
    await app.open('#/');
    expect(await page.evaluate(async () => (await import('/app/config.js')).config.paneLayouts.length)).toBeGreaterThanOrEqual(7);
    expect(await app.tabs()).not.toContain('Flore');
    expect(await page.evaluate(async () => (await import('/app/core/discover.js')).discovering())).toBe(true);
  });
});
