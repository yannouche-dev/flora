// The activities around a place — Cueillette prudente and Mosaïque beside Rencontres —, each with its own
// session: its start, its map and distance, its cards (#/app/<id>/<step>); Cueillette prudente's safety warnings exactly
// as before (never pick without a certain identification, the look-alikes, the deadliest first, toxicity) — a deadly
// plant seen once among more than 120 is in its deck, a toxic look-alike is never a match nor a favourite (« à ne pas
// cueillir »), an empty list says one thing; Mosaïque's photo grid; « Recommencer » in one leaving the others as they
// were. Rencontres' services answered here.
import { readFileSync } from 'node:fs';
import { test, expect, plantId, answerAround, fixturePlants } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

/** @param {import('@playwright/test').Page} page */
const hash = page => page.evaluate(() => location.hash);
/** What a mini-app keeps (its state's ctx; none: null). @param {import('@playwright/test').Page} page @param {string} id */
const kept = (page, id) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null')?.ctx ?? null, `geoflora.app.${id}.state`);

/** A mini-app around a place played to its cards: « Autour de moi », « Qui pousse par ici ? ». @param {import('@playwright/test').Page} page @param {string} id */
async function toCards(page, id) {
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/map`);
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/cards`);
}

/** « Recommencer » from the box's ⋯, confirmed. @param {import('@playwright/test').Page} page */
async function replay(page) {
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Recommencer' }).click();
  const dialog = box.getByRole('dialog');
  await expect(dialog).toContainText('Recommencer : tout effacer ?');
  await dialog.getByRole('button', { name: 'Recommencer' }).click();
  await expect(dialog).toBeHidden();
}

test('Cueillette prudente : ses avertissements de sécurité, tels qu’avant ; la plus dangereuse d’abord', async ({ app, page }) => {
  await app.open('#/app/cueillette');
  await expect(page.locator('gf-miniapp .start .caution')).toHaveText('Ne cueillez jamais une plante sans être sûr de vous.');
  await toCards(page, 'cueillette');
  const list = page.locator('ma-around-list');
  await expect(list.locator('.head h1')).toHaveText('Cueillette prudente · Autour de vous');
  // Never without a certain identification, each plant here has a dangerous look-alike, whom to call.
  const banner = list.locator('.banner-warn[role="note"]');
  await expect(banner).toContainText('Ne cueillez jamais une plante sans identification certaine : chacune de ces plantes a un sosie toxique (liste de l’Anses et des Centres antipoison).');
  await expect(banner).toContainText('Centre antipoison : centres-antipoison.net (liste officielle) · 15 ou 112 en cas de détresse vitale.');
  // Only the plants of a dangerous confusion (2 of the 12 around), the deadliest look-alike first.
  await expect(list.locator('.head .where')).toHaveText('2 plantes à moins de 1 km');
  const top = list.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await expect(top.locator('.bio li').first()).toHaveText('⚠️ Ne me confondez pas avec Colchique (mortel). Partie : feuilles.');
  await expect(top.locator('.bio li').nth(1)).toHaveText('⚠️ Ne me confondez pas avec Muguet (très toxique). Partie : feuilles.');
  await expect(top.locator('.bio')).toContainText('🍽️ Partie consommée selon l’Anses : feuilles. J’ai des sosies toxiques (2) : lisez ma fiche avant de passer à table.');
  await page.keyboard.press('ArrowLeft');
  await expect(top).toHaveAttribute('data-id', String(plantId('Conium maculatum')));
  await expect(top.locator('.bio li').first()).toHaveText('☠️ Je suis le sosie très toxique de Persil plat.');
  await expect(top.locator('.bio')).toContainText('☠️ Toxicité : très fortement toxique. On regarde, on ne goûte pas.');
  // « Toutes »: each tile says its verdict (core/danger.js), as its sheet: the word, the colour, its reasons counted.
  await list.getByRole('tab', { name: 'Toutes' }).click();
  const chips = list.locator('.grid .card .sev-chip');
  await expect(chips).toHaveText(['Sosie mortel · 3', 'Très toxique · 3']);
  await expect(chips.first()).toHaveClass(/\bdeadly\b/);
  await expect(chips.nth(1)).toHaveClass(/\bdanger\b/);
});

/**
 * iNaturalist's plants around, the most observed first: `names` (count each), then `more` plants of the reduced flora
 * of no dangerous confusion (none of the genera of data/lookalikes.json, by name or synonym), then `last` seen once.
 * @param {import('@playwright/test').Page} page @param {{ names?: string[], more?: number, last?: string[] }} o
 */
async function answerSpecies(page, { names = [], more = 0, last = [] }) {
  const pairs = JSON.parse(readFileSync(new URL('../../data/lookalikes.json', import.meta.url), 'utf8')).pairs;
  const genera = new Set(pairs.flatMap((/** @type {any} */ p) => [...p.toxic, ...p.edible]).map((/** @type {any} */ t) => t.taxon.split(/\s+/)[0].toLowerCase()));
  const plain = fixturePlants.filter((/** @type {any} */ p) => ![p.scientificName, ...(p.synonyms || [])].some(n => genera.has(String(n).split(/\s+/)[0].toLowerCase())))
    .slice(0, more).map((/** @type {any} */ p) => p.scientificName);
  const all = [...names.map(n => [n, 900]), ...plain.map((n, i) => [n, 700 - i]), ...last.map(n => [n, 1])];
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: all.map(([name, count], i) => ({ count, taxon: { id: 5000 + i, name, preferred_common_name: null, default_photo: null } })) }) }));
}

