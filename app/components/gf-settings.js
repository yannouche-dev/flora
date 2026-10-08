// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { MODE_LABELS, setHarvestMode, setMode, StoreController } from '../core/store.js';
import './gf-mode-switch.js';
import { getTrefleToken, setTrefleToken } from '../core/sources.js';
import { MODE_KEYS, MODULES, setModule } from '../core/modules.js';
import { icon, MODE_ICONS } from '../core/icons.js';
import { exportGeoJSON, importGeoJSON, lastExportDate, listCollections, protectStorage, spotEvents, storageReport, transferLink } from '../core/collections.js';
import { share } from '../core/share.js';
import { myRegion, setMyRegion, territories, territoryAt } from '../core/territory.js';
import { blockModuleName, blockOrder, blockTitle, isCustom, isHidden, resetBlocks, setHidden } from '../core/sheet-blocks.js';
import { ui } from '../styles/ui.js';

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

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; padding: 16px; }
    article { max-width: 720px; margin: 0 auto; }
    .back { font-size: 0.9rem; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1rem; margin-top: 28px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
    dt { color: var(--gf-text-muted); }
    dd { margin: 0; }
    form { display: flex; gap: 8px; flex-wrap: wrap; }
    form input { flex: 1 1 240px; width: auto; }
    .muted { font-size: 0.9rem; }
    a { color: var(--gf-accent); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .switch { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
    .switch input { flex: none; margin-top: 2px; }
    .diag { font-size: 0.85rem; }
    select { max-width: 100%; }
    details { margin-top: 10px; }
    summary { cursor: pointer; }
    label.file { position: relative; }
    label.file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    label.file:focus-within { box-shadow: var(--gf-focus); }
    .mode-line { display: flex; align-items: center; gap: 10px; }
    .modules { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .module { border: 1px solid var(--gf-border); border-radius: var(--gf-radius); padding: 10px 12px; background: var(--gf-surface); }
    .module.on { border-color: color-mix(in srgb, var(--gf-accent) 45%, var(--gf-border)); }
    .module .muted { margin: 4px 0 0; font-size: 0.85rem; }
    .module .host { color: var(--gf-text-muted); font-weight: 400; margin-left: 4px; }
    .module .state { margin-left: 6px; color: var(--gf-text-muted); font-style: italic; }
    .module form { margin-top: 8px; }
    .module .modes { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
    .module .mode { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; }
    .module .mode svg { color: var(--gf-text-muted); }
    .block-orders { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin: 8px 0 16px; }
    .block-order { padding: 10px 12px; }
    .block-order .head { display: flex; align-items: center; gap: 8px; }
    .block-order .head button { margin-left: auto; }
    .block-order ol { margin: 8px 0 0; padding-left: 22px; font-size: 0.88rem; }
    .block-order li { margin: 2px 0; }
    .block-order label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .block-order input { margin: 0; }
    .module .mode input { width: 18px; height: 18px; margin: 0; }
  `];

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
      ${r.persisted ? html`<p class="muted">${icon('check-lg')} Données protégées : le navigateur ne les effacera pas pour faire de la place.</p>` : html`
        <p class="muted">Données <strong>non protégées</strong> : le navigateur peut les effacer s’il manque de place.
          Installer l’application (menu du navigateur → « Installer l’application » ou « Ajouter à l’écran d’accueil ») aide à les faire protéger.</p>
        <div class="row"><button class="primary" type="button" @click=${this.#protect}>Protéger mes données</button></div>`}
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
    const input = /** @type {HTMLInputElement} */ (this.renderRoot.querySelector('input[name=trefle]'));
    setTrefleToken(input.value.trim() || null);
    this._saved = true;
  }

  /** Réglages › Modules: one card per online service, with its switch (Trefle: its token too). */
  #modules() {
    const on = this.#store.state.modules;
    const token = getTrefleToken();
    return html`
      <h2 id="modules">Modules : services en ligne</h2>
      <p class="muted">Tout fonctionne hors ligne avec la flore locale ; chaque module ajoute des données d’un service en ligne.
        Cochez les modes où il sert : la fiche plante suit son affichage, la grille des résultats le sien, la carte et le reste le mode
        de l’application. Décoché, le service n’est pas appelé dans ce mode et ses données ne s’y affichent pas.</p>
      <ul class="modules">
        ${MODULES.map(m => {
          const blocked = Boolean(m.needsToken && !token);
          const any = !blocked && MODE_KEYS.some(mode => on[m.key][mode]);
          return html`<li class="module ${any ? 'on' : ''}">
            <div class="title"><strong>${m.name}</strong> <small class="host">${m.hosts}</small>
              ${blocked ? html`<small class="state">jeton requis</small>` : nothing}</div>
            <p class="muted">${m.provides}</p>
            <div class="modes" role="group" aria-label=${'Modes où ' + m.name + ' est utilisé'}>
              ${MODE_KEYS.map(mode => html`<label class="mode">
                <input type="checkbox" .checked=${on[m.key][mode] && !blocked} ?disabled=${blocked}
                  @change=${e => setModule(m.key, mode, e.target.checked)} />
                ${MODE_ICONS[mode]}<span>${MODE_LABELS[mode]}</span>
              </label>`)}
            </div>
            ${m.key === 'trefle' ? html`
              <p class="muted">Un <a href="https://trefle.io" target="_blank" rel="noopener">jeton Trefle</a> gratuit ;
                il reste dans ce navigateur uniquement.</p>
              <form class="row" @submit=${this.#save}>
                <input name="trefle" type="password" autocomplete="off" placeholder="Jeton Trefle" .value=${token || ''}
                  @input=${() => { this._saved = false; }} />
                <button class="primary" type="submit">Enregistrer</button>
              </form>
              ${this._saved ? html`<p class="muted" role="status">Enregistré.</p>` : nothing}` : nothing}
          </li>`;
        })}
      </ul>`;
  }

  /** « Blocs de la fiche »: each mode's order and shown blocks (the same switches as the sheet and the modules), and back to the default. */
  #blockOrders() {
    void this.#store.state.sheetBlocks;
    void this.#store.state.sheetHidden;
    void this.#store.state.modules;
    return html`
      <h3>Blocs de la fiche</h3>
      <p class="muted">Dans une fiche plante, glissez un bloc par son titre pour le déplacer (ou ↑ ↓ sur sa poignée ${icon('grip-vertical')}),
        repliez-le avec ${icon('trash3')} et réaffichez-le avec ${icon('arrow-counterclockwise')}. Chaque mode garde son ordre et ses blocs ;
        replier un bloc de service (Wikipédia, GBIF, Trefle, photos) coupe ce module dans ce mode.</p>
      <div class="block-orders">
        ${MODE_KEYS.map(mode => html`
          <div class="card block-order">
            <div class="head">${MODE_ICONS[mode]}<strong>${MODE_LABELS[mode]}</strong>
              <button type="button" class="small" ?disabled=${!isCustom(mode) && !blockOrder(mode).some(k => isHidden(mode, k))}
                @click=${() => resetBlocks(mode)}>Par défaut</button>
            </div>
            <ol>${blockOrder(mode).map(k => html`<li><label>
              <input type="checkbox" .checked=${!isHidden(mode, k)} @change=${e => setHidden(mode, k, !e.target.checked)} />
              ${blockTitle(k)}${blockModuleName(k) ? html` <small class="muted">(module ${blockModuleName(k)})</small>` : nothing}
            </label></li>`)}</ol>
          </div>`)}
      </div>`;
  }

  render() {
    const { meta, offline } = this.#store.state;
    return html`
      <article>
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
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
          proviennent à la demande des services listés plus bas dans « Modules » ; seules les images sous
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

        <h2>Affichage</h2>
        <p class="mode-line">
          <gf-mode-switch scope="toute l’application" value=${this.#store.state.mode}
            @mode-change=${e => setMode(e.detail.mode || 'standard')}></gf-mode-switch>
          <strong>${MODE_LABELS[this.#store.state.mode]}</strong>
        </p>
        <p class="muted">Épuré : grandes photos et actions rapides (ajouter à la collection en cours). Standard : l’essentiel pour tous.
          Scientifique : toutes les données, locales et distantes. La grille et la fiche plante ont aussi leur propre choix, qui revient au mode de l’application quand celui-ci change.</p>

        ${this.#blockOrders()}

        ${this.#modules()}

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
          <button class="primary" type="button" @click=${this.#export} ?disabled=${!this._spotCount}>Exporter (fichier GeoJSON)</button>
          <label class="file button">Importer un fichier…
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
        <div class="row"><button class="primary" type="button" @click=${this.#transfer} ?disabled=${!this._spotCount}>Créer le lien de transfert</button></div>
        ${this._transfer ? html`<p class="muted" role="status">${this._transfer}</p>` : nothing}
        ${this.#diagnostic()}

      </article>
    `;
  }
}

customElements.define('gf-settings', GfSettings);
