// @ts-check
// The 3D maps' options as a form (core/map-settings.js): Réglages › Cartes and the « Carte » panel of each map show the
// same one. `change` gets the settings changed ({ relief: false }…); the caller stores them (setMapSettings).

import { css, html, nothing } from 'lit';
import { LIMITS, formatHour } from '../core/map-settings.js';

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