test('Cueillette prudente : la colchique vue une fois, derrière plus de 120 plantes plus observées, dans le paquet ; un sosie toxique « à ne pas cueillir » — jamais un match ni un favori, ↺ le reprend', async ({ app, page }) => {
  await answerSpecies(page, { names: ['Conium maculatum'], more: 125, last: ['Colchicum autumnale'] });
  const colchique = plantId('Colchicum autumnale'), cigue = plantId('Conium maculatum');
  await app.open('#/app/cueillette');
  await toCards(page, 'cueillette');
  const list = page.locator('ma-around-list');
  // Of the 127 plants around, the two of a dangerous confusion: the deadly one first, though seen once.
  await expect(list.locator('.head .where')).toHaveText(/^2 plantes à moins de 1 km/);
  const deck = list.locator('ma-deck');
  const top = deck.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(colchique));
  await expect(top.locator('.bio li').first()).toHaveText('☠️ Je suis le sosie mortel de Ail des ours, Poireau sauvage.');
  // Its right: recognised, to avoid — never « J’aime », never a heart.
  await expect(top.locator('.avoid-tag')).toHaveText('À ne pas cueillir');
  await expect(top.locator('.stamp.like')).toHaveText('À ÉVITER');
  const right = deck.getByRole('button', { name: 'Je reconnais Colchique d\'automne : à ne pas cueillir' });
  await expect(right).toHaveAttribute('title', 'Je la reconnais : à ne pas cueillir (→)');
  await expect(deck.getByRole('button', { name: /match/ })).toHaveCount(0);
  await expect(deck.locator('.deck')).toHaveAttribute('aria-label', /Flèche droite : je la reconnais, à ne pas cueillir/);
  await right.click();
  await expect(top).toHaveAttribute('data-id', String(cigue));
  await expect(list.getByRole('status')).toHaveText('Reconnue, à ne pas cueillir : Colchique d\'automne. Carte suivante : Ciguë maculée.');
  await expect.poll(() => kept(page, 'cueillette')).toMatchObject({ matches: [], passed: [], avoided: [colchique] });
  // ↺: back on top, no longer recognised.
  await deck.getByRole('button', { name: 'Revenir à la carte précédente' }).click();
  await expect(top).toHaveAttribute('data-id', String(colchique));
  await expect.poll(async () => (await kept(page, 'cueillette'))?.avoided).toEqual([]);
  // → on the deck: the same, for both.
  await deck.locator('.deck').focus();
  await page.keyboard.press('ArrowRight');
  await expect(top).toHaveAttribute('data-id', String(cigue));
  await page.keyboard.press('ArrowRight');
  // Counted apart, never with the matches; no favourite.
  const end = deck.locator('.deck-end');
  await expect(end.locator('.avoided')).toHaveText('2 plantes reconnues à ne pas cueillir.');
  await expect(end).toContainText('Aucun coup de cœur ?');
  await expect(list.getByRole('tab', { name: 'Matchs' })).toHaveText('Matchs');
  await expect.poll(() => kept(page, 'cueillette')).toMatchObject({ matches: [], avoided: [colchique, cigue] });
  expect(await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.id === 'favorites')?.properties.plants.length ?? 0)).toBe(0);
  // « Revoir les plantes passées »: they come back.
  await end.getByRole('button', { name: 'Revoir les plantes passées' }).click();
  await expect(top).toHaveAttribute('data-id', String(colchique));
  await expect.poll(async () => (await kept(page, 'cueillette'))?.avoided).toEqual([]);
});

test('Cueillette prudente : aucune plante à sosie toxique observée — un seul message (pas observée ne veut pas dire absente), et plus loin', async ({ app, page }) => {
  await answerSpecies(page, { more: 12 });
  await app.open('#/app/cueillette');
  await toCards(page, 'cueillette');
  const list = page.locator('ma-around-list');
  const end = list.locator('.deck-end');
  await expect(end).toHaveCount(1);
  await expect(end.locator('p')).toHaveText(['Aucune observation confirmée ici pour ces plantes : cela ne veut pas dire qu’elles sont absentes.']);
  await expect(end.getByRole('button')).toHaveText(['Chercher jusqu’à 2 km']);
  await expect(list.locator('ma-deck')).toHaveCount(0);
  await expect(list.getByText('Aucune plante observée ici')).toHaveCount(0);
  await expect(list.getByText('toutes les plantes du coin')).toHaveCount(0);
});

