// Faux amis (#/app/faux-amis): six pairs of data/lookalikes.json — four criteria to attribute (« À qui est cet indice ? »),
// two pairs the sources give no criterion at all for (« Je ne cueille pas ») —; each answer says whose the criterion was,
// the look-alike and how dangerous (the TPPT base named for « très toxique »), the pair's other plants, the part, the
// sources; the recap: the score, the six pairs, each plant's sheet (beside it on a wide screen, Back closing it), the
// emergency numbers, « Nouvelle partie ». A game under way comes back after a reload, and its start screen offers it
// first; one the file no longer gives (a criterion corrected since) is said, and dealt again; the file unreadable: said,
// no game — or, a game kept, « Réessayer » reads it again and keeps it. A photo that does not load: neither shown nor
// credited. Never « comestible » in its own words (the sources' titles are quoted as they are). One h1 a view (axe).
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { AXE, TAGS } from '../../tools/axe-rules.mjs';

test.use({ reducedMotion: 'reduce' });

const KEY = 'geoflora.app.faux-amis.state';
const DATA = JSON.parse(readFileSync(new URL('../../data/lookalikes.json', import.meta.url), 'utf8'));
/** A pair of the file by the key a game names it by (kit/faux-amis.js pairKey). @param {string} key @returns {any} */
const pairBy = key => DATA.pairs.find((/** @type {any} */ p) => `${p.toxic.map((/** @type {any} */ t) => t.taxon).join('+')}>${p.edible.map((/** @type {any} */ t) => t.taxon).join('+')}` === key);

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

/** « Commencer » from the start screen: the six cards dealt and kept. @param {import('@playwright/test').Page} page */
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

/** A whole game played to its recap, the first card with a criterion missed. @param {import('@playwright/test').Page} page @param {any[]} cards */
async function playAll(page, cards) {
  const missed = cards.findIndex(k => k.clue);
  for (const [i, k] of cards.entries()) {
    await answer(page, k, i === missed);
    await game(page).locator('button.next').click();
  }
  await expect(game(page).getByRole('heading', { level: 1, name: 'Partie terminée' })).toBeFocused();
}

