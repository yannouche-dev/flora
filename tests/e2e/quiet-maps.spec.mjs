// The quiet-map rule (app/components/gf-map.js), on every map screen in its noisy states: nothing is written over a map
// but its controls and credits (quiet.mjs overMap) — its state goes to its panel « Carte » (« État », next to its
// controls), each thing said once by its one live region; a load shows no text; only an action the user just took
// that failed shows one brief toast (core/toast.js: gone in under 3 s, never two); a gesture worth knowing is a hint
// shown once per device, dismissible. The screens: the Carte (empty, IGN backgrounds off, protected areas in view, the
// address search slow / failing / empty, « Me localiser » refused, Autour failing and its points, editing positions),
// a plant sheet's map (its legend, its chips, its observations around me refused, its gestures), the Disposition's
// map cell (its zone unreachable, a point outside the flora, its long press), the mini-apps' distance step and the
// guided Découvrir (their counts said), the Parcours (its word docked beside the map), and a map in 3D (loading,
// the relief unreachable, editing, the observations around).
import { test, expect, plantId, answerAround, answerPlantNear, answerObservations } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { brief, coveredControls, mapSaid, mapState, openPanel, overMap } from './quiet.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

const carte = (/** @type {Page} */ page) => page.locator('gf-map-page gf-map');

/** Two places in Paris, three plants. @param {Page} page @returns {Promise<string>} the first place's id */
function seedParis(page) {
  return page.evaluate(async ([a, b, c]) => {
    const col = await import('/app/core/collections.js');
    let p = col.newPlace([2.3500, 48.8500], { name: 'Jardin du test' });
    p = col.withPlant(p, { id: a, scientificName: 'Urtica dioica' }, { coordinates: [2.3504, 48.8502], accuracy: 5 });
    p = col.withPlant(p, { id: b, scientificName: 'Allium ursinum' }, { coordinates: [2.3496, 48.8498], accuracy: 5 });
    const saved = await col.savePlace(p);
    let q = col.newPlace([2.3530, 48.8510], { name: 'Square voisin' });
    q = col.withPlant(q, { id: c, scientificName: 'Bellis perennis' }, { coordinates: [2.3531, 48.8511], accuracy: 5 });
    await col.savePlace(q);
    return saved.id;
  }, [plantId('Urtica dioica'), plantId('Allium ursinum'), plantId('Bellis perennis')]);
}

/** Stored before the app starts, once (a reload keeps what the app wrote since). @param {Page} page @param {Record<string, string>} kv */
const preset = (page, kv) => page.addInitScript(v => {
  if (sessionStorage.getItem('gf-quiet-set')) return;
  sessionStorage.setItem('gf-quiet-set', '1');
  for (const [k, val] of Object.entries(v)) localStorage.setItem(k, val);
}, kv);

