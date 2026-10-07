// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { setHarvestMode, StoreController } from '../core/store.js';
import { getTrefleToken, setTrefleToken } from '../core/sources.js';
import { exportGeoJSON, importGeoJSON, lastExportDate, listCollections, protectStorage, spotEvents, storageReport, transferLink } from '../core/collections.js';
import { share } from '../core/share.js';
import { myRegion, setMyRegion, territories, territoryAt } from '../core/territory.js';

export class GfSettings extends LitElement {
  static properties = {
    _saved: { state: true },
    _spotCount: { state: true },
    _spotMessage: { state: true },
    _report: { state: true },
    _personal: { state: true },
    _regions: { state: true },
    _region: { state: true },
    _regionNote: { state: true },
    _transfer: { state: true }
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
    .switch { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
    .switch input { width: 22px; height: 22px; accent-color: var(--gf-accent); flex: none; margin-top: 2px; }
    button:disabled { opacity: 0.5; cursor: default; }
    label.file {
      font: inherit;
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--gf-accent);
      color: var(--gf-accent);
      cursor: pointer;
    }
    .diag { font-size: 0.85rem; }
    select { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--gf-border); background: var(--gf-surface); color: var(--gf-text); max-width: 100%; }
    details { margin-top: 10px; }
    summary { cursor: pointer; }
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
    this._spotCount = (await listCollections().catch(() => [])).length;
    this._report = await storageReport().catch(() => null);
  }

  async #protect() {
    await protectStorage();
    this._report = await storageReport().catch(() => null);
  }

  #diagnostic() {
    const r = this._report;
    if (!r) return nothing;
    const date = (/** @type {string | null} */ d) => (d ? new Date(d).toLocaleString('fr-FR') : 'jamais');
    const mb = (/** @type {number | null} */ n) => (n === null ? '?' : (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo');
    return html`
      <h2>Protection des données</h2>
      ${r.persisted ? html`<p class="muted">✓ Données protégées : le navigateur ne les effacera pas pour faire de la place.</p>` : html`
        <p class="muted">Données <strong>non protégées</strong> : le navigateur peut les effacer s’il manque de place.
          Installer l’application (menu du navigateur → « Installer l’application » ou « Ajouter à l’écran d’accueil ») aide à les faire protéger.</p>
        <div class="row"><button type="button" @click=${this.#protect}>Protéger mes données</button></div>`}
      <details>
        <summary class="muted">Diagnostic du stockage</summary>
        <dl class="diag">
          <dt>Base locale</dt><dd>version ${r.dbVersion ?? '?'} · ${r.collections} collection${r.collections > 1 ? 's' : ''}</dd>
          <dt>Protégée</dt><dd>${r.persisted === null ? 'inconnu' : r.persisted ? 'oui' : 'non'}</dd>
          <dt>Espace utilisé</dt><dd>${mb(r.usage)} sur ${mb(r.quota)}</dd>
          <dt>Copie de secours</dt><dd>${r.backupCount} collection${r.backupCount > 1 ? 's' : ''} · ${date(r.backupAt)}</dd>
          <dt>Dernier export</dt><dd>${date(r.lastExport)}</dd>
          <dt>Collections déjà créées ici</dt><dd>${r.markedHasSpots ? 'oui' : 'non'}</dd>
        </dl>
      </details>`;
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
    /** @type {Awaited<ReturnType<typeof storageReport>> | null} */
    this._report = null;
    this._personal = true;
    /** @type {{ iso: string, name: string }[]} */
    this._regions = [];
    this._region = myRegion();
    /** @type {string | null} */
    this._regionNote = null;
    territories().then(t => { this._regions = t.regions; }).catch(() => {});
    /** @type {string | null} */
    this._transfer = null;
  }

  /** @param {string | null} iso */
  #setRegion(iso) {
    setMyRegion(iso);
    this._region = iso;
    this._regionNote = null;
  }

  #regionFromGps() {
    this._regionNote = 'Recherche de la position…';
    navigator.geolocation.getCurrentPosition(async pos => {
      const here = await territoryAt([pos.coords.longitude, pos.coords.latitude]).catch(() => null);
      if (!here) { this._regionNote = 'Position hors de France métropolitaine.'; return; }
      this.#setRegion(here.region);
      this._regionNote = `${here.regionName} (${here.deptName}).`;
    }, () => { this._regionNote = 'Position indisponible.'; }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }

  /** Long links still work in browsers, but some messaging apps cut them. */
  static LONG_LINK = 30000;

  async #transfer() {
    try {
      const { url, count } = await transferLink({ personal: this._personal });
      const absolute = new URL(url, location.href).href;
      const result = await share({ title: 'Mes plantes GeoFlora', text: `${count} collection${count > 1 ? 's' : ''} GeoFlora`, url });
      this._transfer = (result === 'copied' ? 'Lien copié' : result === 'shared' ? 'Lien partagé' : result === 'cancelled' ? 'Partage annulé' : 'Lien prêt')
        + ` (${absolute.length.toLocaleString('fr-FR')} caractères). Ouvrez-le sur l’autre appareil puis touchez « Importer ».`
        + (absolute.length > GfSettings.LONG_LINK ? ' Lien long : certaines messageries le coupent, préférez le fichier.' : '');
    } catch (error) {
      this._transfer = 'Transfert impossible : ' + /** @type {Error} */ (error).message;
    }
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
        <p class="muted">
          Calendrier des fiches : mois de floraison de <a href="https://www.tela-botanica.org/ressources/donnees/telechargements/" target="_blank" rel="noopener">Baseflor</a>
          (Ph. Julve, programme CATMINAT, Tela Botanica — données CC BY-SA 2.0, base ODbL 1.0)${meta?.sources?.baseflor ? ` pour ${meta.sources.baseflor.matched.toLocaleString('fr-FR')} espèces` : ''},
          et observations « en fleurs » / « en fruits » en France d’<a href="https://www.inaturalist.org/" target="_blank" rel="noopener">iNaturalist</a>.
          Ce sont des indications de floraison et de fructification, pas des dates de cueillette.
        </p>

        <h2>Ma région</h2>
        <p class="muted">Pour savoir si une plante est protégée ou si sa cueillette est réglementée chez vous (statuts INPN).
          Dans un endroit, c’est sa position GPS qui compte.</p>
        <div class="row">
          <select aria-label="Ma région" .value=${this._region || ''} @change=${e => this.#setRegion(e.target.value || null)}>
            <option value="">— Non précisée —</option>
            ${this._regions.map(r => html`<option value=${r.iso} ?selected=${r.iso === this._region}>${r.name}</option>`)}
          </select>
          <button type="button" @click=${this.#regionFromGps}>Utiliser ma position</button>
        </div>
        ${this._regionNote ? html`<p class="muted" role="status">${this._regionNote}</p>` : nothing}

        <h2>Mode cueillette</h2>
        <label class="switch">
          <input type="checkbox" .checked=${this.#store.state.harvestMode} @change=${e => setHarvestMode(e.target.checked)} />
          <span>Journal de récolte, qualité, plantes « en saison » / « bientôt »</span>
        </label>
        <p class="muted">Désactivé, vos lieux restent de simples « plantes vues ici » ; rien n’est effacé.</p>

        <h2>Mes plantes : favoris, listes et lieux</h2>
        <p class="muted">
          ${this._spotCount} collection${this._spotCount > 1 ? 's' : ''} enregistrée${this._spotCount > 1 ? 's' : ''} sur cet appareil uniquement.
          ${(() => { const d = lastExportDate(); return d ? `Dernière sauvegarde : ${new Date(d).toLocaleDateString('fr-FR')}.` : 'Aucune sauvegarde pour l’instant.'; })()}
          Exportez régulièrement : effacer les données du navigateur efface aussi vos collections.
        </p>
        <div class="row">
          <button type="button" @click=${this.#export} ?disabled=${!this._spotCount}>Exporter (fichier GeoJSON)</button>
          <label class="file">Importer un fichier…
            <input type="file" accept=".geojson,.json,application/geo+json,application/json" @change=${this.#import} />
          </label>
        </div>
        ${this._spotMessage ? html`<p class="muted" role="status">${this._spotMessage}</p>` : nothing}

        <h2>Transférer vers un autre appareil</h2>
        <p class="muted">Un lien contient toutes vos collections (compressées, sans passer par un serveur). Ouvrez-le sur l’autre téléphone ou ordinateur : elles y sont ajoutées ou mises à jour. Gardé dans un e-mail ou une note, il sert aussi de sauvegarde.</p>
        <label class="switch">
          <input type="checkbox" .checked=${this._personal} @change=${e => { this._personal = e.target.checked; }} />
          <span>Inclure mes notes et journaux de récolte</span>
        </label>
        <div class="row"><button type="button" @click=${this.#transfer} ?disabled=${!this._spotCount}>Créer le lien de transfert</button></div>
        ${this._transfer ? html`<p class="muted" role="status">${this._transfer}</p>` : nothing}
        ${this.#diagnostic()}

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
