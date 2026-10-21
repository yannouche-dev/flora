// @ts-check
// The maps' 2D / 3D choice and the 3D options, as forms (core/map-settings.js), for the maps' options
// (gf-map-options.js: the panel ▦ of every map and Réglages › Cartes show the same ones, on the same settings — one
// choice for every map). `change` gets the settings changed ({ renderer: '3d' }, { relief: false }…); the caller
// stores them (setMapSettings).
//   mapRendererChoice(s, change, o) → the 2D / 3D radios (and why a map cannot change: WebGL2 missing, a map that
//   always stays in 2D or in 3D); map3dOptions(s, change, o) → the 3D options.

import { css, html, nothing } from 'lit';
import { LIMITS, formatHour } from '../core/map-settings.js';

/** Why a map stays in 2D whatever the choice: one WebGL map per plant sheet (gf-map-gl.js, the attribute map-3d-why). */
export const ONE_GL_PER_SHEET = 'Une seule carte en 3D par fiche plante : la carte principale suit le choix, les autres cartes de la fiche restent en 2D.';

/**
 * « 2D » or « 3D », for every map. `fixed`: this map is always drawn one way ({ renderer, why }: the « Jusqu’où part
 * l’expédition ? » step from above, a second map of a plant sheet, a « Vue 3D »): the choice is shown, disabled, with
 * why. Without WebGL2, 3D cannot be chosen (unless it already is: back to 2D stays possible).
 * @param {import('../core/map-settings.js').MapSettings} s
 * @param {(patch: Partial<import('../core/map-settings.js').MapSettings>) => void} change
 * @param {{ id: string, legend: string, webgl: boolean, fixed?: { renderer: '2d' | '3d', why: string } | null }} o
 */
export function mapRendererChoice(s, change, o) {
  const fixed = o.fixed || null;
  const shown = fixed ? fixed.renderer : s.renderer;
  const radio = (/** @type {'2d' | '3d'} */ value, /** @type {string} */ label, /** @type {string} */ hint) => html`
    <label><input type="radio" name=${o.id + '-renderer'} value=${value} .checked=${shown === value}
      ?disabled=${Boolean(fixed) || (value === '3d' && !o.webgl && s.renderer !== '3d')}
      @change=${() => change({ renderer: value })} /> ${label} <small class="muted">(${hint})</small></label>`;
  return html`<fieldset class="renderer-choice">
      <legend>${o.legend}</legend>
      ${radio('2d', '2D', 'vue de dessus, la plus légère')}
      ${radio('3d', '3D', 'relief, inclinaison, rotation, bâtiments, ciel')}
    </fieldset>
    ${fixed ? html`<p class="note3d" role="status">${fixed.why}</p>`
      : o.webgl ? nothing : html`<p class="note3d" role="status">Cet appareil n’affiche pas la 3D (WebGL2 requis) : les cartes restent en 2D.</p>`}`;
}

/**
 * @param {import('../core/map-settings.js').MapSettings} s
 * @param {(patch: Partial<import('../core/map-settings.js').MapSettings>) => void} change
 * @param {{ relief: boolean, ign: boolean, id: string }} o the modules « Vue 3D (relief) » and « IGN – fonds de carte » on; a prefix for the ids
 */
