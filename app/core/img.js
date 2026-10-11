// @ts-check
// Images that fail to load: never the browser's broken-image sign. A thumbnail keeps its box (the placeholder
// behind it shows); a photo in a figure goes with its credit.

/** The image hidden, its box kept. @param {Event} e */
export function hideImg(e) {
  /** @type {HTMLElement} */ (e.target).style.visibility = 'hidden';
}

/** The figure (photo and credit) taken away. @param {Event} e */
export function dropFigure(e) {
  const img = /** @type {HTMLElement} */ (e.target);
  /** @type {HTMLElement} */ (img.closest('figure') || img).style.display = 'none';
}

/** Shown again: the same element reused for another image that loads (lists rendered again). @param {Event} e */
export function showImg(e) {
  const img = /** @type {HTMLElement} */ (e.target);
  img.style.removeProperty('visibility');
  /** @type {HTMLElement | null} */ (img.closest('figure'))?.style.removeProperty('display');
}
