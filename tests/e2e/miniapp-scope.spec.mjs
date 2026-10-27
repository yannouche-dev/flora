// A mini-app changes nothing else in the app behind the user's back (« Activités sans effet global »): the end of
// Rencontres' guided way offers the way chosen for the whole app by buttons that do only what they say (nothing
// changes without one), its panes are the game's own (never the layout of the mode, Flore's; each step docks its own
// blocks there once — a block moved stays where it was put), its ⋯ shows or hides the steps of that mini-app alone
// (and says so on screen), the plants seen count in every mini-app, its guided way is decided as its game begins (a
// game of before as it resumes, its panes taken back from the mode's layout) and ends with the first steps, and the
// harvest mode never chosen follows the harvests that arrive (the value a version before wrote by itself no choice).
// Rencontres' services answered here.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
/** A key of localStorage, as stored. @param {Page} page @param {string} key */
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
/** What a mini-app keeps in its context (geoflora.app.<id>.state). @param {Page} page @param {string} id */
const kept = (page, id) => page.evaluate(i => JSON.parse(localStorage.getItem(`geoflora.app.${i}.state`) || 'null'), id);
/** The first steps of the app (core/discover.js). @param {Page} page */
const discover = page => page.evaluate(async () => (await import('/app/core/discover.js')).discoverState());
/** The panes of Rencontres' guided way, as kept with its game: each pane's blocks, and whether it is folded. @param {Page} page */
const panes = page => page.evaluate(() => {
  const tree = JSON.parse(localStorage.getItem('geoflora.app.rencontres.state') || 'null')?.ctx?.panes;
  /** @type {{ tabs: string[], folded: boolean }[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => { if (n?.t === 'stack') out.push({ tabs: n.tabs, folded: Boolean(n.folded) }); else if (n?.t === 'split') n.kids.forEach(walk); };
  walk(tree);
  return out;
});
/** The harvest mode as the user set it (core/store.js). */
const CHOICE = 'geoflora.harvestModeChoice';
/** What the app shows everywhere: the mode, the harvest mode (on screen and stored), the plant sheet's layout. @param {import('./app.mjs').App} app */
const whole = async app => ({ mode: await app.state('mode'), harvest: await app.state('harvestMode'), harvestKept: await stored(app.page, CHOICE),
  layout: await stored(app.page, 'geoflora.sheetLayout') });

/**
 * Rencontres' guided way, from its start to the fork's way: a heart on the card on top (Allium ursinum), its photos,
 * its encyclopedia, the way. @param {Page} page @param {'harvest' | 'science'} way
 */
async function toTheFork(page, way) {
  const g = page.locator('ma-guided');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await g.locator('.g-steps [data-step="go"]').click();
  await expect(g.locator('.swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowRight');
  await expect(g.locator('.g-steps li.on .l')).toHaveText('Photos');
  await g.locator('.g-steps [data-step="wiki"]').click();
  await expect(g.locator('.g-steps li.on .l')).toHaveText('Encyclopédie');
  await g.locator(`.g-steps [data-step="${way}"]`).click();
  await expect(g.locator('.g-steps li.on .l')).toHaveText(way === 'science' ? 'Science' : 'Cueillette');
  return g;
}

/** … and on to its last step (« Voisines »), the plants around. @param {Page} page @param {'harvest' | 'science'} way */
async function toTheEnd(page, way) {
  const g = await toTheFork(page, way);
  await g.locator('.g-steps [data-step="around"]').click();
  await expect(g.locator('.g-steps li.on .l')).toHaveText('Voisines');
  return g;
}

test.describe('premier lancement', () => {
  test.use({ firstVisit: true });

  test('fin des premiers pas, la science : rien ne change sans un bouton ; « Passer en mode Scientifique » ne change que le mode', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    // Épuré, whose sheet folds « Médias » by default: the guided panes show it all the same, the mode's layout untouched.
    await page.evaluate(async () => (await import('/app/core/store.js')).setMode('epure'));
    const before = await whole(app);
    const g = await toTheEnd(page, 'science');
    await expect(g.locator('gf-plant-detail gf-media-viewer[bar-out]')).toHaveCount(1);
    await expect.poll(async () => (await panes(page)).flatMap(p => p.tabs)).toEqual(expect.arrayContaining(['media', 'wikipedia', 'map']));
    expect((await panes(page)).flatMap(p => p.tabs)).not.toContain('uses');

    // The offer: what it does, its button, « Garder tel quel » — and nothing changed yet.
    const offer = g.getByRole('group', { name: /Vous avez choisi la science/ });
    await expect(offer).toBeVisible();
    await expect(offer.getByRole('button')).toHaveText([/Passer en mode Scientifique/, 'Garder tel quel']);
    await expect(g.getByRole('button', { name: /Allumer le mode cueillette/ })).toHaveCount(0);
    expect(await whole(app)).toEqual(before);
    // On a phone too: the band within the screen — its buttons wrapped, none overflowing it nor cut off by the screen.
    expect(await g.locator('.g-end').evaluate(el => ({ over: el.scrollWidth - el.clientWidth,
      out: [...el.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).length })))
      .toEqual({ over: 0, out: 0 });
    // Its button's icon drawn in the button's own colour, never the accent of its fill (where it would vanish).
    const look = await offer.getByRole('button', { name: 'Passer en mode Scientifique' }).evaluate(b => ({
      icon: getComputedStyle(/** @type {Element} */ (b.querySelector('.bi'))).color, text: getComputedStyle(b).color, fill: getComputedStyle(b).backgroundColor }));
    expect(look.icon).toBe(look.text);
    expect(look.icon).not.toBe(look.fill);

    await offer.getByRole('button', { name: 'Passer en mode Scientifique' }).click();
    await expect.poll(() => app.state('mode')).toBe('scientific');
    expect(await whole(app)).toEqual({ ...before, mode: 'scientific' });
    await expect(g.locator('.g-end')).toContainText('Mode Scientifique activé pour toute l’application.');
    await expect(g.locator('p.visually-hidden[role="status"]').filter({ hasText: 'Mode Scientifique activé pour toute l’application.' })).toHaveCount(1);
    await expect(g.locator('.g-steps [data-step="flore"]')).toBeFocused();
    expect((await discover(page)).done).toBe(false);

    // « La flore complète »: the first steps over, Flore on the plant — the app as it is.
    await g.locator('.g-steps [data-step="flore"]').click();
    await expect.poll(() => hash(page)).toMatch(new RegExp(`^#/plant/${plantId('Allium ursinum')}\\b`));
    expect((await discover(page)).done).toBe(true);
    expect(await whole(app)).toEqual({ ...before, mode: 'scientific' });
    // The game goes on as the others: the guided way ended with it.
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.guided).toBe(false);
  });

  test('fin des premiers pas, la cueillette : « Garder tel quel » ne change rien ; « Allumer le mode cueillette » ne change que lui', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    const before = await whole(app);
    const g = await toTheEnd(page, 'harvest');
    const offer = g.getByRole('group', { name: /Vous avez choisi la cueillette/ });
    await expect(offer.getByRole('button')).toHaveText([/Allumer le mode cueillette/, 'Garder tel quel']);
    await expect(g.getByRole('button', { name: /Passer en mode Scientifique/ })).toHaveCount(0);

    // « Garder tel quel », with the keyboard: the offer put away, said, the focus on what comes next; nothing changed.
    await offer.getByRole('button', { name: 'Garder tel quel' }).focus();
    await page.keyboard.press('Enter');
    await expect(g.locator('.g-end')).toHaveCount(0);
    await expect(g.locator('p.visually-hidden[role="status"]').filter({ hasText: 'Rien n’a changé.' })).toHaveCount(1);
    await expect(g.locator('.g-steps [data-step="flore"]')).toBeFocused();
    expect(await whole(app)).toEqual(before);

    // Back one step and on again: offered again; its button does only what it says.
    await g.locator('.g-steps [data-step="prev"]').click();
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Cueillette');
    await expect(g.locator('.g-end')).toHaveCount(0);
    await g.locator('.g-steps [data-step="around"]').click();
    await g.getByRole('button', { name: 'Allumer le mode cueillette' }).click();
    await expect.poll(() => app.state('harvestMode')).toBe(true);
    expect(await whole(app)).toEqual({ ...before, harvest: true, harvestKept: '1' });
    await expect(g.locator('.g-end')).toContainText('Mode cueillette allumé pour toute l’application.');

    // A pane of the guided way folded: kept with the game, never in the mode's layout.
    await g.locator('gf-plant-detail').getByRole('button', { name: /^Replier le panneau/ }).first().click();
    await expect.poll(async () => (await panes(page)).some(p => p.folded)).toBe(true);
    expect((await panes(page)).flatMap(p => p.tabs)).toEqual(expect.arrayContaining(['media', 'wikipedia', 'uses']));
    expect(await stored(page, 'geoflora.sheetLayout')).toBe(before.layout);
  });

  for (const way of /** @type {const} */ (['science', 'harvest'])) {
    test(`fin des premiers pas au clavier (${way}) : la proposition prend le focus ; « La flore complète » sans y toucher ne change rien`, async ({ app, page }) => {
      await app.open('#/app/rencontres');
      const before = await whole(app);
      const g = await toTheFork(page, way);
      // « Les voisines › » with the keyboard: the offer takes the focus (read out by its name), not « La flore complète »,
      // which took the place of the button pressed in the bar.
      await g.locator('.g-steps [data-step="around"]').focus();
      await page.keyboard.press('Enter');
      const offer = g.getByRole('group', { name: way === 'science' ? /Vous avez choisi la science/ : /Vous avez choisi la cueillette/ });
      await expect(offer).toBeFocused();
      // A second Enter: nothing — still at « Voisines », the first steps under way, nothing changed.
      await page.keyboard.press('Enter');
      await expect(g.locator('.g-steps li.on .l')).toHaveText('Voisines');
      expect((await discover(page)).done).toBe(false);
      expect(await whole(app)).toEqual(before);

      // « La flore complète », the offer left as it is: the first steps over, Flore on the plant — nothing else changed.
      await g.locator('.g-steps [data-step="flore"]').click();
      await expect.poll(() => hash(page)).toMatch(new RegExp(`^#/plant/${plantId('Allium ursinum')}\\b`));
      expect((await discover(page)).done).toBe(true);
      expect(await whole(app)).toEqual(before);
    });
  }

  test('la fiche d’une activité ne se personnalise pas : ni couronne ni barre de mise en page, même ouverte dans Flore ; la mise en page du mode intacte', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    // « Personnaliser la fiche » open on Flore's sheet: Flore's only.
    await page.evaluate(async () => (await import('/app/core/store.js')).openKing('flore'));
    const layout = await stored(page, 'geoflora.sheetLayout');
    const g = page.locator('ma-guided');
    const detail = g.locator('gf-plant-detail');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await g.locator('.g-steps [data-step="go"]').click();
    await expect(g.locator('.swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    await page.keyboard.press('ArrowRight');
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Photos');
    await expect.poll(async () => (await panes(page)).flatMap(p => p.tabs)).toEqual(['media']);
    await expect(detail.locator('[data-pane]')).toHaveCount(1);
    // The game's panes: read, not arranged — no crown, no bar, no « Déplacer vers… », no block tools.
    await expect(detail.locator('.act.crown')).toHaveCount(0);
    await expect(detail.locator('.king-bar')).toHaveCount(0);
    await expect(detail.locator('.place-pick')).toHaveCount(0);
    await expect(detail.locator('.block-title .grip')).toHaveCount(0);
    expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
    // The mode's layout never touched.
    expect(await stored(page, 'geoflora.sheetLayout')).toBe(layout);
  });

  test('un module coupé : le bloc de son étape attend, posé quand il est rallumé (dans Réglages), une seule fois', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    /** @param {boolean} on */
    const wikipedia = on => page.evaluate(async o => (await import('/app/core/modules.js')).setModule('wikipedia', o), on);
    await wikipedia(false);
    const g = page.locator('ma-guided');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await g.locator('.g-steps [data-step="go"]').click();
    await expect(g.locator('.swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    await page.keyboard.press('ArrowRight');
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Photos');
    await g.locator('.g-steps [data-step="wiki"]').click();
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Encyclopédie');
    // Its module off: said, its block left out — kept with the game, waiting.
    await expect(g.locator('.g-off')).toContainText('Module « Wikipédia » désactivé');
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.leftOut).toEqual(['wikipedia']);
    expect((await panes(page)).flatMap(p => p.tabs)).toEqual(['media']);

    // Switched back on in Réglages, the game away: docked as it comes back, under the photos — once, never again.
    await app.go('#/settings');
    await wikipedia(true);
    await app.go('#/app/rencontres/cards');
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Encyclopédie');
    await expect(g.locator('.g-off')).toHaveCount(0);
    await expect.poll(async () => (await panes(page)).flatMap(p => p.tabs)).toEqual(['media', 'wikipedia']);
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.leftOut).toBe(null);
  });

  test('Rencontres guidée ou non : décidé au début de la partie, gardé jusqu’à « Recommencer »', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
    await expect(page.locator('ma-guided')).toHaveCount(1);
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.guided).toBe(true);
    // Its own steps bar: no « Masquer / Afficher les étapes » in the ⋯.
    const box = page.locator('gf-miniapp');
    await box.locator('.more summary').click();
    await expect(box.locator('.menu').getByRole('button', { name: /étapes/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Every tab arrives meanwhile (the first steps over, elsewhere): the game keeps its way, here and after a reload.
    await page.evaluate(async () => { const d = await import('/app/core/discover.js'); for (const t of /** @type {const} */ (['mine', 'map', 'flore'])) d.unlock(t); });
    expect((await discover(page)).done).toBe(true);
    await page.locator('ma-guided .g-steps [data-step="go"]').click();
    await expect(page.locator('ma-guided .swipe-card.top')).toBeVisible();
    await expect(page.locator('ma-around-list')).toHaveCount(0);
    await page.reload();
    await app.ready();
    await expect(page.locator('ma-guided')).toHaveCount(1);
    await expect(page.locator('ma-around-list')).toHaveCount(0);

    // « Recommencer »: decided anew — the first steps over, the game is no longer guided.
    await box.locator('.more summary').click();
    await box.locator('.menu').getByRole('button', { name: 'Recommencer' }).click();
    await box.getByRole('dialog').getByRole('button', { name: 'Recommencer' }).click();
    await expect.poll(() => hash(page)).toBe('#/app/rencontres/start');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await expect(page.locator('ma-distance')).toHaveCount(1);
    await expect(page.locator('ma-guided')).toHaveCount(0);
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.guided).toBe(false);
  });

  test('les premiers pas finis ailleurs (« Tout montrer maintenant ») : la partie guidée reprend comme les autres, jamais à une dernière étape toute cochée', async ({ app, page }) => {
    await app.open('#/app/rencontres');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await expect(page.locator('ma-guided')).toHaveCount(1);
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.guided).toBe(true);
    await app.go('#/settings');
    await page.getByRole('button', { name: 'Tout montrer maintenant' }).click();
    expect((await discover(page)).done).toBe(true);

    // « Continuer »: the map and its distance, then the list — the guided way ended with the first steps.
    await app.go('#/app/rencontres');
    await page.getByRole('group', { name: 'Continuer' }).getByRole('button').click();
    await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
    await expect(page.locator('ma-distance')).toHaveCount(1);
    await expect(page.locator('ma-guided')).toHaveCount(0);
    await app.go('#/app/rencontres/cards');
    await expect(page.locator('ma-around-list')).toHaveCount(1);
    await expect(page.locator('ma-guided')).toHaveCount(0);
  });

  test('une partie guidée d’une version d’avant : son chemin fixé à la reprise, ses panneaux repris de la mise en page du mode', async ({ app, page }) => {
    await app.open('#/');
    // As a version before left it: the guided steps up to « Encyclopédie », their panes docked into the mode's layout
    // (the photos beside the sheet, the encyclopedia under them), the game with its place but no way of its own.
    await page.evaluate(async () => {
      const sb = await import('/app/core/sheet-blocks.js');
      sb.dockBlock('standard', 'media', 'sheet', 'right');
      sb.dockBlock('standard', 'wikipedia', /** @type {any} */ (sb.paneOf('standard', 'media')).id, 'bottom');
      localStorage.setItem('geoflora.discover', JSON.stringify({ done: false, unlocked: [], tips: [], seen: [], step: 2, firstMatch: true, branch: null }));
      localStorage.setItem('geoflora.app.rencontres.state', JSON.stringify({ v: 1, path: ['start', 'map', 'cards'],
        ctx: { point: [2.35, 48.85], place: 'Paris', radius: 1000, matches: [], passed: [] }, finished: false }));
    });
    await page.goto('about:blank');
    await app.open('#/app/rencontres/cards');
    const g = page.locator('ma-guided');
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Encyclopédie');
    // Its way as it was playing, kept; the panes back in the sheet of the mode, the game's own holding them now.
    await expect.poll(async () => (await kept(page, 'rencontres'))?.ctx.guided).toBe(true);
    await expect.poll(async () => (await panes(page)).flatMap(p => p.tabs)).toEqual(expect.arrayContaining(['media', 'wikipedia']));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.sheetLayout') || '{}').tree?.standard ?? null)).toBe(null);

    // Every tab arrives meanwhile (the first steps over): the game keeps its way.
    await page.evaluate(async () => { const d = await import('/app/core/discover.js'); for (const t of /** @type {const} */ (['mine', 'map', 'flore'])) d.unlock(t); });
    expect((await discover(page)).done).toBe(true);
    await expect(g.locator('.g-steps li.on .l')).toHaveText('Encyclopédie');
    await expect(page.locator('ma-around-list')).toHaveCount(0);
  });

  test('les plantes vues comptent dans toutes les activités : un parcours noté, une fiche ouverte de Faux amis', async ({ app, page }) => {
    await app.open('#/app/parcours');
    const trail = page.locator('gf-miniapp');
    await trail.locator('.go').click();
    await trail.locator('.search input').fill('ortie dioique');
    await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
    await expect(trail.locator('.mine > li')).toHaveCount(1);
    await expect.poll(async () => (await discover(page)).seen).toContain(plantId('Urtica dioica'));

    await app.go(`#/app/faux-amis/start?p=${plantId('Geum urbanum')}`);
    await expect(page.locator('ma-plant-sheet')).toHaveCount(1);
    await expect.poll(async () => (await discover(page)).seen).toEqual(expect.arrayContaining([plantId('Urtica dioica'), plantId('Geum urbanum')]));
  });
});