/** The device refuses the position (the browser's answer to every request). @param {Page} page */
const refuseLocation = page => page.addInitScript(() => {
  const fail = (/** @type {any} */ f) => setTimeout(() => f?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' }), 30);
  navigator.geolocation.watchPosition = (_ok, f) => { fail(f); return 1; };
  navigator.geolocation.getCurrentPosition = (_ok, f) => { fail(f); };
  navigator.geolocation.clearWatch = () => {};
});

/** Every first-use hint already seen (a returning visitor): only the screens' own words over the maps. */
const HINTS_SEEN = JSON.stringify(['carte-empty', 'map-edit', 'map-touch-again', 'sheet-map-gestures', 'layout-map-press', 'obs3d-press', 'editor-gestures']);

/** Nothing over the visible maps but controls and credits (and what `allowed` names: a step's own panel, a sheet). @param {Page} page @param {string[]} [allowed] */
async function quiet(page, allowed = []) {
  await expect.poll(() => overMap(page, allowed), { message: 'texts over a map', timeout: 4000 }).toEqual([]);
}

/** The brief toast says `words`, alone, and is gone in under 3 s. @param {Page} page @param {string | RegExp} words */
async function briefly(page, words) {
  await expect(brief(page)).toHaveText(words);
  await expect(brief(page)).toHaveCount(1);
  // Timed in the page, frame by frame (the test's own polling would add its intervals): from now — it shows
  // already — until it is gone (wherever it is: the body, an open dialog in a shadow root).
  const lasted = await page.evaluate(() => new Promise(done => {
    /** @param {Document | ShadowRoot} root @returns {boolean} */
    const there = root => Boolean(root.querySelector('.gf-brief-toast')) || [...root.querySelectorAll('*')].some(e => e.shadowRoot && there(e.shadowRoot));
    const t0 = performance.now();
    const look = () => {
      const t = performance.now() - t0;
      if (!there(document) || t > 6000) done(t); else setTimeout(look, 20);
    };
    look();
  }));
  expect(lasted, 'the toast lasts under 3 s').toBeLessThan(3000);
}

test.describe('la Carte', () => {
  test('vide : l’astuce une seule fois (refermable), puis jamais ; la liste le dit toujours', async ({ app, page }) => {
    await app.open('#/map');
    const map = carte(page);
    await expect(map.locator('.leaflet-container')).toBeVisible();
    const hint = page.locator('gf-map-page .hint-once');
    await expect(hint).toContainText('Aucun lieu enregistré.');
    await quiet(page);
    // Above the map, not over it: every control within reach (zoom, scale).
    if (!app.phone) await expect(map.locator('.leaflet-control-zoom-in')).toBeVisible();
    expect(await coveredControls(page)).toEqual([]);
    const [h, m] = [await hint.boundingBox(), await map.boundingBox()];
    expect(/** @type {any} */ (h).y + /** @type {any} */ (h).height).toBeLessThanOrEqual(/** @type {any} */ (m).y + 1);
    await hint.getByRole('button', { name: 'Masquer l’astuce' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await app.ready();
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator('gf-map-page .hint-once, gf-map-page p.empty')).toHaveCount(0);
    await expect(page.locator('gf-map-page .bar .count')).toHaveText('0 lieu');
    await page.locator('gf-map-page .segmented').getByRole('button', { name: 'Liste' }).click();
    await expect(page.locator('gf-map-page p.empty')).toContainText('Aucun lieu enregistré.');
  });

  test('fonds IGN coupés et espaces protégés en vue : rien sur la carte, le panneau le dit, un point sur son bouton', async ({ app, page }) => {
    await preset(page, { 'geoflora.modules': JSON.stringify({ ignMaps: false }), 'geoflora.hints': HINTS_SEEN });
    await page.route(/^https:\/\/data\.geopf\.fr\/wfs\/ows\?/, route => {
      const t = new URL(route.request().url()).searchParams.get('TYPENAMES') || '';
      const features = /rnn/.test(t) ? [{ id: 'a', properties: { nom_site: 'Réserve naturelle nationale du Test', url_fiche: 'https://inpn.mnhn.fr/espace/protege/FR3600001', id_mnhn: 'FR3600001' } }]
        : /apb/.test(t) ? [{ id: 'b', properties: { nom_site: 'Biotope des Mares', url_fiche: null, id_mnhn: 'FR3800001' } }] : [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features }), headers: { 'access-control-allow-origin': '*' } });
    });
    await app.open('#/collections');
    const spot = await seedParis(page);
    await app.go(`#/map?spot=${spot}`);
    const map = carte(page);
    await expect(map.locator('.leaflet-marker-pane .gf-place')).toHaveCount(2);
    await expect.poll(() => mapState(map), { timeout: 10_000 }).toEqual(expect.arrayContaining([
      'Fonds IGN désactivés : seules les zones déjà vues s’affichent.',
      expect.stringMatching(/^Espaces protégés en vue : Réserve naturelle nationale du Test, Biotope des Mares — la cueillette/)
    ]));
    await quiet(page);
    await expect(map.locator('.gf-map-off, .gf-map-protected, .gf-map-notes')).toHaveCount(0);
    // Said once each.
    await expect(mapSaid(map)).toContainText('Fonds IGN désactivés');
    await expect(mapSaid(map)).toContainText('Espaces protégés en vue');
    // A discreet dot on the panel's button, said in its name.
    const button = map.locator('gf-map-search').getByRole('button', { name: 'Carte : fond, couches, légende — espaces protégés en vue' });
    await expect(button.locator('.dot')).toHaveCount(1);
    // The panel: its « État » (with the way to the setting), the areas under « Espaces protégés et propriété » (open by
    // itself: areas in view) with their page.
    const panel = await openPanel(map);
    await expect(panel.locator('details.theme[data-group="espaces"]')).toHaveAttribute('open', '');
    const state = panel.locator('.state');
    await expect(state).toContainText('Fonds IGN désactivés : seules les zones déjà vues s’affichent.');
    await expect(state.getByRole('link', { name: 'Réglages › Modules' })).toHaveAttribute('href', /settings/);
    await expect(state).toContainText('Espaces protégés en vue');
    const areas = panel.getByRole('list', { name: 'Espaces protégés en vue' });
    await expect(areas.getByRole('link', { name: 'Réserve naturelle nationale du Test' })).toHaveAttribute('href', 'https://inpn.mnhn.fr/espace/protege/FR3600001');
    await expect(areas).toContainText('Biotope des Mares');
    await expect(panel.locator('.state[role], .note3d[role]')).toHaveCount(0);
    // Said while the panel is open (a modal: the map's own region inert meanwhile): by the panel's one region.
    await expect(panel.locator('[aria-live]')).toHaveCount(1);
    await map.evaluate(m => /** @type {any} */ (m).announce('Dit panneau ouvert'));
    await expect(panel.locator('[aria-live]')).toHaveText('Dit panneau ouvert');
    await expect(mapSaid(map)).not.toContainText('Dit panneau ouvert');
    await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
    await map.evaluate(m => /** @type {any} */ (m).announce('Dit panneau fermé'));
    await expect(mapSaid(map)).toContainText('Dit panneau fermé');
  });

  test('la recherche d’adresse : rien d’écrit pendant qu’elle cherche ; injoignable, puis sans résultat : un message bref chaque fois', async ({ app, page }) => {
    await preset(page, { 'geoflora.hints': HINTS_SEEN });
    let answer = (/** @type {import('@playwright/test').Route} */ route) => route.fulfill({ status: 503, body: '' });
    await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/completion/, async route => { await new Promise(r => setTimeout(r, 1500)); return answer(route); });
    await app.open('#/map');
    const map = carte(page);
    await expect(map.locator('.leaflet-container')).toBeVisible();
    const input = map.locator('gf-map-search input[type="search"]');
    await input.fill('rue de la paix');
    // Searching: no « Recherche… » row; past 400 ms the map's thin line, aria-busy on the field.
    await expect(input).toHaveAttribute('aria-busy', 'true');
    await expect(map).toHaveAttribute('busy', '', { timeout: 2000 });
    await expect(map.locator('gf-map-search li, gf-map-search .status')).toHaveCount(0);
    await quiet(page);
    // Failed: one brief toast over the map, said; nothing left under the pill.
    await briefly(page, 'Recherche d’adresse indisponible pour le moment.');
    await expect(mapSaid(map)).toContainText('Recherche d’adresse indisponible pour le moment.');
    await expect(map).not.toHaveAttribute('busy', '');
    await expect(input).toHaveAttribute('aria-busy', 'false');
    // Nothing found.
    answer = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }), headers: { 'access-control-allow-origin': '*' } });
    await input.fill('zzzz introuvable');
    await briefly(page, 'Aucun résultat pour « zzzz introuvable ».');
    await expect(mapSaid(map)).toContainText('Aucun résultat pour « zzzz introuvable ».');
    await expect(map.locator('gf-map-search ul')).toHaveCount(0);
    await quiet(page);
  });

  test.describe('position refusée', () => {
    test.use({ permissions: [] });
    test('« Me localiser » refusé : un message bref (moins de 3 s), dit ; jamais deux à la fois', async ({ app, page }) => {
      await preset(page, { 'geoflora.hints': HINTS_SEEN });
      await refuseLocation(page);
      await app.open('#/map');
      const map = carte(page);
      await expect(map.locator('.leaflet-container')).toBeVisible();
      await map.getByRole('button', { name: 'Me localiser' }).click();
      await expect(brief(page)).toHaveText('Localisation refusée. Autorisez-la dans les réglages du navigateur.');
      // Asked again at once: still one toast.
      await map.getByRole('button', { name: 'Me localiser' }).click();
      await expect(brief(page)).toHaveCount(1);
      await expect(brief(page)).toHaveCount(0, { timeout: 3500 });
      await expect(mapSaid(map)).toContainText('Localisation refusée.');
      // Asked again once it has gone: shown again, and said again (a new line — not dropped as said a moment ago).
      await mapSaid(map).locator('p').evaluateAll(ps => ps.forEach(p => p.setAttribute('data-old', '')));
      await map.getByRole('button', { name: 'Me localiser' }).click();
      await expect(brief(page)).toHaveCount(1);
      await expect(mapSaid(map).locator('p:not([data-old])')).toHaveText('Localisation refusée. Autorisez-la dans les réglages du navigateur.');
      await quiet(page);
    });
  });

  test('Autour : iNaturalist injoignable — un message bref, la feuille garde « Réessayer » sans phrase', async ({ app, page }) => {
    await preset(page, { 'geoflora.hints': HINTS_SEEN });
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts/, route => route.fulfill({ status: 503, body: '' }));
    await app.open('#/map');
    const map = carte(page);
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await page.locator('gf-map-page .around-toggle').click();
    const sheet = page.locator('gf-map-page .sheet.around');
    await briefly(page, 'iNaturalist ne répond pas pour le moment.');
    await expect(mapSaid(map)).toContainText('iNaturalist ne répond pas pour le moment.');
    await expect(sheet.getByRole('button', { name: 'Réessayer' })).toHaveAttribute('title', 'iNaturalist ne répond pas pour le moment.');
    await expect(sheet.locator('.notes')).toHaveCount(0);
    await quiet(page, ['.sheet.around']);
  });

  test('Autour : les espèces, puis une espèce — ni « Chargement… » ni compte de points écrit, ses points dits', async ({ app, page, context }) => {
    await preset(page, { 'geoflora.hints': HINTS_SEEN });
    await answerAround(context);
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, async route => { await new Promise(r => setTimeout(r, 1200)); return route.fallback(); });
    await app.open('#/map');
    const map = carte(page);
    await expect(map.locator('.leaflet-container')).toBeVisible();
    const sheet = page.locator('gf-map-page .sheet.around');
    await page.locator('gf-map-page .around-toggle').click();
    await expect(sheet.locator('.species .pick').first()).toBeVisible({ timeout: 10_000 });
    await expect(mapSaid(map)).toContainText(/Autour : \d+ espèces? observées?/);
    await sheet.locator('.species .pick').first().click();
    // Its points coming: the map's thin line past 400 ms, no text in the sheet.
    await expect(map).toHaveAttribute('busy', '', { timeout: 2000 });
    await expect(sheet).not.toContainText('Chargement');
    await expect(mapSaid(map)).toContainText(/\d+ points? sur la carte|aucun point localisé/, { timeout: 10_000 });
    await expect(map).not.toHaveAttribute('busy', '');
    await expect(sheet).not.toContainText('Chargement');
    await expect(sheet).not.toContainText('sur la carte');
    await quiet(page, ['.sheet.around']);
  });

  test('modifier les positions : « Terminé » seul après la première fois ; un lieu lâché demande « Déplacer le lieu ici ? » ; « Position enregistrée » dit, jamais écrit', async ({ app, page }) => {
    await app.open('#/collections');
    const spot = await seedParis(page);
    await app.go(`#/map?spot=${spot}`);
    const map = carte(page);
    await expect(map.locator('.leaflet-marker-pane .gf-place')).toHaveCount(2);
    await map.getByRole('button', { name: 'Modifier les positions' }).click();
    const bar = map.locator('.gf-map-editbar');
    // The first time ever: how it works (a hint, refermable), said.
    await expect(bar.locator('.hint')).toContainText('le lieu une fois confirmé, une plante dès que vous la lâchez');
    await expect(mapSaid(map)).toContainText('Modification des positions');
    // A place in sight (the map has gone full screen), dragged a little.
    const vp = /** @type {{ width: number, height: number }} */ (page.viewportSize());
    const boxes = await map.locator('.leaflet-marker-pane .gf-place.editing').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const b = boxes.find(r => r.x > 20 && r.y > 80 && r.x + r.width < vp.width - 60 && r.y + r.height < vp.height - 80);
    if (!b) throw new Error('no place in sight: ' + JSON.stringify(boxes));
    await page.mouse.move(b.x + b.width / 2, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + 40, { steps: 8 });
    await page.mouse.up();
    // A place asks first (its card in the place of « Terminé »), said; saved once confirmed.
    const card = map.locator('gf-point-card');
    await expect(card.getByRole('heading', { name: 'Déplacer le lieu ici ?' })).toBeVisible();
    await expect(mapSaid(map)).toContainText('Déplacer le lieu ici ?');
    await expect(bar).toBeHidden();
    await quiet(page, ['.panel']);
    await card.getByRole('button', { name: 'Confirmer' }).click();
    await expect(mapSaid(map)).toContainText('Position enregistrée');
    await expect(page.locator('gf-map-page .toast')).toHaveCount(0);
    await expect(brief(page)).toHaveCount(0);
    await bar.getByRole('button', { name: 'Terminé' }).click();
    await expect(bar).toHaveCount(0);
    // Again: « Terminé » alone (its title says how).
    await map.getByRole('button', { name: 'Modifier les positions' }).click();
    await expect(bar.locator('.hint')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Terminé' })).toHaveAttribute('title', /une plante dès que vous la lâchez/);
    await bar.getByRole('button', { name: 'Terminé' }).click();
    await quiet(page, ['.panel']);
  });
});

