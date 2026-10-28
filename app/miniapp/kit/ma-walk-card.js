// @ts-check
// The walk under way, small, at the top of its column: its name in full (on two lines at most), always editable and
// kept as it is typed (Échap brings back the one before); what it counts and my position; two discreet icons,
// « Partager » (once it has a plant, as on its recap: never where the walker stands alone; its position asked first)
// and « Terminer » (a walk is not ended by mistake). A plant touched (in the list or on the map): its
// name, « Ajouter ici » under the thumb (once more, where I stand) and ✕ (the occurrence touched on the map, else
// its last) — the game does it (kit/trail-session.js).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../../core/icons.js';
import { entriesOf } from '../../core/collections.js';
import { ui } from '../../styles/ui.js';
import { countOf } from './trail-store.js';
import { addPin, addPinStyles } from './ma-walk-search.js';
import { SessionWatch } from './watch.js';
import '../../components/gf-thumb.js';

export class MaWalkCard extends LitElement {
  static properties = {
    /** The game (kit/trail-session.js). */
    session: { attribute: false }
  };

  static styles = [ui, addPinStyles, css`
    :host { display: block; }
    /* The walk, compact: its name and its two actions on one line, what it counts and the position under it. */
    .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 8px; align-items: center; padding: 6px 6px 6px 10px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .card .pin { grid-row: 1 / 3; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 0.85rem; }
    /* The name, whole (the card's width, on two lines at most); a touch on it or on the pencil edits it, in the field laid over it. */
    .card .title { grid-column: 2; grid-row: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px; min-width: 0; border-radius: 8px; padding: 2px 3px 2px 6px; margin-left: -6px; cursor: text; }
    .card .title:hover, .card .title:focus-within { background: var(--gf-surface-2); }
    .card .title:focus-within { box-shadow: inset 0 -2px 0 var(--gf-accent); }
    .card .shown, .card .name { grid-area: 1 / 1; font: inherit; font-weight: 700; font-size: 0.98rem; line-height: 1.25; color: var(--gf-text); }
    .card .shown { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; padding: 2px 0; }
    .card .name { min-width: 0; border: 0; background: none; padding: 2px 0; outline: none; text-overflow: ellipsis; opacity: 0; }
    .card .title:focus-within .shown { visibility: hidden; }
    .card .title:focus-within .name { opacity: 1; }
    .card .name:focus, .card .name:focus-visible { box-shadow: none; }
    .card .title .bi { color: var(--gf-text-muted); font-size: 0.85rem; flex: none; }
    .card .meta { grid-column: 2 / 4; grid-row: 2; font-size: 0.76rem; line-height: 1.3; color: var(--gf-text-muted); display: flex; gap: 0 8px; flex-wrap: wrap; padding-bottom: 2px; }
    .card .meta .gps.off { color: var(--gf-warn); }
    /* On the line under the name, two discreet icons: Partager, Terminer (a walk is not ended by mistake). */
    .card .acts { grid-column: 3; grid-row: 1; justify-self: end; position: relative; z-index: 1; display: flex; align-items: center; gap: 0; margin: 0 -6px 0 -8px; }
    /* 44 px under the finger, yet the line kept low and the name its room: the buttons reach into the gap and the
       card's edge. */
    .card .acts button { width: 44px; height: 44px; margin: -6px 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none;
      color: var(--gf-text-muted); font-size: 0.9rem; cursor: pointer; }
    .card .acts button:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .card .acts button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* The plant touched, in the head: « Ajouter ici » under the thumb, ✕ beside it. */
    .card .picked { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--gf-border); }
    .card .picked b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.92rem; }
    .card .picked .n { font-size: 0.75rem; font-weight: 700; color: var(--gf-accent); }
    .card .picked .here { flex: none; width: 44px; height: 44px; min-height: 0; padding: 0; border-radius: 50%; display: grid; place-items: center; }
    .card .picked .drop { flex: none; }
    .here .addpin { font-size: 1.05rem; }
  `];

