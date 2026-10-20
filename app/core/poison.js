// @ts-check
// What to do after eating a plant: the Centres antipoison (their official list) and the emergency numbers, one line
// (`.sos`) wherever a confusion or a toxicity is shown — the look-alikes (gf-lookalikes), the plant sheet, quick
// capture, the mini-apps' lists and Faux amis. Kept out of core/lookalikes.js, which stays free of lit (tested under
// Node, imported widely). The `.sos` class is what a mini-app keeps as a link (miniapp/quiet-links.js).

import { html } from 'lit';

/** The official list of the Centres antipoison (each with its phone number). */
const POISON_CENTRES = 'https://centres-antipoison.net/';

/**
 * What to do after eating a plant, wherever a confusion or a toxicity is shown (no full stop: a sentence ends it).
 * The numbers work offline.
 */
export const emergency = () => html`<span class="sos">Centre antipoison : <a href=${POISON_CENTRES} target="_blank" rel="noopener">centres-antipoison.net</a> (liste officielle) · <a href="tel:15">15</a> ou <a href="tel:112">112</a> en cas de détresse vitale</span>`;