test.describe('la carte d’une fiche plante', () => {
  test('ses observations autour de moi : la légende dans son panneau, les nombres dits ; ses puces disent leur état dans leur nom ; ses gestes une fois', async ({ app, page }) => {
    await answerPlantNear(page, { inat: 6, gbif: 7 });
    await app.open('#/collections');
    await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { near: 'both', gbif: 'off' }); });
    await app.go(`#/plant/${plantId('Urtica dioica')}`);
    const block = page.locator('gf-sheet-map:not([map-3d="off"])').first();
    // Its rubric at the top of the sheet: the map under its heading, not scrolled beneath it (a sticky heading).
    await block.evaluate(el => el.closest('section')?.scrollIntoView({ block: 'start' }));
    const map = block.locator('gf-map');
    await expect(map.locator('.leaflet-container')).toBeVisible();
    // Its gestures: a hint the first time (refermable), the map's own description always.
    await expect(block.locator('.hint-once.gestures')).toContainText('Appui long sur la carte');
    await expect(map).toHaveAttribute('aria-description', /Appui long sur la carte/);
    await block.locator('.hint-once.gestures').getByRole('button', { name: 'Masquer l’astuce' }).click();
    await expect(block.locator('.hint-once')).toHaveCount(0);
    await block.locator('.near-ask').click();
    await expect(mapSaid(map)).toContainText(/Autour de vous : \d+ observations sur la carte/, { timeout: 15_000 });
    await expect(block.locator('.legend, p.hint')).toHaveCount(0);
    const panel = await openPanel(map);
    await expect(panel.locator('.legend.page')).toContainText('iNaturalist (6)');
    await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
    // A plant compared that GBIF does not know, a point: their chips name it, no suffix written over the map.
    await page.route(/^https:\/\/api\.gbif\.org\/v1\/species\/match\?.*(Urtica(\+|%20)urens)/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ matchType: 'NONE' }), headers: { 'access-control-allow-origin': '*' } }));
    await block.evaluate(el => {
      /** @type {any} */ (el).mapFocus = { compare: { kind: 'compare', label: 'Ortie brûlante', taxon: 'Urtica urens' }, point: { kind: 'point', label: 'Herbier P01234 · 1898', coordinates: [2.36, 48.86] } };
    });
    const compare = block.locator('.chip[data-kind="compare"]');
    await expect(compare).toHaveAttribute('aria-label', 'Comparaison : Ortie brûlante (absente de GBIF). Retirer la comparaison');
    await expect(compare).toHaveText('Comparaison : Ortie brûlante');
    // Why nothing is drawn for it: its swatch hollow, a line of the map's « État » (seen on a touch screen too), said.
    await expect(compare.locator('i.none')).toHaveCount(1);
    await expect.poll(() => mapState(map)).toContain('Ortie brûlante : absente de GBIF, rien à comparer');
    await expect(mapSaid(map)).toContainText('Ortie brûlante : absente de GBIF, rien à comparer');
    // The point: shown and flown to, said; its name on hover or touch only (no label left over the map).
    await expect(mapSaid(map)).toContainText('Sur la carte : Herbier P01234 · 1898');
    await expect(map.locator('.gf-focus-tip, .leaflet-tooltip, .gf-gl-label')).toHaveCount(0);
    await quiet(page);
  });

  test.describe('position refusée', () => {
    test.use({ permissions: [] });
    test('« Observations autour de moi » refusé : un message bref sur la carte, pas de ligne d’alerte', async ({ app, page }) => {
      await preset(page, { 'geoflora.hints': HINTS_SEEN });
      await refuseLocation(page);
      await answerPlantNear(page);
      await app.open('#/collections');
      await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { near: 'both', gbif: 'off' }); });
      await app.go(`#/plant/${plantId('Urtica dioica')}`);
      const block = page.locator('gf-sheet-map:not([map-3d="off"])').first();
      await block.scrollIntoViewIfNeeded();
      await block.locator('.near-ask').click();
      await briefly(page, /^Localisation refusée\./);
      await expect(block.locator('[role="alert"], p.hint')).toHaveCount(0);
      // The button again, to try again; its privacy line its description.
      await expect(block.locator('.near-ask')).toHaveAttribute('aria-describedby', 'near-note');
      await expect(mapSaid(block.locator('gf-map'))).toContainText('Localisation refusée.');
    });
  });
});

