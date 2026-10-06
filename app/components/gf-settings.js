// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { StoreController } from '../core/store.js';
import { getTrefleToken, setTrefleToken } from '../core/sources.js';
import { exportGeoJSON, importGeoJSON, lastExportDate, listCollections, spotEvents } from '../core/collections.js';

export class GfSettings extends LitElement {
  static properties = {
    _saved: { state: true },
    _spotCount: { state: true },
    _spotMessage: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host { display: block; overflow-y: auto; padding: 16px; }
    article { max-width: 720px; margin: 0 auto; }
    .back { color: var(--gf-accent); text-decoration: none; font-size: 0.9rem; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1rem; margin-top: 28px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
    dt { color: var(--gf-text-muted); }
    dd { margin: 0; }
    form { display: flex; gap: 8px; flex-wrap: wrap; }
    input {
      flex: 1 1 240px;
      font: inherit;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: var(--gf-text);
    }
    button {
      font: inherit;
      padding: 8px 16px;
      border-radius: 8px;
      border: 0;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      cursor: pointer;
    }
    .muted { color: var(--gf-text-muted); font-size: 0.9rem; }
    a { color: var(--gf-accent); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    button:disabled { opacity: 0.5; cursor: default; }
    label.file {
      font: inherit;
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--gf-accent);
      color: var(--gf-accent);
      cursor: pointer;
    }
    label.file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    label.file:focus-within { outline: 2px solid var(--gf-accent); outline-offset: 2px; }
  `;

  #store = new StoreController(this);
  #onSpots = () => this.#countSpots();

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpots);
    this.#countSpots();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpots);
  }

  async #countSpots() {
    this._spotCount = (await listCollections()).length;
  }

  async #export() {
    const { count, cancelled } = await exportGeoJSON();
    if (!cancelled) this._spotMessage = `${count} lieu${count > 1 ? 'x' : ''} exporté${count > 1 ? 's' : ''}.`;
  }

  /** @param {Event} event */
  async #import(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const r = await importGeoJSON(file);
      this._spotMessage = `Import : ${r.added} ajouté(s), ${r.updated} mis à jour, ${r.unchanged} inchangé(s)`
        + (r.skipped ? `, ${r.skipped} ignoré(s) (non valides)` : '') + '.';
    } catch (error) {
      this._spotMessage = /** @type {Error} */ (error).message;
    }
  }

  constructor() {
    super();
    this._saved = false;
    this._spotCount = 0;
    /** @type {string | null} */
    this._spotMessage = null;
  }

  /** @param {SubmitEvent} event */
  #save(event) {
    event.preventDefault();
    const input = /** @type {HTMLInputElement} */ (this.renderRoot.querySelector('input'));
    setTrefleToken(input.value.trim() || null);
    this._saved = true;
  }

  render() {
    const { meta, offline } = this.#store.state;
    return html`
      <article>
        <a class="back" href=${lastSearchHash()}>← Recherche</a>
        <h1>À propos et réglages</h1>

        <h2>Données</h2>
        ${meta ? html`
          <dl>
            <dt>Référentiel</dt><dd>TAXREF ${meta.taxrefVersion} (PatriNat / MNHN)</dd>
            <dt>Espèces</dt><dd>${meta.plants?.toLocaleString('fr-FR')}</dd>
            <dt>Familles</dt><dd>${meta.families}</dd>
            <dt>Noms français</dt><dd>${meta.vernacularNames?.toLocaleString('fr-FR')}</dd>
            <dt>Générée le</dt><dd>${new Date(meta.generatedAt).toLocaleString('fr-FR')}</dd>
            <dt>Connexion</dt><dd>${offline ? 'hors ligne (copie locale)' : 'en ligne'}</dd>
          </dl>` : nothing}
        <p class="muted">
          La flore est stockée localement (IndexedDB) et fonctionne hors ligne. Photos, descriptions et répartition
          proviennent à la demande de GBIF, iNaturalist, Wikidata et Wikimedia Commons ; seules les images sous
          licence libre (CC0, CC BY, CC BY-SA) sont affichées.
        </p>

        <h2>Mes plantes : favoris, listes et lieux</h2>
        <p class="muted">
          ${this._spotCount} collection${this._spotCount > 1 ? 's' : ''} enregistrée${this._spotCount > 1 ? 's' : ''} sur cet appareil uniquement.
          ${(() => { const d = lastExportDate(); return d ? `Dernière sauvegarde : ${new Date(d).toLocaleDateString('fr-FR')}.` : 'Aucune sauvegarde pour l’instant.'; })()}
          Exportez régulièrement : effacer les données du navigateur efface aussi vos collections.
        </p>
        <div class="row">
          <button type="button" @click=${this.#export} ?disabled=${!this._spotCount}>Exporter (GeoJSON)</button>
          <label class="file">Importer un fichier…
            <input type="file" accept=".geojson,.json,application/geo+json,application/json" @change=${this.#import} />
          </label>
        </div>
        ${this._spotMessage ? html`<p class="muted" role="status">${this._spotMessage}</p>` : nothing}

        <h2>Trefle (optionnel)</h2>
        <p class="muted">
          Un <a href="https://trefle.io" target="_blank" rel="noopener">token Trefle</a> gratuit ajoute des données
          botaniques. Il reste dans ce navigateur uniquement.
        </p>
        <form @submit=${this.#save}>
          <input type="password" autocomplete="off" placeholder="Token Trefle" .value=${getTrefleToken() || ''} @input=${() => { this._saved = false; }} />
          <button type="submit">Enregistrer</button>
        </form>
        ${this._saved ? html`<p class="muted">Enregistré.</p>` : nothing}
      </article>
    `;
  }
}

customElements.define('gf-settings', GfSettings);