test('une partie : quatre indices à attribuer, deux paires sans critère ; le bilan, ses fiches, les numéros d’urgence', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  await expect(page.getByRole('heading', { level: 1, name: 'Faux amis' })).toBeVisible();
  await expect(page.locator('gf-miniapp .start .caution')).toContainText('ne cueillez jamais une plante sur la foi d’un indice ou d’une photo');
  await expect(page.locator('gf-miniapp .start .note')).toContainText('base TPPT (Agroscope)');
  const cards = await deal(page);
  expect(cards.filter(k => k.clue).length).toBe(4);
  expect(new Set(cards.map(k => k.pair)).size).toBe(6);
  const missed = cards.findIndex(k => k.clue);
  for (const [i, k] of cards.entries()) {
    const pair = pairBy(k.pair);
    await expect(game(page).locator('.count')).toHaveText(`Carte ${i + 1} sur 6`);
    if (k.clue) {
      await expect(game(page).getByRole('heading', { level: 1, name: 'À qui est cet indice ?' })).toBeVisible();
      await expect(game(page).locator('.clue')).toContainText(k.clue.text.slice(0, 12));
      await expect(game(page).locator('button.pick')).toHaveCount(2);
      await expect(game(page).getByRole('button', { name: 'Je ne cueille pas' })).toHaveCount(0);
    } else {
      // « Aucun critère »: the pair has none at all (as its plant sheet says).
      expect(pair.tell).toEqual([]);
      await expect(game(page).getByRole('heading', { level: 1, name: 'Aucun indice sûr' })).toBeVisible();
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
    // « Très toxique »: from the TPPT base, said; the pair's other plants named.
    if (pair.severityFrom === 'tppt') await expect(game(page).locator('.facts')).toContainText('base TPPT d’Agroscope');
    if (pair.toxic.length + pair.edible.length > 2) await expect(game(page).locator('.facts')).toContainText('Dans la même confusion');
    await expect(game(page).locator('.src-head')).toHaveText(pair.sources.length > 1 ? 'Sources' : 'Source');
    await expect(game(page).locator('.src li').first()).toContainText(/Anses/);
    expect(await words(page)).not.toMatch(/comestible/i);
    await game(page).getByRole('button', { name: i < 5 ? 'Carte suivante' : 'Le bilan' }).click();
  }

  // The recap: the score, the six pairs, from whom, whom to call.
  await expect(game(page).getByRole('heading', { level: 1, name: 'Partie terminée' })).toBeFocused();
  await expect(game(page).locator('.score')).toHaveText('5 bonnes réponses sur 6');
  await expect(game(page).locator('.rows > li')).toHaveCount(6);
  await expect(game(page).locator('.rows > li.wrong')).toHaveCount(1);
  await expect(game(page).locator('.src-note')).toContainText('Anses et Centres antipoison');
  await expect(game(page).locator('.sos a[href="tel:15"]')).toBeVisible();
  await expect(game(page).locator('.sos a[href="tel:112"]')).toBeVisible();
  await expect(game(page).locator('.sos a[href^="https://centres-antipoison.net"]')).toBeVisible();
  expect(await words(page)).not.toMatch(/comestible/i);
  // It scrolls itself, its background all the way down; no way across the page sideways.
  expect(await game(page).evaluate(el => {
    const cell = /** @type {HTMLElement} */ (el.parentElement);
    return getComputedStyle(el).overflowY === 'auto' && Math.abs(el.clientHeight - cell.clientHeight) <= 1 && cell.scrollHeight <= cell.clientHeight + 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // A plant's sheet, from the recap: in the address, closed by Échap.
  await game(page).locator('button.plant-link').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/app\/faux-amis\/play\?p=\d+$/);
  await expect(page.locator('ma-plant-sheet .sheet')).toBeVisible();
  await expect(page.locator('ma-plant-sheet .sheet-head button')).toHaveAttribute('aria-label', 'Fermer la fiche');
  await page.keyboard.press('Escape');
  await expect(page.locator('ma-plant-sheet .sheet')).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/play');

  // « Nouvelle partie »: six other cards, the first one's question in focus.
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
  await expect(game(page).getByRole('heading', { level: 1 })).toBeFocused();
  await expect.poll(async () => (await kept(page)).cards.every((/** @type {any} */ k) => k.answer == null)).toBe(true);
});

test('sur grand écran, la fiche s’ouvre à côté du bilan : les autres plantes restent à portée ; « Nouvelle partie » la ferme comme Retour', async ({ app, page }) => {
  test.skip(app.phone, 'sur téléphone, la fiche couvre l’écran');
  await app.open('#/app/faux-amis');
  await playAll(page, await deal(page));
  await game(page).locator('button.plant-link').first().click();
  await expect(page.locator('ma-plant-sheet .sheet')).toBeVisible();
  const first = await hash(page);
  // The last row's plant sought, at the far right of the recap: not under the sheet.
  await game(page).locator('.rows > li').last().locator('button.plant-link').last().click();
  await expect.poll(() => hash(page)).not.toBe(first);
  await expect.poll(() => hash(page)).toMatch(/\?p=\d+$/);
  // « Nouvelle partie », a sheet open: closed as Back would, the new game; one Back, the start screen.
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
  await expect(page.locator('ma-plant-sheet .sheet')).toHaveCount(0);
  expect(await hash(page)).toBe('#/app/faux-amis/play');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/start');
});

test('une partie en cours revient après un rechargement, et d’abord sur l’écran de départ ; changée depuis dans le fichier, elle est à recommencer', async ({ app, page }) => {
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
  // Its start screen (Back): the game first, in big; a new one in small, saying it replaces it.
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/app/faux-amis/start');
  await expect(page.locator('gf-miniapp .start .go')).toHaveText('Continuer la partie');
  await expect(page.locator('gf-miniapp .start .note')).toHaveText('Carte 3 sur 6.');
  await expect(page.locator('gf-miniapp .start .alt')).toHaveText('Nouvelle partie : celle en cours sera effacée');
  await page.locator('gf-miniapp .start .go').click();
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
  await expect(game(page).getByRole('heading', { level: 1, name: 'Une partie à recommencer' })).toBeVisible();
  await expect(game(page)).not.toContainText('(avant)');
  await game(page).getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 1 sur 6');
});

test('une photo qui ne vient pas : ni montrée, ni créditée', async ({ app, page }) => {
  await page.route(url => !url.href.startsWith(new URL(page.url() || 'http://127.0.0.1/').origin) && /\.(jpe?g|png|webp|svg)(\?|$)/i.test(url.pathname),
    route => route.fulfill({ status: 404, body: '' }));
  await page.route(/^https:\/\//, route => route.request().resourceType() === 'image' ? route.fulfill({ status: 404, body: '' }) : route.fallback());
  await app.open('#/app/faux-amis');
  await deal(page);
  await expect(game(page).locator('.pair .name')).toHaveCount(2);
  await expect(game(page).locator('.pair .photo img')).toHaveCount(0);
  await expect(game(page).locator('.pair .credit')).toHaveCount(0);
  await expect(game(page).locator('.pair .photo .ph')).toHaveCount(2);
});

/**
 * What axe-core finds on the page (WCAG 2.x A and AA, best practices — tools/axe-rules.mjs, as tools/axe.mjs), the game
 * and the box around it, page-level rules too. @param {import('@playwright/test').Page} page
 */
async function axe(page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE);
  return page.evaluate(async tags => {
    const r = await /** @type {any} */ (window).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.flatMap((/** @type {any} */ v) => v.nodes.map((/** @type {any} */ n) => `${v.id}: ${n.target.flat().join(' > ')}`));
  }, TAGS);
}

test('accessibilité : la carte, sa réponse et le bilan, sans violation (axe), un h1 chacun', async ({ app, page }) => {
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
  await expect(game(page).getByRole('heading', { level: 1, name: 'Partie terminée' })).toBeVisible();
  await expect(game(page).locator('button.plant-link')).toHaveCount(12);
  expect(await axe(page)).toEqual([]);
});

test('la liste des confusions illisible : dit sur l’écran de départ, aucune partie', async ({ app, page }) => {
  await page.route(/\/data\/lookalikes\.json(\?|$)/, route => route.fulfill({ status: 503, body: '' }));
  await app.open('#/app/faux-amis');
  await page.locator('gf-miniapp .start .go').click();
  await expect(page.locator('gf-miniapp .start .alert')).toContainText('Liste des confusions indisponible pour le moment');
  await expect(page.locator('gf-miniapp .start .go')).toHaveText('Commencer');
  expect(await hash(page)).toBe('#/app/faux-amis/start');
  // Left (its state written at once): nothing kept.
  await page.locator('gf-miniapp .quit').click();
  await expect(page.locator('gf-miniapp')).toHaveCount(0);
  expect(await kept(page)).toBeNull();
});

test('une partie en cours, la liste illisible : dit à la place de ses cartes ; « Réessayer » la relit et garde la partie', async ({ app, page }) => {
  await app.open('#/app/faux-amis');
  const cards = await deal(page);
  for (const k of cards.slice(0, 2)) {
    await answer(page, k);
    await game(page).getByRole('button', { name: 'Carte suivante' }).click();
  }
  await expect.poll(async () => (await kept(page)).cards.filter((/** @type {any} */ k) => k.answer).length).toBe(2);
  let unreadable = true;
  await page.route(/\/data\/lookalikes\.json(\?|$)/, route => unreadable ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await page.reload();
  await app.ready();
  await expect(game(page).locator('.state.alert')).toContainText('Liste des confusions indisponible pour le moment');
  await expect(game(page).locator('.card-view .pair')).toHaveCount(0);
  // Read again, still unreadable; then readable: the same game, where it was.
  await game(page).getByRole('button', { name: 'Réessayer' }).click();
  await expect(game(page).getByRole('heading', { level: 1, name: 'Liste des confusions indisponible' })).toBeFocused();
  unreadable = false;
  await game(page).getByRole('button', { name: 'Réessayer' }).click();
  await expect(game(page).locator('.count')).toHaveText('Carte 3 sur 6');
  expect((await kept(page)).cards.filter((/** @type {any} */ k) => k.answer).length).toBe(2);
});
