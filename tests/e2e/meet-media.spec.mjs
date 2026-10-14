// Rencontres (its list, once the first steps are over): the first match of a game brings the photos of that plant —
// the viewer of the sheet's « Médias » (kit/ma-meet-media.js) — with a line on how it works: beside the deck on a wide
// screen (a pane, its separator), full screen over it on a phone (Échap closes it, the focus back on the deck). The
// plant shown is the one chosen: each later heart chooses its own (a phone: no screen over the deck again, « Ses
// photos » shows it); passes change nothing. The match undone (↺): closed, and brought by the next one; « Rejouer »:
// brought again, the pane's width forgotten. The « Photos en ligne » module off, or a plant without photos: nothing.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const AIL = 'Allium ursinum', PISSENLIT = 'Taraxacum officinale';

/** The game's context kept on the device (its photos: `media`). @param {import('@playwright/test').Page} page */
const kept = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.app.rencontres.state') || 'null')?.ctx ?? null);

/** From Rencontres' start to its cards (a returning visitor: the list, not the guided way). @param {import('@playwright/test').Page} page */
async function toCards(page) {
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/cards');
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(AIL)));
}

/** A plant's name as the app says it (kit/cards.js#nameOf). @param {import('@playwright/test').Page} page @param {string} name */
const nameOf = (page, name) => page.evaluate(async id => (await import('/app/miniapp/kit/cards.js')).nameOf(await (await import('/app/core/db.js')).get('plants', id)), plantId(name));

/** The photos, as they show: the pane beside the deck, or the full-screen dialog (a phone). @param {import('@playwright/test').Page} page @param {boolean} phone */
const photos = (page, phone) => page.locator(`ma-around-list ma-meet-media[mode="${phone ? 'dialog' : 'pane'}"]`);

/** A heart on the card on top, which must be `name`. @param {import('@playwright/test').Page} page @param {string} name */
async function like(page, name) {
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(name)));
  await page.locator('ma-deck .round.like').click();
  await expect.poll(async () => (await kept(page))?.matches ?? []).toContain(plantId(name));
}

