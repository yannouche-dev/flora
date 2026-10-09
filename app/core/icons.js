// @ts-check
// Icons: Bootstrap Icons (https://icons.getbootstrap.com, MIT; plus a crown drawn for the app), from one sprite of the ones the app uses
// (assets/icons/bi.svg, built by scripts/build-icons.mjs, precached). Drawn in currentColor, 1em square,
// so they take the size and colour of the text around them. Decorative: the control carries the label.

import { html } from 'lit';

const SPRITE = new URL('../../assets/icons/bi.svg', import.meta.url).href;

/**
 * @typedef {'arrow-counterclockwise' | 'arrow-left' | 'arrow-right' | 'arrows-angle-expand' | 'arrows-collapse' | 'caret-down-fill' | 'caret-up-fill'
 *   | 'check-lg' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'collection' | 'collection-fill' | 'crosshair' | 'crown' | 'download' | 'exclamation-octagon-fill' | 'exclamation-triangle-fill' | 'flower1'
 *   | 'funnel' | 'funnel-fill' | 'gear' | 'gear-fill' | 'geo-alt-fill' | 'globe-europe-africa' | 'grip-vertical' | 'heart' | 'heart-fill' | 'image' | 'layers'
 *   | 'leaf' | 'leaf-fill' | 'list-nested' | 'list-ul' | 'map' | 'map-fill' | 'mic' | 'mic-fill' | 'pencil' | 'plus-lg' | 'search' | 'share' | 'shield-check' | 'star' | 'star-fill' | 'table'
 *   | 'three-dots' | 'trash3' | 'triangle' | 'type-h2' | 'upload' | 'x' | 'x-lg'} IconName
 */

/** An icon in a Lit template. @param {IconName} name */
export const icon = name => html`<svg class="bi" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><use href="${SPRITE}#${name}"></use></svg>`;

/** The same icon as markup, for DOM built by hand (Leaflet markers and controls). @param {IconName} name */
export const iconMarkup = name => `<svg class="bi" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><use href="${SPRITE}#${name}"></use></svg>`;

/** The sprite symbol URL, for an SVG built by hand (`<use href>`). @param {IconName} name */
export const iconHref = name => `${SPRITE}#${name}`;

/** What a collection is: favorites, list or place. @param {string} kind */
export const kindIcon = kind => icon(kind === 'favorites' ? 'heart-fill' : kind === 'place' ? 'geo-alt-fill' : 'list-ul');

/** Display modes: Épuré (photo), Standard (list), Scientifique (table). */
export const MODE_ICONS = { epure: icon('image'), standard: icon('list-ul'), scientific: icon('table') };
