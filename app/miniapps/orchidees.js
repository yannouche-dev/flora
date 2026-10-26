// @ts-check
// Les orchidées de la colline de Mirabel: every orchid observed on the colline de Mirabel, at Ménétrol (Puy-de-Dôme:
// its Espace naturel sensible, its « sentier des orchidées »), on a map — iNaturalist's and GBIF's observations of the
// family Orchidaceae alone, all those they give (those whose point may not be where the orchid was — obscured, or
// rougher than the circle — drawn with their margin; the plants grown too: each source, the plants grown and the
// approximate positions a choice of the map's « Sur cette carte », kept), within 500 m of the hill at first (the other
// radii of the app's slider offered; a long press on the map centres the circle elsewhere, « Revenir à la colline »
// brings it back) —,
// light filters (genus, protection and statuses, a name) on the map and the list together, and the orchids found; an
// observation touched, on the map or in the list, opens its plant's simple sheet: its « Médias » and its rubric
// « L'essentiel » (kit/ma-plant-sheet.js `simple`), beside the map on a wide screen. No position asked, nothing of
// the app changed (no mode, no sheet layout).
// Built from the kit (app/miniapp/kit): its start screen (below, drawn by the box), then the map, its filters and its
// list (ma-orchids; what is pure about them: kit/orchids.js). Départ › Carte, each one an address
// (#/app/orchidees/map?p=<plant>&m=<image>); an address with a plant and no step opens the map, its sheet over it;
// with the start named, the start screen, the same simple sheet over it (plantSheet).
// Owns — everything « Recommencer » empties: its state (geoflora.app.orchidees.state: the circle's centre
// and radius, the filters and the choices of « Sur cette carte », the step it was left at) and layout
// (runtime.js#replay), the width of a plant's
// sheet beside the map (geoflora.app.orchidees.sheet). Shares: nothing of the user's but the settings (its modules,
// « Photos en ligne »); the answers of the online services kept in cache.

import { moduleOn } from '../core/modules.js';
import { speciesOf } from '../core/nearby.js';
import { SOURCES, SOURCE_NAMES, failedText, zoneObservations } from '../core/observations.js';
import { getPlants } from '../core/plants.js';
import { whenReady } from '../core/store.js';
import { territoryAt } from '../core/territory.js';
import { defineMiniApp } from '../miniapp/define.js';
import { ORCHIDACEAE, RADIUS, SITE, asked, filterOrchids, gatherOrchids, markVague, orchidFilters } from '../miniapp/kit/orchids.js';

/** iNaturalist's observations asked at most (five pages of 200), GBIF giving its page of 300. */
const MAX = 1000;
/** Each source's module (Réglages › Modules). */
const MODULES = /** @type {const} */ ({ inat: 'inaturalist', gbif: 'gbif' });

/**
 * The orchids observed in the circle: the observations of the sources chosen (core/observations.js, the family alone;
 * the plants grown unless unticked; those whose point may not be where the plant was marked, or left out and counted
 * when unticked), their plants in the flora (read once it is stored: core/nearby.js matches names to it), what
 * protects each one where the circle is (the bundled outlines: core/territory.js), gathered (kit/orchids.js). No
 * source answering: said (its module off, offline, not answering), never thrown — the screen says it, with
 * « Réessayer » (offline: asked again as the connection comes back).
 * @param {import('../miniapp/runtime.js').MiniApp} app @param {ReturnType<typeof asked>} what (kit/orchids.js asked)
 * @param {AbortSignal} signal @returns {Promise<import('../miniapp/kit/orchids.js').Found>}
 */