export function map3dOptions(s, change, o) {
  const [eMin, eMax, eStep] = LIMITS.exaggeration, [pMin, pMax, pStep] = LIMITS.pitch, [hMin, hMax, hStep] = LIMITS.hour;
  const id = (/** @type {string} */ k) => o.id + '-' + k;
  const check = (/** @type {keyof import('../core/map-settings.js').MapSettings} */ key, /** @type {string} */ label, /** @type {string} */ hint, disabled = false) => html`
    <label class="opt3d switch"><input type="checkbox" .checked=${Boolean(s[key])} ?disabled=${disabled}
      @change=${(/** @type {any} */ e) => change({ [key]: e.target.checked })} /><span>${label}${hint ? html`<small>${hint}</small>` : nothing}</span></label>`;
  const range = (/** @type {'exaggeration' | 'pitch' | 'hour'} */ key, /** @type {string} */ label, /** @type {number[]} */ [min, max, step], /** @type {string} */ shown, disabled = false) => html`
    <div class="opt3d range"><label for=${id(key)}>${label}</label>
      <input id=${id(key)} type="range" min=${min} max=${max} step=${step} .value=${String(s[key])} ?disabled=${disabled}
        aria-valuetext=${shown} @change=${(/** @type {any} */ e) => change({ [key]: Number(e.target.value) })} />
      <output for=${id(key)}>${shown}</output></div>`;
  return html`<div class="opts3d">
    ${check('relief', 'Relief', o.relief ? 'le terrain en volume (tuiles AWS Terrain Tiles)' : 'module « Vue 3D (relief) » désactivé dans Réglages › Modules', !o.relief)}
    ${range('exaggeration', 'Exagération du relief', [eMin, eMax, eStep], '× ' + s.exaggeration.toLocaleString('fr-FR'), !s.relief || !o.relief)}
    ${check('hillshade', 'Ombrage du relief', 'les pentes ombrées sous les couches', !s.relief || !o.relief)}
    ${range('pitch', 'Inclinaison à l’ouverture', [pMin, pMax, pStep], s.pitch + '°')}
    ${check('buildings', 'Bâtiments en 3D', o.ign ? 'IGN, BD TOPO, à partir du zoom 15' : 'module « IGN – fonds de carte » désactivé', !o.ign)}
    ${check('sky', 'Ciel et brume', 'l’horizon, l’atmosphère au loin', false)}
    ${check('globe', 'Globe à petite échelle', 'la Terre ronde en dézoomant', false)}
    <label class="opt3d switch"><input type="checkbox" .checked=${s.plan === 'vector'} ?disabled=${!o.ign}
      @change=${(/** @type {any} */ e) => change({ plan: e.target.checked ? 'vector' : 'raster' })} />
      <span>Plan IGN vectoriel<small>des noms et des traits plus nets (fond « Plan IGN »)</small></span></label>
    <fieldset class="opt3d light"><legend>Éclairage</legend>
      ${(/** @type {const} */ ([['fixed', 'Fixe'], ['now', 'Soleil de maintenant'], ['hour', 'Soleil à l’heure choisie']])).map(([k, label]) => html`
        <label><input type="radio" name=${id('light')} value=${k} .checked=${s.light === k} @change=${() => change({ light: k })} /> ${label}</label>`)}
      ${s.light === 'hour' ? range('hour', 'Heure', [hMin, hMax, hStep], formatHour(s.hour)) : nothing}
    </fieldset>
  </div>`;
}

/** Their styles (in a shadow root with the app's `ui`). */
export const map3dOptionsCss = css`
  .renderer-choice { display: grid; gap: 6px; margin: 4px 0; padding: 10px 14px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); }
  .renderer-choice legend { padding: 0 4px; font-weight: 600; }
  .renderer-choice label { display: flex; align-items: center; gap: 8px; min-height: 32px; cursor: pointer; }
  .renderer-choice input { accent-color: var(--gf-accent); }
  .renderer-choice :disabled, .renderer-choice label:has(:disabled) { cursor: default; }
  .renderer-choice label:has(:disabled) { opacity: 0.6; }
  .note3d { margin: 2px 4px 4px; font-size: 0.85rem; color: var(--gf-text-muted); }
  details.more3d { border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); padding: 4px 10px; }
  details.more3d summary { cursor: pointer; min-height: 32px; display: flex; align-items: center; font-weight: 600; }
  details.more3d[open] summary { margin-bottom: 4px; }
  .opts3d { display: grid; gap: 6px; }
  .opts3d input { accent-color: var(--gf-accent); }
  .opt3d.switch { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 4px 0; }
  .opt3d.switch input { flex: none; margin-top: 3px; }
  .opt3d.switch span { display: grid; }
  .opt3d small { color: var(--gf-text-muted); font-size: 0.8rem; }
  .opt3d.range { display: grid; grid-template-columns: minmax(120px, max-content) 1fr 4.5em; align-items: center; gap: 8px; }
  .opt3d.range input { width: 100%; }
  .opt3d.range output { font-variant-numeric: tabular-nums; text-align: right; font-size: 0.9rem; }
  .opt3d.light { display: grid; gap: 4px; margin: 4px 0 0; padding: 6px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); }
  .opt3d.light legend { padding: 0 4px; font-weight: 600; }
  .opt3d.light label { display: flex; align-items: center; gap: 8px; min-height: 28px; }
  .opt3d :disabled + span, .opt3d.range:has(:disabled) { opacity: 0.6; }
`;