  constructor() {
    super();
    /** @type {import('./trail-session.js').TrailSession | null} */
    this.session = null;
  }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.session);

  /** The name before this edit (Échap brings it back). */
  #nameBefore = '';

  render() {
    const s = this.session, t = s?.trail;
    if (!s || !t) return nothing;
    const gps = s.fix ? `Position ±${Math.round(s.fix.accuracy)} m` : s.geoError ? 'Position introuvable : les plantes vont au point du parcours' : 'Recherche de votre position…';
    return html`<div class="card" aria-label="Le parcours">
      <span class="pin" aria-hidden="true">${icon('geo-alt-fill')}</span>
      <label class="title" title="Renommer le parcours">
        <span class="shown" aria-hidden="true">${t.properties.name}</span>
        <input class="name" .value=${t.properties.name} aria-label="Nom du parcours" maxlength="80" enterkeyhint="done" autocomplete="off"
          @focus=${() => { this.#nameBefore = t.properties.name; s.editingName = true; }}
          @input=${(/** @type {any} */ e) => s.typeName(e.target.value)}
          @keydown=${(/** @type {KeyboardEvent} */ e) => { const i = /** @type {HTMLInputElement} */ (e.target);
            if (e.key === 'Enter') i.blur();
            if (e.key === 'Escape') { i.value = this.#nameBefore || t.properties.name; s.rename(i.value); i.blur(); } }}
          @change=${(/** @type {any} */ e) => s.rename(e.target.value)}
          @blur=${(/** @type {any} */ e) => { s.editingName = false; if (!e.target.value.trim()) e.target.value = s.trail?.properties.name || ''; }} />
        ${icon('pencil')}
      </label>
      <span class="acts">
        ${t.properties.plants.length ? html`<button class="share" type="button" aria-label="Partager le parcours" title="Partager le parcours : un lien avec sa carte et ses plantes" @click=${() => s.share()}>${icon('share')}</button>` : nothing}
        <button class="end" type="button" aria-label="Terminer le parcours" title="Terminer le parcours (il reste dans Mes plantes)" @click=${() => s.end()}>${icon('flag-fill')}</button>
      </span>
      <span class="meta"><span>${countOf(t)}</span><span class="gps ${s.fix ? '' : 'off'}">${gps}</span></span>
      ${this.#picked(t)}
    </div>`;
  }

  /**
   * In the head, the plant touched: « Ajouter ici » (once more, where I stand), and ✕ (the occurrence touched on the
   * map, else its last). @param {any} t
   */
  #picked(t) {
    const s = /** @type {import('./trail-session.js').TrailSession} */ (this.session);
    const entries = s.sel != null ? entriesOf(t, s.sel) : [];
    if (!entries.length) return nothing;
    const e = entries.find((/** @type {any} */ x) => x.id === s.selEntry) || entries[entries.length - 1];
    const name = e.vernacularName || e.scientificName;
    const which = entries.length > 1 ? (e.id === s.selEntry ? ' (celle touchée sur la carte)' : ' (la dernière)') : '';
    return html`<div class="picked">
      <gf-thumb plant-id=${e.plantId} size="30" round></gf-thumb>
      <b>${name}${entries.length > 1 ? html` <span class="n">× ${entries.length}</span>` : nothing}</b>
      <button class="primary here" type="button" ?disabled=${!s.fix} title=${s.fix ? 'Notée une fois de plus, là où vous êtes' : 'Position introuvable'}
        aria-label=${'Ajouter ' + name + ' ici'} @click=${() => s.add({ id: e.plantId, scientificName: e.scientificName, vernacularName: e.vernacularName })}>${addPin}</button>
      <button class="icon-btn drop" type="button" aria-label=${'Retirer ' + name + which + ' du parcours'} title=${'Retirer du parcours' + which} @click=${() => s.remove(e.id)}>${icon('x-lg')}</button>
    </div>`;
  }
}

customElements.define('ma-walk-card', MaWalkCard);