test('⋯ « Masquer les étapes » : pour cette activité seulement, le réglage de toutes inchangé ; « Recommencer » l’oublie', async ({ app, page }) => {
  await app.open('#/app/cueillette');
  const box = page.locator('gf-miniapp');
  await expect(box.locator('ma-steps')).toHaveCount(1);
  await box.locator('.more summary').click();
  const item = box.locator('.menu').getByRole('button', { name: /^Masquer les étapes/ });
  // Its scope said on screen, under its label (a touch screen shows no tooltip).
  await expect(item.locator('small')).toBeVisible();
  await expect(item.locator('small')).toHaveText('Pour cette activité seulement');
  await item.click();
  await expect(box.locator('ma-steps')).toHaveCount(0);
  expect(await stored(page, 'geoflora.showSteps')).toBe(null);
  expect(await app.state('showSteps')).toBe('auto');
  await expect.poll(async () => (await kept(page, 'cueillette'))?.ownSteps).toBe('off');

  // The others: as the setting of all says; Réglages unchanged, and says what the ⋯ does.
  await app.go('#/app/mosaique');
  await expect(box.locator('ma-steps')).toHaveCount(1);
  await app.go('#/settings');
  await expect(page.getByRole('radio', { name: /La première fois/ })).toBeChecked();
  await expect(page.getByText('Le menu ⋯ d’une activité en décide pour elle seule, jusqu’à ce qu’on la recommence.')).toBeVisible();
  await app.go('#/app/cueillette');
  await expect(box.locator('.start')).toBeVisible();
  await expect(box.locator('ma-steps')).toHaveCount(0);

  // « Recommencer »: forgotten with the rest of it.
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Recommencer' }).click();
  await box.getByRole('dialog').getByRole('button', { name: 'Recommencer' }).click();
  await expect(box.locator('ma-steps')).toHaveCount(1);
  await expect.poll(() => kept(page, 'cueillette')).toBe(null);
  expect(await stored(page, 'geoflora.showSteps')).toBe(null);
});

