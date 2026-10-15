// « Disposition libre » : the frame every cell shares (registry.js#FRAME), written in its parameters. Its head (tete=non:
// none, the content taking the room; tete=simple: its title alone), a title of its own (titre=: its head, its tab on a
// phone), the actions of its head (agrandir: over the layout, Échap returns; replier: folded to its head, its share to
// the others; partager: a link to a layout of this cell alone, with the same state, copied), its empty state
// (vide=masque: a plant block hidden until a plant is chosen), its links (plante=: a plant of its own, whatever the
// current one; results zone=0: the whole flora whatever the zone; toucher=fiche: a result opens its sheet; toucher=rien:
// nothing), and the editor's « Cadre » writing them in the address. iNaturalist answered as in free-layout.spec.mjs:
// 12 plants around.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const ORTIE = 'Urtica dioica', AIL = 'Allium ursinum';
const AT = 'at=48.85,2.35';
const SHOTS = process.env.SHOTS_DIR || '';

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => {
    const names = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
    const results = names.map((name, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name, preferred_common_name: null } }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results }) });
  });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: 0, results: [] }) }));
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
    await expect.poll(() => app.state('results.total')).toBe(12);
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
    await acts.getByRole('button', { name: /Revenir à la disposition/ }).click();
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

  test('« Créer une app » : « Cadre » et « Liens » dans le choix du contenu, écrits dans l’adresse ; l’app les montre', async ({ app, page }) => {
    await app.open(`#/builder?g=[results(list),plant.wikipedia]&p=${plantId(ORTIE)}`);
    const p = page.locator('gf-block-picker:not([inline])');
    await page.locator('gf-builder gf-layout section.cell[data-comp="plant.wikipedia"] .cell-head .pick').click();
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
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'))).toBe(spec);
    await page.keyboard.press('Escape');
    await page.locator('gf-builder [data-act="open-app"]').click();
    await expect.poll(() => hash(page)).toBe(`#/layout/${spec}?p=${plantId(ORTIE)}`);
    await expect(cellOf(page, 'plant.wikipedia').locator('.cell-head h2')).toHaveText('Article le mien');
    // A component that cannot be empty has no « Sans rien à montrer »; the results, not the plant links but the zone.
    await page.locator('gf-layout [data-act="modifier"]').click();
    await page.locator('gf-builder gf-layout section.cell[data-comp="results"] .cell-head .pick').click();
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
