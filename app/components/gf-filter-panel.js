// @ts-check
import { LitElement, html, css } from 'lit';
import { STATUS_LABELS, STATUS_SHORT } from '../config.js';
import { setFacet } from '../core/query.js';
import { genusFamily } from '../core/search.js';
import { StoreController } from '../core/store.js';
import './gf-facet.js';

const STATUS_ORDER = ['P', 'E', 'S', 'C', 'I', 'J'];

/** All filter groups. Rendered as the desktop sidebar or inside the mobile bottom sheet. */
export class GfFilterPanel extends LitElement {
  static styles = css`
    :host { display: block; }
  `;

  #store = new StoreController(this);

  constructor() {
    super();
    this.addEventListener('facet-change', event => {
      const { name, values } = /** @type {CustomEvent} */ (event).detail;
      setFacet(name, values);
    });
  }

  render() {
    const { query: { filters }, results: { facets }, collections } = this.#store.state;
    const count = (/** @type {string} */ facet, /** @type {string} */ value) => facets[facet]?.[value] || 0;

    const families = [...new Set(genusFamily.values())];
    const genera = [...genusFamily.keys()]
      .filter(genus => !filters.family.length || filters.family.includes(genusFamily.get(genus) || ''));

    const mine = [
      ...collections.filter(c => c.kind === 'favorites').map(c => ({ value: c.id, label: '♥ Favoris', count: count('mine', c.id) })),
      ...(collections.some(c => c.kind === 'place') ? [{ value: 'place', label: '📍 Dans un de mes lieux', count: count('mine', 'place') }] : []),
      ...collections.filter(c => c.kind === 'list').map(c => ({ value: c.id, label: c.name, count: count('mine', c.id) })),
      ...collections.filter(c => c.kind === 'place').map(c => ({ value: c.id, label: '📍 ' + c.name, count: count('mine', c.id) }))
    ];

    return html`
      <gf-facet name="family" label="Famille" searchable limit="8" .selected=${filters.family}
        .options=${families.map(name => ({ value: name, label: name, count: count('family', name) }))}
      ></gf-facet>
      <gf-facet name="genus" label="Genre" searchable limit="8" hide-empty
        .selected=${filters.genus}
        .options=${genera.map(name => ({ value: name, label: name, count: count('genus', name) }))}
      ></gf-facet>
      <gf-facet name="status" label="Statut en France" .open=${filters.status.length > 0} .selected=${filters.status}
        .options=${STATUS_ORDER.map(code => ({ value: code, label: STATUS_SHORT[code], title: STATUS_LABELS[code] + ' (TAXREF ' + code + ')', count: count('status', code) }))}
      ></gf-facet>
      <gf-facet name="legal" label="Protection et menace" .open=${filters.legal.length > 0} .selected=${filters.legal}
        .options=${[
          { value: 'nationale', label: 'Protégée en France', title: 'Protection nationale (INPN)', count: count('legal', 'nationale') },
          { value: 'protegee', label: 'Protégée (France, région ou département)', title: 'Protection nationale, régionale ou départementale (INPN)', count: count('legal', 'protegee') },
          { value: 'reglementee', label: 'Cueillette réglementée', title: 'Réglementation de la cueillette dans au moins un département (INPN)', count: count('legal', 'reglementee') },
          { value: 'menacee', label: 'Menacée en France', title: 'Liste rouge nationale : quasi menacée à en danger critique (INPN)', count: count('legal', 'menacee') }
        ]}
      ></gf-facet>
      <gf-facet name="photo" label="Photo" .selected=${filters.photo}
        .options=${[
          { value: 'avec', label: 'Avec photo', count: count('photo', 'avec') },
          { value: 'sans', label: 'Sans photo', count: count('photo', 'sans') }
        ]}
      ></gf-facet>
      <gf-facet name="french" label="Nom français" .selected=${filters.french}
        .options=${[
          { value: 'avec', label: 'Avec nom français', count: count('french', 'avec') },
          { value: 'sans', label: 'Sans nom français', count: count('french', 'sans') }
        ]}
      ></gf-facet>
      ${mine.length ? html`<gf-facet name="mine" label="Mes plantes" limit="6" .selected=${filters.mine} .options=${mine}></gf-facet>` : ''}
    `;
  }
}

customElements.define('gf-filter-panel', GfFilterPanel);