/** The photos brought for `name`: its heading, its viewer on that plant, the line on how it works. @param {import('@playwright/test').Page} page @param {boolean} phone @param {string} name */
async function introduced(page, phone, name) {
  const m = photos(page, phone);
  await expect(m).toHaveCount(1);
  await expect(m.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(name)));
  await expect(m.getByRole('heading', { level: 2 })).toHaveText(`Photos · ${await nameOf(page, name)}`);
  await expect(m.locator('.coach')).toContainText('Voici ses photos.');
  await expect(m.locator('.coach')).toContainText(phone ? 'Touchez deux fois' : 'Double-cliquez');
  // Its photos, with their credit (the viewer of the sheet's « Médias »).
  await expect(m.locator('gf-media-viewer .caption gf-attribution')).toBeVisible();
  await expect(page.locator('ma-around-list [role="status"]')).toContainText(/Photos de .+ ouvertes/);
  if (phone) await expect(m.locator('dialog')).toHaveJSProperty('open', true);
  else {
    // Its separator (core/panes.js), naming the pane it resizes.
    const split = page.locator('ma-around-list .split[data-pane="media"]');
    await expect(split).toBeVisible();
    await expect(split).toHaveAttribute('aria-label', 'Redimensionner le panneau photos');
    await expect(split).toHaveAttribute('aria-controls', 'meet-media-pane');
  }
  await expect.poll(async () => (await kept(page)).media).toEqual({ by: plantId(name), closed: false });
  // The plant chosen: the one loved, kept with the game and in the address.
  expect((await kept(page)).focus).toBe(plantId(name));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/app/rencontres/cards?p=${plantId(name)}`);
}

/** A phone: the full-screen photos closed (Échap), back to the deck, the focus in it. @param {import('@playwright/test').Page} page */
async function closeFull(page) {
  await page.keyboard.press('Escape');
  await expect(photos(page, true)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return Boolean(a?.closest('ma-deck') || (a?.getRootNode() instanceof ShadowRoot && /** @type {ShadowRoot} */ (a.getRootNode()).host.localName === 'ma-deck'));
  })).toBe(true);
}

test('le premier coup de cœur présente ses photos ; les suivants, un cœur seulement', async ({ app, page, isMobile }) => {
  const phone = Boolean(isMobile);
  await app.open('#/app/rencontres');
  await toCards(page);
  await expect(page.locator('ma-meet-media')).toHaveCount(0);
  await expect(page.locator('ma-deck .round.photos')).toHaveCount(0);
  await like(page, AIL);
  await introduced(page, phone, AIL);
  if (phone) {
    await closeFull(page);
    // Out of sight: « Ses photos » on the deck shows them again (the plant chosen), full screen.
    await expect(page.locator('ma-deck .round.photos')).toBeVisible();
  } else {
    // Beside the deck, the photos of the plant chosen: a pass changes nothing; the line on them is gone.
    await expect(page.locator('ma-deck .round.photos')).toHaveCount(0);
  }
  await like(page, PISSENLIT);
  if (phone) await expect(photos(page, true)).toHaveCount(0);
  else {
    // The next heart chose its plant.
    await expect(photos(page, false).locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(PISSENLIT)));
    await expect(photos(page, false).locator('.coach')).toHaveCount(0);
  }
  await expect.poll(async () => (await kept(page)).media).toEqual({ by: plantId(AIL), closed: false });
  expect((await kept(page)).focus).toBe(plantId(PISSENLIT));

  if (!phone) {
    // × closes the pane (kept so after a reload); « Ses photos » opens it again, its heading focused.
    await photos(page, false).getByRole('button', { name: /Fermer les photos/ }).click();
    await expect(photos(page, false)).toHaveCount(0);
    await expect.poll(async () => (await kept(page)).media).toEqual({ by: plantId(AIL), closed: true });
    await page.locator('ma-deck .round.photos').click();
    await expect(photos(page, false)).toHaveCount(1);
    await expect(photos(page, false).getByRole('heading', { level: 2 })).toBeFocused();
    // Échap closes it too.
    await page.keyboard.press('Escape');
    await expect(photos(page, false)).toHaveCount(0);
  } else {
    await page.locator('ma-deck .round.photos').click();
    await expect(photos(page, true).locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(PISSENLIT)));
    await expect(photos(page, true).locator('.coach')).toHaveCount(0);
    await closeFull(page);
  }
});

test('↺ sur le premier match ferme ses photos ; le match suivant les présente', async ({ app, page, isMobile }) => {
  const phone = Boolean(isMobile);
  await app.open('#/app/rencontres');
  await toCards(page);
  await like(page, AIL);
  await introduced(page, phone, AIL);
  if (phone) await closeFull(page);
  await page.locator('ma-deck .round.undo').click();
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(AIL)));
  await expect(page.locator('ma-meet-media')).toHaveCount(0);
  await expect.poll(async () => (await kept(page)).media).toBe(null);
  // Passed this time; the next one loved brings its photos.
  await page.locator('ma-deck .round.pass').click();
  await like(page, PISSENLIT);
  await introduced(page, phone, PISSENLIT);
});

test('« Rejouer » : le premier match présente de nouveau ses photos, la largeur du volet oubliée', async ({ app, page, isMobile }) => {
  const phone = Boolean(isMobile);
  await app.open('#/app/rencontres');
  await toCards(page);
  await like(page, AIL);
  await introduced(page, phone, AIL);
  if (phone) await closeFull(page);
  else {
    // The pane's width, the user's.
    await page.locator('ma-around-list .split[data-pane="media"]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.media'))).not.toBe(null);
  }
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Rejouer' }).click();
  await box.getByRole('dialog').getByRole('button', { name: 'Rejouer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/start');
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.media'))).toBe(null);
  await toCards(page);
  await like(page, AIL);
  await introduced(page, phone, AIL);
});

test('module « Photos en ligne » désactivé : aucun volet, aucun bouton', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  await page.evaluate(async () => {
    const m = await import('/app/core/modules.js');
    for (const mode of ['epure', 'standard', 'scientific']) m.setModule('photos', /** @type {any} */ (mode), false);
  });
  await toCards(page);
  await like(page, AIL);
  await like(page, PISSENLIT);
  await expect(page.locator('ma-meet-media')).toHaveCount(0);
  await expect(page.locator('ma-deck .round.photos')).toHaveCount(0);
  expect((await kept(page)).media).toBe(null);
});

test('une plante sans photo n’est pas présentée : la suivante aimée qui en a une l’est', async ({ app, page, isMobile }) => {
  const phone = Boolean(isMobile);
  await app.open('#/app/rencontres');
  // The wild garlic without its picture (and every source of images answering 503 here).
  await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    const p = await db.get('plants', id);
    await db.put('plants', { ...p, thumbnail: null });
  }, plantId(AIL));
  await toCards(page);
  await like(page, AIL);
  await like(page, PISSENLIT);
  await introduced(page, phone, PISSENLIT);
});