test.describe('la Disposition libre', () => {
  test('la carte sans zone : l’appui long dit une fois ; zone injoignable : l’état dans le panneau ; un point hors flore : un message bref', async ({ app, page }) => {
    await app.open('#/layout/[map,search]');
    const cell = page.locator('dl-map');
    const map = cell.locator('gf-map');
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await expect(cell.locator('.hint-once')).toContainText('Appui long sur la carte, puis « Confirmer » : la zone s’y centre.');
    await expect(map).toHaveAttribute('aria-description', 'Appui long sur la carte, puis « Confirmer » : la zone s’y centre.');
    // Above the map (not in its zone panel, which it made taller over the map's controls).
    expect(await coveredControls(page)).toEqual([]);
    await cell.locator('.hint-once').getByRole('button', { name: 'Masquer l’astuce' }).click();
    await expect(cell.locator('.hint-once, .note')).toHaveCount(0);

    // A zone whose observations iNaturalist cannot give: no « recherche… », no error line over the map — its state.
    let down = true;
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, async route => {
      if (down) { await new Promise(r => setTimeout(r, 1200)); return route.fulfill({ status: 503, body: '' }); }
      const results = Array.from({ length: 12 }, (_, i) => ({ id: 500 + i, observed_on: '2026-05-01', geojson: { coordinates: [2.35 + (i % 4 - 2) * 0.002, 48.85 + (Math.floor(i / 4) - 1) * 0.002] },
        taxon: { id: 999, name: 'Xanthium imaginarium', preferred_common_name: 'Lampourde imaginaire' }, photos: [] }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: 12, results }) });
    });
    await app.go('#/layout/[map(r=1km),search]?at=48.85,2.35');
    await expect(map).toHaveAttribute('busy', '', { timeout: 3000 });
    await expect(cell.locator('.note')).toHaveCount(0);
    await expect.poll(() => mapState(map), { timeout: 10_000 }).toContain('iNaturalist ne répond pas : la zone ne filtre pas les plantes pour l’instant.');
    await expect(mapSaid(map)).toContainText('iNaturalist ne répond pas : la zone ne filtre pas les plantes pour l’instant.');
    await quiet(page, ['.panel']);

    // A point of a plant outside the flora (a map showing every observation of the zone: suit=0), touched: one brief toast.
    down = false;
    await app.go('#/layout/[map(r=2km,suit=0),search]?at=48.85,2.35');
    const leaf = map.locator('.leaflet-marker-pane .gf-obs-leaf').first();
    await expect(leaf).toBeVisible({ timeout: 10_000 });
    if (app.phone) await leaf.tap({ force: true }); else await leaf.click({ force: true });
    if (app.phone) await leaf.tap({ force: true });
    await briefly(page, 'Lampourde imaginaire : pas dans la flore de France de GeoFlora.');
    await expect(cell.locator('.note')).toHaveCount(0);
  });
});

