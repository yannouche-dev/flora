// @ts-check
import { LitElement, html, css } from 'lit';
import { STATUS_LABELS, STATUS_SHORT } from '../config.js';
import { setFacet } from '../core/query.js';
import { genusFamily } from '../core/search.js';
import { SearchController } from '../core/search-channel.js';
import './gf-facet.js';

const STATUS_ORDER = ['P', 'E', 'S', 'C', 'I', 'J'];

/** Room the filters keep for a group's list besides its headers: lower, they do not stack (`compact`). */
const ROOM = 200;
/** A filter group's header (gf-facet --head-h). */
const HEAD = 40;

/**
 * All filter groups. Rendered as the desktop sidebar or inside the mobile bottom sheet. Before them, what is slotted
 * as `lead` (a free layout's « Observations de la zone »: layout/obs-filters.js), whose headers (`lead` of them) stack
 * first, the facets' after them. Their scrolling box too low for every header stacked and a list between them (a
 * layout's search cell): `compact`, the header of the group being read alone at the top (gf-facet --stacked).
 */
export class GfFilterPanel extends LitElement {
  static properties = {
    /** The search it filters (core/search-channel.js: a free layout's group); none: the app's. */
    channel: { attribute: false },
    /** The headers of the groups slotted before the facets (slot="lead"): the facets' stack after them. */
    lead: { type: Number }
  };

  static styles = css`
    :host { display: block; padding-bottom: 24px; }
    :host([compact]) { --stacked: 0; --head-bottom: auto; }
  `;

  #store = new SearchController(this);

  constructor() {
    super();
    /** @type {import('../core/search-channel.js').Channel | null} */
    this.channel = null;
    this.lead = 0;
    this.addEventListener('facet-change', event => {
      const { name, values } = /** @type {CustomEvent} */ (event).detail;
      setFacet(name, values, this.#store.channel);
    });
  }

  /** Its scrolling box, followed: its height says whether the headers stack. @type {Element | null} */
  #box = null;
  #resize = new ResizeObserver(() => this.#fit());

  connectedCallback() { super.connectedCallback(); this.updateComplete.then(() => this.#follow()); }
  disconnectedCallback() { super.disconnectedCallback(); this.#resize.disconnect(); this.#box = null; }
  updated() { this.#fit(); }

  /** Its scrolling box (across shadow roots: the sidebar, the sheet, a layout's cell), followed. */
  #follow() {
    /** @type {Node | null} */ let n = this;
    while ((n = /** @type {any} */ (n).assignedSlot || n.parentNode || /** @type {any} */ (n).host || null)) {
      if (n instanceof HTMLElement && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) break;
    }
    if (n === this.#box) return;
    this.#resize.disconnect();
    this.#box = /** @type {Element | null} */ (n);
    if (this.#box) this.#resize.observe(this.#box);
    this.#fit();
  }

  /** Every header stacked and a list between them, or the compact way (their box too low). */
  #fit() {
    const h = this.#box?.clientHeight ?? 0;
    const count = Number(this.style.getPropertyValue('--count')) || 1;
    this.toggleAttribute('compact', h > 0 && h < count * HEAD + ROOM);
  }

  render() {
    const { query: { filters }, results: { facets }, collections } = this.#store.state;
    const count = (/** @type {string} */ facet, /** @type {string} */ value) => facets[facet]?.[value] || 0;

    const families = [...new Set(genusFamily.values())];
    const genera = [...genusFamily.keys()]
      .filter(genus => !filters.family.length || filters.family.includes(genusFamily.get(genus) || ''));

    const mine = [
      ...collections.filter(c => c.kind === 'favorites').map(c => ({ value: c.id, label: 'Favoris', icon: 'heart-fill', count: count('mine', c.id) })),
      ...(collections.some(c => c.kind === 'place') ? [{ value: 'place', label: 'Dans un de mes lieux', icon: 'geo-alt-fill', count: count('mine', 'place') }] : []),
      ...collections.filter(c => c.kind === 'list').map(c => ({ value: c.id, label: c.name, icon: 'list-ul', count: count('mine', c.id) })),
      ...collections.filter(c => c.kind === 'place').map(c => ({ value: c.id, label: c.name, icon: 'geo-alt-fill', count: count('mine', c.id) }))
    ];

    // The number of headers (the facets', after those slotted before them): those still to come wait stacked at the
    // bottom (gf-facet).
    const lead = this.lead || 0;
    this.style.setProperty('--count', String(lead + (mine.length ? 7 : 6)));
    return html`<slot name="lead"></slot>
      <gf-facet name="family" stack=${lead} label="Famille" searchable limit="8" .selected=${filters.family}
        .options=${families.map(name => ({ value: name, label: name, count: count('family', name) }))}
      ></gf-facet>
      <gf-facet name="genus" stack=${lead + 1} label="Genre" searchable limit="8" hide-empty
        .selected=${filters.genus}
        .options=${genera.map(name => ({ value: name, label: name, count: count('genus', name) }))}
      ></gf-facet>
      <gf-facet name="status" stack=${lead + 2} label="Statut en France" .open=${filters.status.length > 0} .selected=${filters.status}
        .options=${STATUS_ORDER.map(code => ({ value: code, label: STATUS_SHORT[code], title: STATUS_LABELS[code] + ' (TAXREF ' + code + ')', count: count('status', code) }))}
      ></gf-facet>
      <gf-facet name="legal" stack=${lead + 3} label="Protection et menace" .open=${filters.legal.length > 0} .selected=${filters.legal}
        .options=${[
          { value: 'nationale', label: 'Protégée en France', title: 'Protection nationale (INPN)', count: count('legal', 'nationale') },
          { value: 'protegee', label: 'Protégée (France, région ou département)', title: 'Protection nationale, régionale ou départementale (INPN)', count: count('legal', 'protegee') },
          { value: 'reglementee', label: 'Cueillette réglementée', title: 'Cueillette réglementée en France métropolitaine : arrêté d’un département, ou espèce qu’un préfet peut réglementer (INPN) ; ni commerce (CITES) ni outre-mer', count: count('legal', 'reglementee') },
          { value: 'menacee', label: 'Menacée en France', title: 'Liste rouge nationale : quasi menacée à en danger critique (INPN)', count: count('legal', 'menacee') }
        ]}
      ></gf-facet>
      <gf-facet name="photo" stack=${lead + 4} label="Photo" .selected=${filters.photo}
        .options=${[
          { value: 'avec', label: 'Avec photo', count: count('photo', 'avec') },
          { value: 'sans', label: 'Sans photo', count: count('photo', 'sans') }
        ]}
      ></gf-facet>
      <gf-facet name="french" stack=${lead + 5} label="Nom français" .selected=${filters.french}
        .options=${[
          { value: 'avec', label: 'Avec nom français', count: count('french', 'avec') },
          { value: 'sans', label: 'Sans nom français', count: count('french', 'sans') }
        ]}
      ></gf-facet>
      ${mine.length ? html`<gf-facet name="mine" stack=${lead + 6} label="Mes plantes" limit="6" .selected=${filters.mine} .options=${mine}></gf-facet>` : ''}
    `;
  }
}

customElements.define('gf-filter-panel', GfFilterPanel);
