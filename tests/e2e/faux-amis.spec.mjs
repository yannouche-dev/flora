// Faux amis (#/app/faux-amis): six pairs of data/lookalikes.json — four criteria to attribute (« À qui est cet indice ? »),
// two pairs the sources give none for (« Je ne cueille pas ») —; each answer says whose the criterion was, the
// look-alike and how dangerous, the part, the sources; the recap: the score, the six pairs, each plant's sheet, the
// emergency numbers, « Nouvelle partie ». A game under way comes back after a reload; one the file no longer gives
// (a criterion corrected since) is said, and dealt again; the file unreadable: said, no game. Never « comestible » in
// its own words (the sources' titles are quoted as they are).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const KEY = 'geoflora.app.faux-amis.state';
/** @param {import('@playwright/test').Page} page */
const hash = page => page.evaluate(() => location.hash);
/** The game kept on the device (written 300 ms after a change). @param {import('@playwright/test').Page} page @returns {Promise<any>} */
const kept = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null')?.ctx?.game ?? null, KEY);
/** @param {import('@playwright/test').Page} page */
const game = page => page.locator('ma-faux-amis');
/** The game's own words: all it shows but its sources' titles, quoted as they are. @param {import('@playwright/test').Page} page */
const words = page => game(page).evaluate(el => {
  const walk = document.createTreeWalker(/** @type {ShadowRoot} */ (el.shadowRoot), NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest('.src')) out += n.textContent;
  return out;
});

/** « Jouer » from the start screen: the six cards dealt and kept. @param {import('@playwright/test').Page} page */
async function deal(page) {
  await page.locator('gf-miniapp .start .go').click();
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/play');
  await expect.poll(async () => (await kept(page))?.cards?.length).toBe(6);
  return /** @type {any[]} */ ((await kept(page)).cards);
}

/** The card shown answered: its criterion's plant touched (or the other one, `wrong`), else « Je ne cueille pas ». @param {import('@playwright/test').Page} page @param {any} k @param {boolean} [wrong] */
async function answer(page, k, wrong = false) {
  if (!k.clue) return game(page).getByRole('button', { name: 'Je ne cueille pas' }).click();
  const target = wrong ? k.plants.find((/** @type {string} */ t) => t !== k.clue.taxon) : k.clue.taxon;
  return game(page).locator('button.pick').nth(k.plants.indexOf(target)).click();
}

test('une partie : quatre indices à attribuer, deux paires sans critère ; le bilan, ses fiches, les numéros d’urgence', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  await expect(page.getByRole('heading', { level: 1, name: 'Faux amis' })).toBeVisible();
  await expect(page.locator('gf-miniapp .start .caution')).toContainText('ne cueillez jamais une plante sur la foi d’un indice ou d’une photo');
  const cards = await deal(page);
  expect(cards.filter(k => k.clue).length).toBe(4);
  expect(new Set(cards.map(k => k.pair)).size).toBe(6);
  const missed = cards.findIndex(k => k.clue);
  for (const [i, k] of cards.entries()) {
    await expect(game(page).locator('.count')).toHaveText(`Carte ${i + 1} sur 6`);
    if (k.clue) {
      await expect(game(page).getByRole('heading', { level: 2, name: 'À qui est cet indice ?' })).toBeVisible();
      await expect(game(page).locator('.clue')).toContainText(k.clue.text.slice(0, 12));
      await expect(game(page).locator('button.pick')).toHaveCount(2);
      await expect(game(page).getByRole('button', { name: 'Je ne cueille pas' })).toHaveCount(0);
    } else {
      await expect(game(page).getByRole('heading', { level: 2, name: 'Aucun indice sûr' })).toBeVisible();
      await expect(game(page).locator('button.pick')).toHaveCount(0);
    }
    // Two plants side by side, each named (never told apart by its photo alone).
    const [a, b] = await Promise.all([0, 1].map(n => game(page).locator('.pair figure').nth(n).boundingBox()));
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1))).toBeLessThan(2);
    await expect(game(page).locator('.pair .name')).toHaveCount(2);
    // The first card with a criterion missed, the others right.
    await answer(page, k, i === missed);
    await expect(game(page).locator('.verdict')).toBeFocused();
    await expect(game(page).locator('.verdict')).toContainText(!k.clue ? 'Bonne décision' : i === missed ? 'Raté' : 'Bien vu');
    await expect(game(page).locator('.pair .tag', { hasText: 'Faux ami' })).toHaveCount(1);
    await expect(game(page).locator('.pair .tag', { hasText: 'Plante cherchée' })).toHaveCount(1);
    await expect(game(page).locator('.facts')).toContainText('Partie confondue');
    await expect(game(page).locator('.src li').first()).toContainText(/Anses/);
    expect(await words(page)).not.toMatch(/comestible/i);
    await game(page).getByRole('button', { name: i < 5 ? 'Carte suivante' : 'Le bilan' }).click();
  }

  // The recap: the score, the six pairs, whom to call.
  await expect(game(page).getByRole('heading', { level: 2, name: 'Partie terminée' })).toBeFocused();
  await expect(game(page).locator('.score')).toHaveText('5 bonnes réponses sur 6');
  await expect(game(page).locator('.rows > li')).toHaveCount(6);
  await expect(game(page).locator('.rows > li.wrong')).toHaveCount(1);
  await expect(game(page).locator('.sos a[href="tel:15"]')).toBeVisible();
  await expect(game(page).locator('.sos a[href="tel:112"]')).toBeVisible();
  await expect(game(page).locator('.sos a[href^="https://centres-antipoison.net"]')).toBeVisible();
  expect(await words(page)).not.toMatch(/comestible/i);
  // No way across the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // A plant's sheet, from the recap: in the address, closed by Échap.
  await game(page).locator('button.plant-link').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/app\/faux-amis\/play\?p=\d+$/);
  await expect(page.locator('ma-plant-sheet .sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('ma-plant-sheet .sheet')).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/play');

  // « Nouvelle partie »: six other cards, the first one's question in focus.
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
  await expect(game(page).getByRole('heading', { level: 2 })).toBeFocused();
  await expect.poll(async () => (await kept(page)).cards.every((/** @type {any} */ k) => k.answer == null)).toBe(true);
});

