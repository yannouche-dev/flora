// @ts-check
// « Mes écrans » drawn (screens.js): each screen kept, a link to it in use — its title (or, untitled, its cells' names)
// and its layout as written — and × to take it out of the list (the focus kept in the list: the next one's ×, else the
// one before). The home of screens of one's own (gf-layout.js) and Réglages' card « Écran sur mesure » (gf-settings.js)
// show it, each redrawn on screenEvents' `change`; screenListStyles goes into their styles.
import { html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { forgetScreen } from './screens.js';

/** The look of the list (in the host's styles). */
export const screenListStyles = css`
  .screens { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 8px; }
  .screens li { display: flex; align-items: center; gap: 2px; min-width: 0; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
  .screens li:hover { border-color: var(--gf-accent); }
  .screens a { flex: 1; min-width: 0; display: grid; gap: 2px; padding: 8px 4px 8px 12px; text-decoration: none; color: var(--gf-text); border-radius: var(--gf-radius); }
  .screens a:focus-visible { outline: none; box-shadow: var(--gf-focus); }
  .screens b, .screens small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .screens small { color: var(--gf-text-muted); font-size: 0.8rem; }
  .screens .icon-btn { flex: none; font-size: 1rem; }
`;

/** A layout as its address writes it, its percent-encoding undone (as written). @param {string} href */
function layoutOf(href) {
  const spec = href.split('?')[0].replace('#/layout/', '');
  try { return decodeURIComponent(spec); } catch { return spec; }
}

/** × : the screen taken out; the focus stays in the list (the next one's ×, else the one before). @param {Event} e @param {string} href */
function forget(e, href) {
  const button = /** @type {HTMLElement} */ (e.currentTarget);
  const list = button.closest('ul'), at = [...(list?.children ?? [])].indexOf(/** @type {Element} */ (button.closest('li')));
  forgetScreen(href);
  const host = /** @type {any} */ (button.getRootNode()).host;
  Promise.resolve(host?.updateComplete).then(() => {
    const left = list?.isConnected ? list.querySelectorAll('[data-act="forget"]') : [];
    /** @type {HTMLElement | undefined} */ (left[Math.min(at, left.length - 1)])?.focus();
  });
}

/**
 * The screens kept, as a list of links. `labelledBy`: the id of its heading, where it has one (else named « Mes écrans »).
 * @param {import('./screens.js').Screen[]} list @param {string} [labelledBy]
 */
export function screenList(list, labelledBy) {
  return html`<ul class="screens" aria-labelledby=${labelledBy ?? nothing} aria-label=${labelledBy ? nothing : 'Mes écrans'}>${list.map(s => {
    const name = s.title ?? s.label;
    return html`<li><a href=${s.href}><b>${name}</b><small>${layoutOf(s.href)}</small></a>
      <button class="icon-btn" type="button" data-act="forget" aria-label=${`Retirer « ${name} » de Mes écrans`} title="Retirer de Mes écrans"
        @click=${(/** @type {Event} */ e) => forget(e, s.href)}>${icon('x-lg')}</button></li>`;
  })}</ul>`;
}