async function orchidsAround(app, what, signal) {
  const [point, radius, , sources, cultivated, approximate] = what;
  const key = JSON.stringify(what);
  await whenReady();
  try {
    const found = await zoneObservations(point, radius, { filters: orchidFilters(sources, cultivated), taxon: ORCHIDACEAE, precise: !approximate, max: MAX, signal });
    const points = approximate ? markVague(found.points, radius) : found.points;
    const [{ list, plantOf }, territory] = await Promise.all([speciesOf(points), territoryAt(point).catch(() => null)]);
    const ids = /** @type {number[]} */ (list.map(s => s.plantId).filter(id => id != null));
    const records = new Map((await getPlants(ids).catch(() => [])).map(r => [r.id, r]));
    const gathered = gatherOrchids(points, list, plantOf, records, territory);
    return { key, ...gathered, failed: found.failed, totals: found.totals, vague: gathered.points.filter(p => p.approx).length, hidden: found.vague ?? 0, error: null };
  } catch (error) {
    if (signal.aborted || /** @type {any} */ (error)?.name === 'AbortError') throw error;
    /** @type {import('../core/observations.js').ObsFailure[]} */
    const failed = /** @type {any} */ (error)?.failed ?? sources.map(s => ({ name: SOURCE_NAMES[s], off: false }));
    const off = failed.every(f => f.off), offline = !off && !navigator.onLine;
    // The sources chosen switched off, another one on but unticked (« Sur cette carte », kept): said where to tick it.
    const other = SOURCES.filter(s => !sources.includes(s) && moduleOn(MODULES[s])).map(s => SOURCE_NAMES[s]);
    const text = off ? `${failedText(failed)} (Réglages › Modules) : ${other.length ? `cochez ${other.join(' et ')} (▦ › Sur cette carte) pour voir ses observations` : 'aucune observation à montrer'}.`
      : offline ? `Hors ligne : les observations ${sources.map(x => x === 'inat' ? 'd’iNaturalist' : 'de GBIF').join(' et ')} viendront avec la connexion.`
      : `${failedText(failed)} : les observations ne sont pas disponibles pour le moment.`;
    return { key, points: [], orchids: [], failed, totals: { inat: null, gbif: null }, vague: 0, hidden: 0, error: { text, retry: !off, offline } };
  }
}

/**
 * The first screen: « Commencer », to the map; both sources switched off, said in place of an error, the action off.
 * The link at the bottom: the other activities (Découvrir over it).
 * @param {any} c @param {import('../miniapp/runtime.js').MiniApp} app @returns {import('../components/start-screen.js').StartSpec}
 */
function start(c, app) {
  const off = !moduleOn('inaturalist') && !moduleOn('gbif');
  return {
    id: 'orchidees',
    art: 'orchids',
    title: 'Les orchidées de la colline de Mirabel',
    lead: 'À Ménétrol (Puy-de-Dôme), toutes les orchidées observées, sur la carte ; touchez-en une : ses photos et l’essentiel.',
    primary: { icon: 'flower2', label: 'Commencer', disabled: off, run: () => { app.go('map'); } },
    error: off ? '« iNaturalist » et « GBIF » sont désactivés dans Réglages › Modules : Orchidées de Mirabel en a besoin.' : null,
    note: 'Observations d’iNaturalist et de GBIF ; votre position n’est pas demandée.',
    exit: { icon: 'camera-reels', label: 'Autres activités', run: () => { app.scenarios(); } }
  };
}

export default defineMiniApp({
  id: 'orchidees',
  title: 'Orchidées de Mirabel',
  icon: 'flower2',
  scene: 'orchids',
  pitch: 'Les orchidées observées sur la colline de Mirabel, à Ménétrol : sur la carte, et la fiche de chacune d’un toucher.',
  exit: { label: 'Quitter l’activité' },
  owns: { keys: ['geoflora.app.orchidees.sheet'], label: 'le cercle et les filtres choisis' },
  shared: ['réglages'],
  context: {
    // The circle: its centre (the hill, or where a long press put it) and its radius (the slider's stops), kept.
    point: { init: SITE, persist: true },
    radius: { init: RADIUS, persist: true, min: 200, max: 50000 },
    // The filters chosen (kit/orchids.js filterOrchids), kept: the genera, the protection and statuses, a name.
    genera: { init: [], persist: true },
    marks: { init: [], persist: true },
    query: { init: '', persist: true },
    // « Sur cette carte » (its map's panel ▦), kept: the sources asked, the plants grown, the approximate positions —
    // all of them at first (kit/orchids.js asked).
    sources: { init: ['inat', 'gbif'], persist: true },
    cultivated: { init: true, persist: true },
    approximate: { init: true, persist: true },
    // « Réessayer »: the circle asked again.
    retry: { init: 0 },
    // What the sources gave for the circle (orchidsAround), asked again as the circle changes.
    obs: { init: null },
    // A plant's sheet open (?p=), and the image its « Médias » show (&m=).
    focus: { init: null },
    mediaAt: { init: null }
  },
  derive: { shown: c => c.obs ? filterOrchids(c.obs, c) : null },
  // A link to a plant (?p=, no step): the map and its simple sheet, not the start screen.
  resumeAt: c => typeof c.focus === 'number' ? 'map' : null,
  // A plant over the start screen (« Départ » with its sheet open, a link naming the start): its simple sheet too.
  plantSheet: { simple: true },
  data: { obs: { key: asked, load: orchidsAround, debounce: 250, into: 'obs' } },
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Orchidées' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'La colline de Mirabel', next: 'map', start: (c, app) => start(c, app) },
    { id: 'map', label: 'Carte', about: 'Les orchidées observées', add: [{ id: 'orchids', use: 'orchids', col: 'main', title: 'Orchidées' }] }
  ]
});