test('une partie en cours revient après un rechargement ; changée depuis dans le fichier, elle est à recommencer', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  const cards = await deal(page);
  for (const k of cards.slice(0, 2)) {
    await answer(page, k);
    await game(page).getByRole('button', { name: 'Carte suivante' }).click();
  }
  await expect.poll(async () => (await kept(page)).cards.filter((/** @type {any} */ k) => k.answer).length).toBe(2);
  await page.reload();
  await app.ready();
  await expect(game(page).locator('.count')).toHaveText('Carte 3 sur 6');
  // Its start screen (Back) offers to take it up again.
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/start');
  await expect(page.locator('gf-miniapp .start .go')).toHaveText('Nouvelle partie');
  await page.locator('gf-miniapp .start .choices button').filter({ hasText: 'La partie en cours' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 3 sur 6');
  // Opened with no step named: the game under way.
  await app.go('#/app/faux-amis');
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/play');
  await expect(game(page).locator('.count')).toHaveText('Carte 3 sur 6');

  // A criterion corrected in the file since it was dealt: said, and dealt again.
  await page.addInitScript(k => {
    const s = JSON.parse(localStorage.getItem(k) || 'null');
    const card = s?.ctx?.game?.cards?.find((/** @type {any} */ c) => c.clue);
    if (card && !card.clue.text.endsWith(' (avant)')) { card.clue.text += ' (avant)'; localStorage.setItem(k, JSON.stringify(s)); }
  }, KEY);
  await page.reload();
  await app.ready();
  await expect(game(page).getByRole('heading', { level: 2, name: 'Une partie à recommencer' })).toBeVisible();
  await expect(game(page)).not.toContainText('(avant)');
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
});

/**
 * What axe-core finds in the game (WCAG 2.x A and AA, best practices — as tools/axe.mjs), its elements only (the box
 * around it is checked there). @param {import('@playwright/test').Page} page
 */
async function axe(page) {
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => {
    const r = await /** @type {any} */ (window).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.flatMap((/** @type {any} */ v) => v.nodes.map((/** @type {any} */ n) => `${v.id}: ${n.target.flat().join(' > ')}`));
  });
  return found.filter(v => v.includes('ma-faux-amis'));
}

test('accessibilité : la carte, sa réponse et le bilan, sans violation (axe)', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  const cards = await deal(page);
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
  expect(await axe(page)).toEqual([]);
  for (const k of cards) {
    await answer(page, k);
    await expect(game(page).locator('.verdict')).toBeVisible();
    if (k === cards[0]) expect(await axe(page)).toEqual([]);
    await game(page).locator('button.next').click();
  }
  await expect(game(page).getByRole('heading', { level: 2, name: 'Partie terminée' })).toBeVisible();
  await expect(game(page).locator('button.plant-link')).toHaveCount(12);
  expect(await axe(page)).toEqual([]);
});

test('la liste des confusions illisible : dit sur l’écran de départ, aucune partie', async ({ app, page }) => {
  await page.route(/\/data\/lookalikes\.json(\?|$)/, route => route.fulfill({ status: 503, body: '' }));
  await app.open('#/app/faux-amis');
  await page.locator('gf-miniapp .start .go').click();
  await expect(page.locator('gf-miniapp .start .alert')).toContainText('Liste des confusions indisponible pour le moment');
  expect(await hash(page)).toBe('#/app/faux-amis/start');
  expect(await kept(page)).toBeNull();
});

test('une partie en cours, la liste illisible : dit à la place de ses cartes ; « Nouvelle partie » la redemande', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  await deal(page);
  let unreadable = true;
  await page.route(/\/data\/lookalikes\.json(\?|$)/, route => unreadable ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await page.reload();
  await app.ready();
  await expect(game(page).locator('.state.alert')).toContainText('Liste des confusions indisponible pour le moment');
  await expect(game(page).locator('.card-view')).toHaveCount(0);
  // Asked again, still unreadable; then readable: a new game.
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.state.alert')).toBeFocused();
  unreadable = false;
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
});