test('Mosaïque : la grille des photos, « En fleur maintenant », une image touchée ouvre la plante (Retour la ferme)', async ({ app, page }) => {
  await app.open('#/app/mosaique');
  await expect(page.getByRole('heading', { name: 'La mosaïque du coin' })).toBeVisible();
  await toCards(page, 'mosaique');
  const list = page.locator('ma-around-list');
  await expect(list.locator('.grid.mosaic .card')).toHaveCount(12);
  await expect(list.getByRole('tab', { name: 'Toutes' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('checkbox', { name: /En fleur maintenant/ }).check();
  const blooming = await list.locator('.grid.mosaic .card').count();
  expect(blooming).toBeLessThan(12);
  await list.getByRole('checkbox', { name: /En fleur maintenant/ }).uncheck();
  await list.locator('.grid.mosaic .card').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/app\/mosaique\/cards\?p=\d+$/);
  await expect(page.locator('ma-plant-sheet .pager')).toContainText('1 / 12');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/app/mosaique/cards');
  await expect(page.locator('ma-plant-sheet')).toHaveCount(0);
});

test('Mosaïque, Matchs : « Retirer » reprend le favori que le match a ajouté, et dit quand un favori reste', async ({ app, page }) => {
  const ail = plantId('Allium ursinum'), pissenlit = plantId('Taraxacum officinale');
  /** The favourites, with the activity that made each (none: null). */
  const favourites = () => page.evaluate(async () => {
    const fav = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ c) => c.id === 'favorites');
    return Object.fromEntries((fav?.properties.plants ?? []).map((/** @type {any} */ e) => [e.plantId, e.origin?.app ?? null]));
  });
  await app.open('#/');
  // The dandelion, a favourite of before the game: the user's.
  await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    await (await import('/app/core/collections.js')).toggleFavorite(await db.get('plants', id));
  }, pissenlit);
  await app.go('#/app/mosaique');
  await toCards(page, 'mosaique');
  const list = page.locator('ma-around-list');
  await list.getByRole('tab', { name: 'Rencontres' }).click();
  const top = page.locator('ma-deck .swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(ail));
  await page.locator('ma-deck .round.like').click();
  await expect(top).toHaveAttribute('data-id', String(pissenlit));
  await page.locator('ma-deck .round.like').click();
  // The second match decided: its card flies off first (260 ms, across the tabs on a phone), and the dandelion, a
  // favourite already, changes nothing in the favourites — only the tab's count says it.
  const matchs = list.getByRole('tab', { name: /^Matchs/ });
  await expect(matchs).toHaveText('Matchs · 2');
  await expect.poll(favourites).toEqual({ [pissenlit]: null, [ail]: 'mosaique' });
  await matchs.click();
  await expect(matchs).toHaveAttribute('aria-selected', 'true');
  // The dandelion: out of the matches, still a favourite — said.
  await list.getByRole('button', { name: 'Retirer Pissenlit officinal des matchs' }).click();
  await expect(page.locator('.gf-brief-toast')).toHaveText('Retiré des matchs. Il reste dans vos favoris.');
  await expect(list.getByRole('button', { name: 'Retirer Pissenlit officinal des matchs' })).toHaveCount(0);
  expect(await favourites()).toEqual({ [pissenlit]: null, [ail]: 'mosaique' });
  // The wild garlic: the favourite its match added goes with it.
  await list.getByRole('button', { name: 'Retirer Ail des ours des matchs' }).click();
  await expect.poll(favourites).toEqual({ [pissenlit]: null });
  await expect.poll(async () => (await kept(page, 'mosaique'))?.matches).toEqual([]);
});

test('chacune la sienne : « Recommencer » la Cueillette ne touche ni Rencontres ni la Mosaïque ; vide après rechargement', async ({ app, page }) => {
  await app.open('#/discover');
  for (const id of ['rencontres', 'mosaique', 'cueillette']) {
    await app.go(`#/app/${id}`);
    await toCardsAny(page, id);
  }
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await kept(page, 'cueillette'))?.matches).toEqual([plantId('Allium ursinum')]);
  const others = { rencontres: await kept(page, 'rencontres'), mosaique: await kept(page, 'mosaique') };
  expect(others.rencontres.point).toEqual([2.35, 48.85]);
  await replay(page);
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(page.getByRole('heading', { name: 'Cueillette prudente' })).toBeVisible();
  // No « Continuer » here any more; the others as they were.
  await expect(page.getByRole('group', { name: 'Continuer' })).toHaveCount(0);
  expect(await kept(page, 'rencontres')).toEqual(others.rencontres);
  expect(await kept(page, 'mosaique')).toEqual(others.mosaique);
  await page.reload();
  await app.ready();
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(page.getByRole('button', { name: 'Autour de moi' })).toBeVisible();
  expect(await kept(page, 'cueillette')).toBe(null);
  // Rencontres still offers to continue at its place.
  await app.go('#/app/rencontres');
  await expect(page.getByRole('group', { name: 'Continuer' })).toContainText('Au dernier lieu choisi');
});

/** To the cards of any of the three (Rencontres too: a returning visitor, no guided way). @param {import('@playwright/test').Page} page @param {string} id */
async function toCardsAny(page, id) {
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/start`);
  await toCards(page, id);
  await expect(page.locator('ma-around-list .head')).toBeVisible();
}
