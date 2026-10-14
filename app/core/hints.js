// @ts-check
// First-use hints (the quiet-map rule, gf-map.js): a gesture worth knowing on a map — « appui long : … », « touchez
// encore pour ouvrir l’observation », how to start on an empty Carte — is shown once per device: the first screen
// that has it keeps it until it is dismissed (its ✕) or left, and it never comes back (geoflora.hints: the hints
// seen). Elsewhere the same words stay where they are always found: the controls' own title and aria.
//   takeHint(id) → true the first time ever (marked seen at once); hintView(text, close) → the hint's markup (ui.js
//   styles .hint-once; map.css the same in a map's own light DOM).

import { html } from 'lit';
import { config } from '../config.js';
import { icon } from './icons.js';

/** @returns {Set<string>} */
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKeys.hints) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}

let seen = read();

function write() {
  try { localStorage.setItem(config.storageKeys.hints, JSON.stringify([...seen])); } catch { /* this visit only */ }
}

/** True the first time ever this hint is asked for on this device — it is marked seen at once. @param {string} id */
export function takeHint(id) {
  if (seen.has(id)) return false;
  seen.add(id);
  write();
  return true;
}

/** Every hint shown again (Réglages › « Recommencer la découverte »). */
export function forgetHints() {
  seen = new Set();
  write();
}

/**
 * A hint's markup: its words and its ✕ (« Masquer l’astuce »).
 * @param {unknown} text @param {() => void} close @param {string} [cls] its own class too (where it sits)
 */
export function hintView(text, close, cls = '') {
  return html`<p class="hint-once ${cls}"><span>${text}</span><button type="button" class="hint-x" aria-label="Masquer l’astuce" title="Masquer l’astuce"
    @click=${close}>${icon('x-lg')}</button></p>`;
}
