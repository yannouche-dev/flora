// app/core/map-settings.js: Réglages › Cartes — 2D or 3D, and the 3D options: always valid, only what differs stored,
// followed in the other tabs, counted as a setting by the first steps; the sun that lights the 3D maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A window, so core/sync.js listens to `storage` (another tab's writes) as in a browser: set before it loads.
/** @type {any} */ (globalThis).window ??= globalThis;
const { config } = await import('../../app/config.js');
const {
  LIMITS, MAP_DEFAULTS, cleanMapSettings, formatHour, lightMoment, mapSettings, mapSettingsDiff, mapSettingsEvents,
  resetMapSettings, setMapSettings, sunPosition
} = await import('../../app/core/map-settings.js');

const KEY = config.storageKeys.maps3d;

test('par défaut : 2D, et des options 3D raisonnables', () => {
  assert.equal(KEY, 'geoflora.maps3d');
  assert.deepEqual(cleanMapSettings(undefined), { ...MAP_DEFAULTS });
  assert.equal(MAP_DEFAULTS.renderer, '2d');
  assert.ok(Object.isFrozen(MAP_DEFAULTS));
});

test('tout ce qui est lu est rendu valide (fichier importé, autre version)', () => {
  const s = cleanMapSettings({ renderer: '4d', relief: 'oui', exaggeration: 9, pitch: -20, hour: 25.3, light: 'moon', plan: 'vector', globe: true, extra: 1 });
  assert.equal(s.renderer, '2d', 'une valeur inconnue revient au défaut');
  assert.equal(s.relief, true, 'pas un booléen : le défaut');
  assert.equal(s.exaggeration, LIMITS.exaggeration[1], 'borné au maximum');
  assert.equal(s.pitch, 0, 'borné au minimum');
  assert.equal(s.hour, 24);
  assert.equal(s.light, 'fixed');
  assert.equal(s.plan, 'vector');
  assert.equal(s.globe, true);
  assert.ok(!('extra' in s));
  // Steps: 5° of tilt, half hours, tenths of exaggeration; numbers given as text (a form) read too.
  assert.equal(cleanMapSettings({ pitch: 62 }).pitch, 60);
  assert.equal(cleanMapSettings({ hour: 14.3 }).hour, 14.5);
  assert.equal(cleanMapSettings({ exaggeration: '1.94' }).exaggeration, 1.9);
  assert.deepEqual(cleanMapSettings([1, 2]), { ...MAP_DEFAULTS });
  assert.deepEqual(cleanMapSettings('3d'), { ...MAP_DEFAULTS });
});

test('seul ce qui diffère des défauts est gardé ; rien du tout aux défauts', () => {
  localStorage.removeItem(KEY);
  /** @type {any[]} */
  const seen = [];
  const on = (/** @type {any} */ e) => seen.push(e.detail);
  mapSettingsEvents.addEventListener('change', on);
  setMapSettings({ renderer: '3d', buildings: false });
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY) || 'null'), { renderer: '3d', buildings: false });
  assert.equal(mapSettings().renderer, '3d');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].renderer, '3d');
  // From what is stored now: a choice made in another tab since is kept.
  localStorage.setItem(KEY, JSON.stringify({ renderer: '3d', buildings: false, globe: true }));
  setMapSettings({ pitch: 30 });
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY) || 'null'), { renderer: '3d', buildings: false, globe: true, pitch: 30 });
  assert.deepEqual(mapSettingsDiff(mapSettings()), { renderer: '3d', buildings: false, globe: true, pitch: 30 });
  resetMapSettings();
  assert.equal(localStorage.getItem(KEY), null, 'aux défauts : la clé disparaît');
  assert.deepEqual(mapSettings(), { ...MAP_DEFAULTS });
  mapSettingsEvents.removeEventListener('change', on);
});

test('changé dans un autre onglet : cet onglet suit (core/sync.js)', () => {
  localStorage.setItem(KEY, JSON.stringify({ renderer: '3d', sky: false }));
  let told = 0;
  const on = () => { told++; };
  mapSettingsEvents.addEventListener('change', on);
  // The `storage` event another tab's write fires here.
  const event = Object.assign(new Event('storage'), { key: KEY, storageArea: localStorage, newValue: localStorage.getItem(KEY) });
  dispatchEvent(event);
  assert.equal(told, 1);
  assert.equal(mapSettings().renderer, '3d');
  assert.equal(mapSettings().sky, false);
  mapSettingsEvents.removeEventListener('change', on);
  resetMapSettings();
});

test('les premiers pas le comptent comme un réglage (ni une disposition de volets, ni une clé écrite seule)', () => {
  assert.ok(!config.paneLayouts.includes(KEY));
  // Nothing written by merely reading the settings (a new visitor's maps never store it on their own).
  localStorage.removeItem(KEY);
  mapSettings();
  cleanMapSettings({});
  assert.equal(localStorage.getItem(KEY), null);
});

test('le soleil : au sud à midi solaire, haut en été, couché la nuit', () => {
  // Clermont-Ferrand, 21 June 2026, solar noon ≈ 12:00 UTC − 4 min × 3.08° ≈ 11:46 UTC.
  const noon = sunPosition(new Date(Date.UTC(2026, 5, 21, 11, 46)), 45.78, 3.08);
  assert.ok(Math.abs(noon.azimuth - 180) < 4, `plein sud (${noon.azimuth})`);
  assert.ok(Math.abs(noon.altitude - (90 - 45.78 + 23.44)) < 1.5, `haut (${noon.altitude})`);
  const winter = sunPosition(new Date(Date.UTC(2026, 11, 21, 11, 50)), 45.78, 3.08);
  assert.ok(Math.abs(winter.altitude - (90 - 45.78 - 23.44)) < 1.5, `bas en hiver (${winter.altitude})`);
  const morning = sunPosition(new Date(Date.UTC(2026, 5, 21, 6, 0)), 45.78, 3.08);
  assert.ok(morning.azimuth > 60 && morning.azimuth < 100, `à l’est le matin (${morning.azimuth})`);
  const night = sunPosition(new Date(Date.UTC(2026, 5, 21, 23, 0)), 45.78, 3.08);
  assert.ok(night.altitude < 0, 'sous l’horizon la nuit');
});

test('l’heure de l’éclairage : fixe, maintenant, ou aujourd’hui à l’heure de Paris', () => {
  const now = new Date(Date.UTC(2026, 6, 14, 9, 0));
  assert.equal(lightMoment({ ...MAP_DEFAULTS, light: 'fixed' }, now), null);
  assert.equal(lightMoment({ ...MAP_DEFAULTS, light: 'now' }, now), now);
  // Summer (UTC+2): 18 h 30 in Paris is 16:30 UTC.
  assert.equal(lightMoment({ ...MAP_DEFAULTS, light: 'hour', hour: 18.5 }, now)?.toISOString(), '2026-07-14T16:30:00.000Z');
  // Winter (UTC+1).
  assert.equal(lightMoment({ ...MAP_DEFAULTS, light: 'hour', hour: 8 }, new Date(Date.UTC(2026, 0, 10, 12)))?.toISOString(), '2026-01-10T07:00:00.000Z');
  assert.equal(formatHour(15), '15 h');
  assert.equal(formatHour(7.5), '7 h 30');
});
