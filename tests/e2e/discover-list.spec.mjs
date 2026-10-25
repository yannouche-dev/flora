// The Découvrir tab: the list of the activities (gf-launcher, the same as the film icon's dialog) as a page of its
// own — the activities, nothing else (Scientifique is a mode, not an activity). « Commencer » opens one (and changes
// nothing else: Cueillette prudente leaves the harvest mode as it was), « Quitter l’activité » comes back to the list;
// the first launch lands on it, and an activity done there brings the tabs; the old addresses of Découvrir lead to the
// activities. Rencontres' services answered here.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const ORDER = ['Rencontres', 'Parcours botanique', 'Cueillette prudente', 'Mosaïque', 'Faux amis', 'Orchidées de Mirabel'];
/** @param {import('@playwright/test').Page} page */
const hash = page => page.evaluate(() => location.hash);
/** The page's list (not Découvrir's dialog). @param {import('@playwright/test').Page} page */
const list = page => page.locator('gf-launcher[page]');

/** The Découvrir tab, touched: the tab bar on a phone, the header's sections on a desktop. @param {import('./app.mjs').App} app */
async function discoverTab(app) {
  const nav = app.phone ? app.page.locator('gf-tabbar nav') : app.page.locator('gf-app nav.tabs');
  await nav.getByRole('link', { name: 'Découvrir' }).click();
}

test('l’onglet Découvrir montre la liste ; « Commencer » ouvre Rencontres, « Quitter l’activité » ramène à la liste', async ({ app, page }) => {
  await app.open('#/collections');
  await discoverTab(app);
  await expect.poll(() => hash(page)).toBe('#/discover');
  await expect(list(page).getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
  expect((await list(page).getByRole('heading', { level: 2 }).allTextContents()).map(t => t.trim())).toEqual(ORDER);
  // Not Rencontres by itself: no start screen of an activity here.
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toHaveCount(0);
  // Each card: its picture, its pitch, one action named after it.
  await expect(list(page).locator('li .pic')).toHaveCount(6);
  // Rows as even as can be, never a card alone: three and three on a desktop (a shorter row centred), one a row on a phone.
  const boxes = await list(page).locator('ul > li').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: Math.round(r.y), w: r.width }; }));
  const rows = [...new Set(boxes.map(b => b.y))].map(y => boxes.filter(b => b.y === y));
  if (app.phone) expect(rows.map(r => r.length)).toEqual([1, 1, 1, 1, 1, 1]);
  else {
    expect(rows.map(r => r.length)).toEqual([3, 3]);
    const last = rows[1][rows[1].length - 1];
    const left = rows[0][0].x, right = rows[0][2].x + rows[0][2].w, l2 = rows[1][0].x, r2 = last.x + last.w;
    expect(Math.abs((l2 - left) - (right - r2))).toBeLessThan(2);
  }
  await expect(list(page).getByRole('button', { name: 'Commencer : Scientifique' })).toHaveCount(0);
  await expect(list(page).locator('li[data-app="rencontres"] p')).toContainText('une carte à la fois');
  await expect(list(page).getByText('Des activités pour découvrir la flore, chacune avec les outils qu’il lui faut. On peut en changer quand on veut.')).toBeVisible();

  await list(page).getByRole('button', { name: 'Commencer : Rencontres' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/start');
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  await page.locator('gf-miniapp .quit').click();
  await expect.poll(() => hash(page)).toBe('#/discover');
  await expect(list(page).getByRole('button', { name: 'Commencer : Rencontres' })).toBeVisible();
  // The tab is the current one again.
  const current = app.phone ? page.locator('gf-tabbar a[aria-current="page"]') : page.locator('gf-app nav.tabs a[aria-current="page"]');
  await expect(current).toContainText('Découvrir');
});

test('une activité en cours se continue ; Cueillette prudente est une activité', async ({ app, page }) => {
  await app.open('#/discover');
  await expect(list(page).getByRole('button', { name: 'Commencer : Parcours botanique' })).toBeVisible();
  // A place kept by Rencontres: « Continuer » (and « Recommencer ») for it only.
  await page.evaluate(() => localStorage.setItem('geoflora.app.rencontres.state', JSON.stringify({ v: 1, path: ['start', 'map', 'cards'], ctx: { point: [2.35, 48.85], place: 'Paris' }, finished: false })));
  await app.go('#/collections');
  await app.go('#/discover');
  await expect(list(page).getByRole('button', { name: 'Continuer : Rencontres' })).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Continuer : Rencontres' })).toHaveAttribute('title', 'Continuer là où vous l’aviez laissée');
  await expect(list(page).getByRole('button', { name: 'Recommencer : Rencontres' })).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Commencer : Cueillette prudente' })).toBeVisible();
  // Launched, it changes nothing else in the app: the harvest mode stays as it was (stored, and on screen).
  const harvest = { on: await app.state('harvestMode'), kept: await page.evaluate(() => localStorage.getItem('geoflora.harvestModeChoice')) };
  await list(page).getByRole('button', { name: 'Commencer : Cueillette prudente' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(list(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/map');
  expect({ on: await app.state('harvestMode'), kept: await page.evaluate(() => localStorage.getItem('geoflora.harvestModeChoice')) }).toEqual(harvest);
});

test('les anciennes adresses de Découvrir mènent où elles menaient', async ({ app, page }) => {
  const ail = plantId('Allium ursinum');
  await app.open(`#/discover?p=${ail}`);
  await expect.poll(() => hash(page)).toMatch(new RegExp(`^#/app/rencontres/[a-z]+\\?p=${ail}&fiche=1$`));
  await app.go('#/discover?s=mosaic');
  await expect.poll(() => hash(page)).toBe('#/app/mosaique/start');
  await expect(page.getByRole('heading', { name: 'La mosaïque du coin' })).toBeVisible();
  // An unknown old ?s=: the list.
  await app.go('#/discover?s=inconnu');
  await expect(list(page).getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
  // Scientifique's old card (a mode now, no longer in the list): the list too, the mode untouched.
  await app.go('#/collections');
  const mode = await app.state('mode');
  await app.go('#/discover?s=science');
  await expect(list(page).getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
  expect((await list(page).getByRole('heading', { level: 2 }).allTextContents()).map(t => t.trim())).toEqual(ORDER);
  expect(await app.state('mode')).toBe(mode);
});

test.describe('premier lancement', () => {
  test.use({ firstVisit: true });

  test('la liste accueille ; Rencontres jouée fait venir Mes plantes, et « Quitter l’activité » ramène à la liste', async ({ app, page }) => {
    await app.open('#/');
    await expect.poll(() => hash(page)).toBe('#/discover');
    await expect(list(page).getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toHaveCount(0);
    expect(await app.tabs()).not.toContain('Mes plantes');

    await list(page).getByRole('button', { name: 'Commencer : Rencontres' }).click();
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    const discover = page.locator('ma-guided');
    await discover.locator('.g-steps [data-step="go"]').click();
    await expect(discover.locator('.swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(async () => (await import('/app/core/discover.js')).discoverState().unlocked)).toContain('mine');

    await page.locator('gf-miniapp .quit').click();
    await expect.poll(() => hash(page)).toBe('#/discover');
    await expect(list(page).getByRole('button', { name: 'Continuer : Rencontres' })).toBeVisible();
    await expect.poll(() => app.tabs()).toContain('Mes plantes');
    expect(await app.tabs()).not.toContain('Flore');
  });
});