test.describe('les activités', () => {
  test('l’étape « Jusqu’où part l’expédition ? » : le nombre d’observations dit, pas écrit ; la carte compacte', async ({ app, page, context }) => {
    await answerAround(context);
    await app.open('#/app/rencontres');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/map');
    const map = page.locator('ma-distance gf-map');
    await expect(mapSaid(map)).toContainText('observations de plantes', { timeout: 10_000 });
    await expect(page.locator('ma-distance .obs, ma-distance .spin')).toHaveCount(0);
    // The step's own card (its title, its slider) is its UI, not the map's noise.
    await quiet(page, ['.welcome']);
  });

  test.describe('première visite', () => {
    test.use({ firstVisit: true });
    test('les premiers pas de Rencontres : le panneau « Jusqu’où chercher » sans compte écrit (dit), puis le périmètre sans légende', async ({ app, page, context }) => {
      await answerAround(context);
      await app.open('#/app/rencontres');
      await page.getByRole('button', { name: 'Autour de moi' }).click();
      const map = page.locator('ma-around-map gf-map');
      await expect(mapSaid(map)).toContainText(/observations? de plantes, \d+ espèces? différentes?/, { timeout: 10_000 });
      await expect(page.locator('ma-around-map .g-seen')).toHaveText('');
      await quiet(page, ['.g-launch']);
      await page.locator('ma-guided .g-steps [data-step="go"]').click();
      await expect(page.locator('ma-around-map .g-where')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('ma-around-map .g-legend')).toHaveCount(0);
      await quiet(page, ['.g-where', '.g-launch']);
    });
  });

  test('Parcours : le mot après un ajout, bref, rangé sous la liste — jamais sur la carte — avec « Annuler »', async ({ app, page }) => {
    await app.open('#/app/parcours');
    const trail = page.locator('gf-miniapp');
    await trail.locator('.go').click();
    const name = trail.locator('.card input.name');
    await expect(name).toBeVisible();
    await name.fill('Bord du canal');
    await name.press('Enter');
    await trail.locator('.search input').fill('ortie dioique');
    await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
    const toast = brief(page);
    await expect(toast).toContainText('ajoutée au parcours');
    await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();
    // Docked under the list: not over the walk's map.
    const t = await toast.boundingBox(), m = await trail.locator('ma-walk-map gf-map').boundingBox();
    if (t && m && !app.phone) expect(t.x + t.width <= m.x + 1 || t.y >= m.y + m.height - 1 || t.y + t.height <= m.y + 1, 'the toast beside the map').toBe(true);
    // Read out by the toasts' one region (its text changed, not a toast injected with role=status).
    await expect(toast).not.toHaveAttribute('role', 'status');
    await expect(page.locator('body > .gf-toast-live')).toContainText('ajoutée au parcours');
    // Its « Annuler » within reach: it stays while it holds the focus (past its time), goes once left.
    await toast.getByRole('button', { name: 'Annuler' }).focus();
    await page.waitForTimeout(7000);
    await expect(toast).toBeVisible();
    await name.focus();
    // Left for good: the mouse away too (the click on « Ajouter » left it where the toast came, a hover that holds it).
    await page.mouse.move(1, 1);
    // Left: its full time again (ACTION_TOAST_MS, 6 s), then gone — with room for a slow runner's frames.
    await expect(toast).toHaveCount(0, { timeout: 12_000 });
  });
});