test('mode cueillette « auto » : il suit les récoltes qui arrivent, sans rien écrire ; réglé, il reste', async ({ app, page }) => {
  /** A place with a harvest of this plant, saved (as an import or a transfer link brings one). @param {string} name */
  const harvest = name => page.evaluate(async id => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    let place = c.withPlant(c.newPlace([2.35, 48.85], { name: 'Lisière ' + id }), await db.get('plants', id));
    place = c.withEntry(place, id, { harvests: [{ date: '2026-04-12', quantity: '1 kg', note: '' }] });
    await c.saveCollection(place);
  }, plantId(name));
  // A version before wrote it by itself (at its first launch, or as Cueillette prudente began): no choice — forgotten.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('geoflora.harvestMode', '1');
  });
  await app.open('#/settings');
  expect(await stored(page, 'geoflora.harvestMode')).toBe(null);
  expect(await stored(page, CHOICE)).toBe(null);
  expect(await app.state('harvestMode')).toBe(false);
  const auto = page.getByText('Automatique tant que vous ne l’avez pas réglé', { exact: false });
  await expect(auto).toBeVisible();
  const box = page.getByRole('checkbox', { name: /Journal de récolte/ });
  await expect(box).not.toBeChecked();

  await harvest('Allium ursinum');
  await expect.poll(() => app.state('harvestMode')).toBe(true);
  await expect(box).toBeChecked();
  expect(await stored(page, CHOICE)).toBe(null);

  // Set by the user: kept, whatever arrives.
  await box.uncheck();
  await expect.poll(() => stored(page, CHOICE)).toBe('0');
  await expect(auto).toHaveCount(0);
  await harvest('Urtica dioica');
  expect(await app.state('harvestMode')).toBe(false);
  await expect(box).not.toBeChecked();
});