test.describe('une carte en 3D', () => {
  test.slow();
  test.beforeEach(async ({ page }, info) => {
    if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('les astuces d’une première fois ne couvrent aucune commande : la Carte vide (et ses observations autour), la Disposition', async ({ app, page }) => {
    await answerObservations(page, { inat: 8, gbif: 2 });
    await preset(page, { 'geoflora.maps3d': JSON.stringify({ renderer: '3d', buildings: false, hillshade: false, sky: false, pitch: 30 }) });
    await app.open('#/map');
    const map = carte(page);
    await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 60_000 });
    await expect(page.locator('gf-map-page .hint-once')).toContainText('Aucun lieu enregistré.');
    await expect(map.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
    await map.getByRole('button', { name: 'Observations autour', exact: true }).click();
    await expect(map.locator('.gf-o3-chip')).toBeVisible({ timeout: 30_000 });
    expect(await coveredControls(page)).toEqual([]);
    await map.locator('.gf-o3-chip').click();
    await expect(map.locator('.gf-o3-panel')).toBeVisible();

    await app.go('#/layout/[map,search]');
    const cell = page.locator('dl-map').first();
    await expect(cell.locator('gf-map')).toHaveAttribute('data-renderer', '3d', { timeout: 60_000 });
    await expect(cell.locator('.hint-once')).toContainText('Appui long sur la carte, puis « Confirmer » : la zone s’y centre.');
    await expect(cell.locator('.maplibregl-ctrl-fullscreen')).toBeVisible();
    expect(await coveredControls(page)).toEqual([]);
  });

  test('chargement lent, relief injoignable, édition, observations autour : jamais de pastille ni de note sur la carte — l’État et la zone d’annonce', async ({ app, page }) => {
    await answerTiles(page, { dem: 'fail' });
    await answerObservations(page, { inat: 20, gbif: 6 });
    await preset(page, { 'geoflora.maps3d': JSON.stringify({ renderer: '3d', buildings: false, hillshade: false, sky: false, pitch: 30 }), 'geoflora.hints': HINTS_SEEN });
    await page.route(/\/vendor\/maplibre\/maplibre-gl\.mjs/, async route => { await new Promise(r => setTimeout(r, 1500)); return route.fallback(); });
    await app.open('#/collections');
    const spot = await seedParis(page);
    await app.go(`#/map?spot=${spot}`);
    const map = carte(page);
    // Loading: the thin line past 400 ms, « Chargement de la 3D » said — no pill.
    await expect(map).toHaveAttribute('busy', '', { timeout: 5000 });
    await expect(mapSaid(map)).toContainText('Chargement de la 3D');
    await quiet(page);
    await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 60_000 });
    await expect(map).not.toHaveAttribute('busy', '');
    // The relief unreachable: flat, its state.
    await expect.poll(() => mapState(map), { timeout: 40_000 }).toContain('Relief injoignable : vue à plat.');
    await expect(mapSaid(map)).toContainText('Relief injoignable : vue à plat.');
    // The pointer over the map: no altitude pill.
    const box = await map.boundingBox();
    if (box) { await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6); await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.65); }
    await expect(map.locator('.gf-gl-note, .gf-gl-alt')).toHaveCount(0);
    await quiet(page, ['.panel']);
    const panel = await openPanel(map);
    await expect(panel.locator('.state')).toContainText('Relief injoignable : vue à plat.');
    await panel.getByRole('button', { name: 'Fermer', exact: true }).click();

    // Editing: 2D for the time of it — its state, said; nothing over the map.
    await map.getByRole('button', { name: 'Modifier les positions' }).click();
    await expect(map).toHaveAttribute('data-renderer', '2d');
    await expect.poll(() => mapState(map)).toContain('Modification des positions : carte en 2D le temps de l’édition.');
    await quiet(page, ['.panel']);
    await map.locator('.gf-map-editbar').getByRole('button', { name: 'Terminé' }).click();
    await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 60_000 });
    await expect.poll(() => mapState(map)).not.toContain('Modification des positions : carte en 2D le temps de l’édition.');

    // The observations around: the chip (radius; count in its name), no radius pill on the ground.
    await map.getByRole('button', { name: 'Observations autour', exact: true }).click();
    const chip = map.locator('.gf-o3-chip');
    await expect(chip).toHaveAttribute('aria-label', /observations?\. Régler$/, { timeout: 30_000 });
    await expect(map.locator('.gf-o3-rlabel, .gf-o3-chip .gf-o3-n')).toHaveCount(0);
    await expect(mapSaid(map)).toContainText('Observations autour :');
    await quiet(page, ['.panel']);
  });
});
