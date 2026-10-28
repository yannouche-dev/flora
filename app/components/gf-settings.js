// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href, parse } from '../core/router.js';
import { harvestModeChosen, openKing, setHarvestMode, setMode, setShowSteps, StoreController } from '../core/store.js';
import { context, floreHref, floreName } from '../core/context.js';
import { MODE_ICON_CHOICES, modeLabel } from '../core/modes.js';
import { createMode, deleteMode, editMode } from '../core/mode-admin.js';
import './gf-mode-switch.js';
import { getTrefleToken, setTrefleToken } from '../core/sources.js';
import { MODULES, setModule } from '../core/modules.js';
import { CATEGORIES, categoryOf } from '../core/categories.js';
import { icon, modeIcon } from '../core/icons.js';
import { exportGeoJSON, importGeoJSON, keptContents, lastExportDate, listCollections, protectStorage, spotEvents, storageReport, transferLink } from '../core/collections.js';
import { share } from '../core/share.js';
import { myRegion, setMyRegion, territories, territoryAt } from '../core/territory.js';
import { exportLayout, importLayout, resetAll } from '../core/sheet-blocks.js';
import { ui } from '../styles/ui.js';
import { discoverEvents, discovering, finishDiscover, restartDiscover, tabShown } from '../core/discover.js';
import { forgetHints } from '../core/hints.js';
import { openView } from '../core/history.js';
import { briefToast } from '../core/toast.js';
import { confirmAsk } from './gf-ask.js';
import { resetMapLook, resetMapSettings } from '../core/map-settings.js';
import { notesEvents, notesWithText } from '../core/sheet-notes.js';
import './gf-map-options.js';
import { PRESETS } from '../layout/presets.js';

/** French names of the icons a mode can have. */
const ICON_NAMES = { image: 'Photo', 'list-ul': 'Liste', table: 'Tableau', images: 'Médias', map: 'Carte', leaf: 'Feuille', flower1: 'Fleur', 'diagram-3': 'Réseau', star: 'Étoile', layers: 'Couches', search: 'Loupe', crown: 'Couronne' };

/** What « Revoir les premiers pas » does, said under it and in its question. */
const FIRST_STEPS_AGAIN = 'les étapes et ce que gardent Rencontres, Cueillette prudente et Mosaïque (lieu, distance, cartes, matchs) sont oubliés. Vos favoris restent, et ceux venus de ces activités deviennent les vôtres.';

export class GfSettings extends LitElement {
  static properties = {
    _saved: { state: true },
    _spotCount: { state: true },
    _kept: { state: true },
    _spotMessage: { state: true },
    _report: { state: true },
    _personal: { state: true },
    _regions: { state: true },
    _region: { state: true },
    _regionNote: { state: true },
    _transfer: { state: true },
    _layoutNote: { state: true },
    _modeNote: { state: true },
    _firstStepsError: { state: true }
  };

  static styles = [ui, css`
    .maps-card { display: grid; gap: 8px; }
    .steps-choice { display: grid; gap: 6px; margin: 4px 0 12px; padding: 10px 14px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); }
    .steps-choice legend { padding: 0 4px; font-weight: 600; }
    .steps-choice label { display: flex; align-items: center; gap: 8px; min-height: 32px; }
    .mode-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
    .mode-item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); }
    .mode-item .mode-icon { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--gf-accent-soft); color: var(--gf-accent); }
    .mode-item .mode-name { max-width: 220px; }
    .mode-item .mode-actions { margin-left: auto; display: inline-flex; gap: 6px; }
    :host { display: block; overflow-y: auto; padding: 16px; }
    article { max-width: 720px; margin: 0 auto; }
    .back { font-size: 0.9rem; }
    p.error { color: var(--gf-danger); font-size: 0.9rem; }
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
    /* « Créer une app », first on the page: a card that leads to the builder's start (its grids, its models). */
    .builder { display: flex; align-items: center; gap: 12px; margin: 12px 0 18px; padding: 14px 16px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-lg);
      background: color-mix(in srgb, var(--gf-accent) 8%, var(--gf-surface)); color: var(--gf-text); text-decoration: none; }
    .builder:hover { background: color-mix(in srgb, var(--gf-accent) 14%, var(--gf-surface)); }
    .builder > .bi { flex: none; font-size: 1.6rem; color: var(--gf-accent); }
    .builder span { flex: 1; display: grid; gap: 2px; min-width: 0; }
    .builder small { color: var(--gf-text-muted); }
    .layouts { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
    .layouts a { display: grid; gap: 2px; padding: 8px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); text-decoration: none; }
    .layouts a:hover { border-color: var(--gf-accent); }
    .layouts small { color: var(--gf-text-muted); }
    label.file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    label.file:focus-within { box-shadow: var(--gf-focus); }
    .mode-line { display: flex; align-items: center; gap: 10px; }
    .modules { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    h3.category { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 18px 0 8px; font-size: 0.95rem; }
    h3.category svg { color: var(--gf-accent); align-self: center; }
    h3.category small { font-weight: 400; color: var(--gf-text-muted); font-size: 0.82rem; }
    .also { margin: 4px 0 0; font-size: 0.78rem; color: var(--gf-text-muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .cat-chip { display: inline-block; padding: 0 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); font-size: 0.72rem; font-weight: 600; }
    .module { border: 1px solid var(--gf-border); border-radius: var(--gf-radius); padding: 10px 12px; background: var(--gf-surface); }
    .module.on { border-color: color-mix(in srgb, var(--gf-accent) 45%, var(--gf-border)); }
    .module .muted { margin: 4px 0 0; font-size: 0.85rem; }
    .module .host { color: var(--gf-text-muted); font-weight: 400; margin-left: 4px; }
    .module .state { margin-left: 6px; color: var(--gf-text-muted); font-style: italic; }
    .module form { margin-top: 8px; }
    .module .use { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.85rem; cursor: pointer; }
    /* « Mise en page de la fiche » (King, its code name): one card — the button, the file, « Tout rétablir ». */
    .king-card { margin: 12px 0 20px; border: 2px solid color-mix(in srgb, #d4a017 40%, var(--gf-border)); }
    .king-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .king-head h2 { margin: 0; flex: 1; }
    .layout-file { margin-top: 8px; gap: 8px; }
    .module .use input { width: 18px; height: 18px; margin: 0; }
  `];

  #store = new StoreController(this);
  #onSpots = () => this.#countSpots();
  #onDiscover = () => this.requestUpdate();
  /** The Note blocks' texts read or changed: they too are exported and transferred (with Mes plantes). */
  #onNotes = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpots);
    discoverEvents.addEventListener('change', this.#onDiscover);
    notesEvents.addEventListener('change', this.#onNotes);
    this.#countSpots();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpots);
    discoverEvents.removeEventListener('change', this.#onDiscover);
    notesEvents.removeEventListener('change', this.#onNotes);
  }

  async #countSpots() {
    const all = await listCollections().catch(() => []);
    this._kept = keptContents(all);
    // An empty favourites list alone is nothing to export or transfer.
    this._spotCount = this._kept ? all.length : 0;
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
          <dt>Base locale</dt><dd>version ${r.dbVersion ?? '?'} · ${r.kept || 'vide'}</dd>
          <dt>Protégée</dt><dd>${r.persisted === null ? 'inconnu' : r.persisted ? 'oui' : 'non'}</dd>
          <dt>Espace utilisé</dt><dd>${mb(r.usage)} sur ${mb(r.quota)}</dd>
          <dt>Copie de secours</dt><dd>${r.backupKept || 'vide'} · ${date(r.backupAt)}</dd>
          <dt>Dernier export</dt><dd>${date(r.lastExport)}</dd>
          <dt>Listes ou lieux déjà créés ici</dt><dd>${r.markedHasSpots ? 'oui' : 'non'}</dd>
        </dl>
      </details>`;
  }

  async #export() {
    const { kept, cancelled } = await exportGeoJSON();
    if (!cancelled) this._spotMessage = kept ? `Exporté : ${kept}.` : 'Fichier exporté.';
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
        + (r.skipped ? `, ${r.skipped} ignoré(s) (non valides)` : '')
        + (r.notes ? `, ${r.notes} note${r.notes > 1 ? 's' : ''} de fiche` : '') + '.';
    } catch (error) {
      this._spotMessage = /** @type {Error} */ (error).message;
    }
  }

  constructor() {
    super();
    this._saved = false;
    /** Why « Revoir les premiers pas » did nothing (said under its button). @type {string | null} */
    this._firstStepsError = null;
    /** What the last export / import / reset did. @type {string | null} */
    this._layoutNote = null;
    this._spotCount = 0;
    /** What Mes plantes holds, in words (keptContents). */
    this._kept = '';
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
      const { url, kept } = await transferLink({ personal: this._personal });
      const absolute = new URL(url, location.href).href;
      const result = await share({ title: 'Mes plantes GeoFlora', text: kept ? `GeoFlora : ${kept}` : 'GeoFlora', url });
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

  /** Réglages › Modules: one card per online service, with its switch for the whole device (Trefle: its token too). */
  #modules() {
    const on = this.#store.state.modules;
    const token = getTrefleToken();
    return html`
      <h2 id="modules">Modules : services en ligne</h2>
      <p class="muted">Tout fonctionne hors ligne avec la flore locale ; chaque module ajoute des données d’un service en ligne.
        Le choix vaut pour tout l’appareil, quel que soit le mode d’affichage : décoché, le service n’est jamais appelé et ses données
        ne s’affichent nulle part (fiche plante, grille, cartes, activités). Masquer un bloc de la fiche ne coupe pas son service.
        Ce que chacun reçoit, votre position surtout : <a href=${href.legal()}>Mentions légales et confidentialité</a>.</p>
      ${CATEGORIES.filter(c => MODULES.some(m => m.category === c.key)).map(c => html`
      <h3 class="category">${icon(c.icon)} ${c.label} <small>${c.question}</small></h3>
      <ul class="modules">
        ${MODULES.filter(m => m.category === c.key).map(m => {
          const blocked = Boolean(m.needsToken && !token);
          const used = !blocked && on[m.key];
          return html`<li class="module ${used ? 'on' : ''}">
            <div class="title"><strong>${m.name}</strong> <small class="host">${m.hosts}</small>
              ${blocked ? html`<small class="state">jeton requis</small>` : nothing}</div>
            <p class="muted">${m.provides}</p>
            ${m.also.length ? html`<p class="also">Sert aussi : ${m.also.map(k => html`<span class="cat-chip">${categoryOf(k).label}</span>`)}</p>` : nothing}
            <label class="use">
              <input type="checkbox" aria-label=${'Utilisé sur cet appareil : ' + m.name} .checked=${used} ?disabled=${blocked}
                @change=${e => setModule(m.key, e.target.checked)} />
              <span>Utilisé sur cet appareil</span>
            </label>
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
      </ul>`)}`;
  }

  /**
   * The plant « Personnaliser la fiche » opens: the last one read in Flore (its plain address: a `?pane=` would open a
   * block alone, where the sheet is not personalised), else the first result; null: none yet.
   * @returns {number | null}
   */
  get #plantToCustomize() {
    const last = context().flore ? parse(context().flore) : null;
    if (last?.name === 'plant') return last.id;
    return this.#store.state.results.items[0]?.id ?? null;
  }

  /** « Personnaliser la fiche »: that plant in Flore, its sheet being personalised (King). @param {number} id */
  #customize(id) {
    openKing('flore');
    openView(href.plant(id));
  }

  /**
   * « Mise en page de la fiche »: one card, no list — the sheet is personalised on itself (its crown). Here: the button
   * that opens it, the file (the layout and the modes, never the Note blocks' texts), « Tout rétablir ».
   */
  #sheetLayout() {
    const id = this.#plantToCustomize;
    return html`
      <section class="card king-card" aria-labelledby="sheet-layout">
        <div class="king-head">
          <h2 id="sheet-layout">Mise en page de la fiche</h2>
          <button type="button" class="primary" ?disabled=${id === null} aria-describedby=${id === null ? 'customize-why' : nothing}
            @click=${() => { if (id !== null) this.#customize(id); }}>${icon('crown')} Personnaliser la fiche</button>
        </div>
        ${id === null ? html`<p class="muted" id="customize-why">Ouvrez une plante dans Flore.</p>` : nothing}
        <p class="muted">Personnalisez la fiche sur elle-même : touchez la couronne ${icon('crown')} au bout de sa barre d’actions, dans Flore ou Mes plantes.
          Sa barre « Mise en page de la fiche » dit le mode arrangé, et en arrange un autre sans changer celui de l’application ; « Terminé » la referme.
          Glissez les blocs par leur poignée ${icon('grip-vertical')} (à la souris, par leur titre aussi ; au clavier, ↑ ↓ sur la poignée),
          masquez-les avec la corbeille ${icon('trash3')}, rangez-les dans des panneaux (« Déplacer vers… ») : tout est enregistré aussitôt,
          pour chaque mode d’affichage. Plantes à confondre et Usages et cuisine sauvage, avec sa Prudence, restent toujours affichés.
          Masquer un bloc ne coupe pas son service (Modules, plus bas).</p>
        <p class="muted">Le fichier de mise en page (JSON) emporte l’ordre et la présence des blocs, leurs styles, titres et panneaux, vos blocs Note
          et Carte et vos modes : pour la sauvegarder ou la copier sur un autre appareil. Les textes des blocs Note n’y sont pas : ils voyagent avec
          vos plantes (« Exporter (fichier GeoJSON) », lien de transfert, plus bas). « Tout rétablir » remet tout par défaut : la mise en page
          et la barre d’actions de chaque mode — vos modes gardent leur nom et leur icône, avec la mise en page de leur modèle —, les noms donnés
          aux blocs, les réglages ⚙ du bloc Carte ; vos blocs Note et leurs textes restent.</p>
        <div class="row layout-file">
          <button type="button" @click=${this.#exportLayout}>${icon('download')} Exporter la mise en page</button>
          <label class="button file">${icon('upload')} Importer…
            <input type="file" accept="application/json,.json" @change=${this.#importLayout} /></label>
          <button type="button" @click=${this.#resetLayout}>Tout rétablir</button>
        </div>
        ${this._layoutNote ? html`<p class="muted" role="status">${this._layoutNote}</p>` : nothing}
      </section>`;
  }

  /**
   * « Tout rétablir », confirmed: every mode back to its defaults (its action bar too; an own mode keeps its name and
   * icon, with its model's layout), the names and the built-in Carte's settings too; the Note blocks and their texts stay.
   */
  #resetLayout() {
    if (!confirm('Tout rétablir ? Dans tous les modes, ordre, blocs et sous-blocs masqués, styles, titres affichés ou cachés, « masqué si vide », panneaux et barre d’actions reviennent par défaut, les noms donnés aux blocs et les réglages ⚙ du bloc Carte aussi, et les blocs Carte ajoutés sont supprimés. Vos modes gardent leur nom et leur icône, avec la mise en page de leur modèle. Vos blocs Note et leurs textes restent.')) return;
    resetAll();
    this._layoutNote = 'Mise en page rétablie.';
  }

  async #exportLayout() {
    const file = new File([exportLayout()], 'geoflora-mise-en-page.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mise en page GeoFlora' }); this._layoutNote = 'Mise en page partagée.'; return; } catch { /* fall back to a download */ }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._layoutNote = 'Mise en page exportée (geoflora-mise-en-page.json).';
  }

  /** @param {Event} e */
  async #importLayout(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const added = await importLayout(await file.text());
      // A file of before carries note texts: added to this device's, never written over them.
      this._layoutNote = 'Mise en page importée' + (added ? ` (${added} note${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''}).` : '.');
    } catch (error) {
      this._layoutNote = 'Import impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  /** « Modes d'affichage »: make a mode from another, rename it, change its icon, delete it. */
  #modes() {
    const modes = this.#store.state.modes;
    return html`<h3 id="modes">Modes d’affichage</h3>
      <p class="muted">Créez vos modes à partir d’un autre (ses blocs, sa disposition, ses panneaux et sa grille sont copiés) :
        par exemple une visionneuse de médias toute simple, ou un poste scientifique qui croise toutes les données. Chacun se personnalise ensuite
        sur la fiche (la couronne, puis ce mode dans la barre de mise en page) ; il s’affiche à la manière de son modèle (Épuré, Standard ou Scientifique). Les services en ligne, eux, valent pour tous les modes (Modules).</p>
      <ul class="mode-list">
        ${modes.map(m => html`<li class="mode-item">
          <span class="mode-icon">${modeIcon(m.key)}</span>
          ${m.builtIn ? html`<strong>${m.label}</strong>` : html`<input class="mode-name" aria-label=${'Nom du mode ' + m.label} .value=${m.label} maxlength="40"
            @change=${(/** @type {any} */ e) => editMode(m.key, { label: e.target.value })} />`}
          <small class="muted">${m.builtIn ? 'mode de l’application' : 'à la manière de ' + modeLabel(m.base)}</small>
          ${m.builtIn ? nothing : html`<select aria-label=${'Icône du mode ' + m.label} @change=${(/** @type {any} */ e) => editMode(m.key, { icon: e.target.value })}>
            ${MODE_ICON_CHOICES.map(i => html`<option value=${i} ?selected=${i === m.icon}>${ICON_NAMES[i] || i}</option>`)}</select>`}
          <span class="mode-actions">
            <button type="button" class="small" title=${'Nouveau mode à partir de « ' + m.label + ' »'}
              @click=${() => { const key = createMode(m.label + ' (copie)', m.key); this._modeNote = `Mode « ${modeLabel(key)} » créé : choisissez-le dans les sélecteurs d’affichage, puis personnalisez-le sur la fiche (couronne, puis ce mode dans la barre de mise en page).`; }}>${icon('plus-lg')} Dupliquer</button>
            ${m.builtIn ? nothing : html`<button type="button" class="small" aria-label=${'Supprimer le mode ' + m.label}
              @click=${() => { if (confirm(`Supprimer le mode « ${m.label} » et sa mise en page ?`)) deleteMode(m.key); }}>${icon('trash3')} Supprimer</button>`}
          </span>
        </li>`)}
      </ul>
      ${this._modeNote ? html`<p class="muted" role="status">${this._modeNote}</p>` : nothing}`;
  }

  /**
   * « Cartes »: the maps' common settings — 2D (Leaflet) or 3D (MapLibre, loaded only then) and the 3D options, the
   * background (the plan, the photos of now or of a year, SPOT's), « Noms et réseaux » over the photos and SPOT's, IGN's
   * layers by theme and its whole catalogue —: the same options as each map's panel ▦ (gf-map-options.js); changed here or there, every map that follows them
   * follows at once.
   */
  #maps() {
    return html`<h2 id="cartes">Cartes</h2>
      <div class="maps-card">
        <p class="muted">Réglages communs à toutes les cartes : la Carte, la carte de la fiche plante, Mes plantes, Parcours, Rencontres, le partage, les cartes des dispositions libres. Chaque carte les propose aussi dans son panneau ▦ (les mêmes réglages, changés pour toutes).
          Le fond : le plan IGN, les photos aériennes — les plus récentes, ou celles d’une année, d’une période, les photos historiques — ou les images satellite SPOT d’une année ; sur les photos et SPOT, les noms et réseaux par-dessus toutes les couches (noms de lieux, routes et cours d’eau par défaut ; voies ferrées, bâtiments, limites administratives au choix) — le plan IGN a les siens. Les couches de l’IGN, rangées par thème : relief ; forêts, haies et zones humides ; espaces protégés et propriété ; puis tout le catalogue.
          Une carte qui a son propre fond le garde — une case de disposition libre dont l’adresse dit son fond (base=, annee=), ses noms et réseaux (noms=) ou ses couches (layers=), une carte de fiche réglée avant —, et son panneau ▦ propose de revenir aux réglages communs.</p>
        <gf-map-options scope="defaults"></gf-map-options>
        <p class="muted">En 3D : glisser du clic droit, ou à deux doigts, pour tourner et incliner ; Maj + flèches au clavier ; la boussole revient au nord. La 3D se télécharge à sa première ouverture (environ 1,6 Mo), en ligne.
          L’étape « Jusqu’où part l’expédition ? » reste vue de dessus ; sur une fiche plante, les cartes ajoutées en plus de la carte principale restent en 2D ; pendant la modification des positions, la carte repasse en 2D le temps de l’édition.</p>
        <p class="muted">Le relief vient d’AWS Terrain Tiles (s3.amazonaws.com, module « Vue 3D (relief) »), les bâtiments et le plan vectoriel de l’IGN (data.geopf.fr, module « IGN – fonds de carte ») : ces serveurs voient la zone de carte affichée.</p>
        <p><button type="button" class="small" @click=${() => { resetMapSettings(); resetMapLook(); }}>${icon('arrow-counterclockwise')} Options des cartes par défaut</button></p>
      </div>`;
  }

  /**
   * « Premiers pas »: the guided start (Découvrir), on or over; « Revoir les premiers pas » empties the three
   * activities around a place too, and makes the favourites their matches added the user's (core/discover.js
   * #restartDiscover) — said under it, and asked first.
   */
  #firstSteps() {
    const on = discovering();
    return html`<h2 id="first-steps">Premiers pas</h2>
      <p class="muted">${on ? 'Les premiers pas sont en cours : les onglets arrivent à mesure qu’ils servent, et restent. Un lien ouvre toujours son écran, et son onglet vient avec lui.'
        : `Tous les outils sont là. « Revoir les premiers pas » repart du début (Découvrir, puis les onglets un à un — Mes plantes reste si vous avez des favoris, des listes ou des lieux, la Carte si vous avez des lieux) : ${FIRST_STEPS_AGAIN}`}</p>
      <p>${on ? html`<button class="secondary" type="button" @click=${() => finishDiscover()}>Tout montrer maintenant</button>`
        : html`<button class="secondary" type="button" @click=${() => this.#restartFirstSteps()}>Revoir les premiers pas</button>`}</p>
      ${this._firstStepsError ? html`<p class="error" role="alert">${this._firstStepsError}</p>` : nothing}
      ${this.#showSteps()}`;
  }

  /**
   * « Revoir les premiers pas », confirmed: the first steps and the three activities around a place started again
   * (core/discover.js#restartDiscover), the maps' first-use hints too, then Découvrir — and the favourites that became
   * the user's, said. Nothing changes when it is cancelled, or when the favourites could not be read — said then, under
   * the button (the question answered, the user is told why nothing happened).
   */
  async #restartFirstSteps() {
    this._firstStepsError = null;
    if (!await confirmAsk({ title: 'Revoir les premiers pas ?', text: FIRST_STEPS_AGAIN[0].toUpperCase() + FIRST_STEPS_AGAIN.slice(1), yes: 'Revoir les premiers pas' })) return;
    const adopted = await restartDiscover().catch(error => { console.error(error); return null; });
    if (adopted === null) { this._firstStepsError = 'Impossible de lire vos favoris : rien n’a été changé. Réessayez dans un moment.'; return; }
    forgetHints();
    openView('#/discover');
    if (adopted) briefToast(adopted > 1 ? `Vos ${adopted} favoris venus des activités sont désormais à vous.` : 'Votre favori venu des activités est désormais à vous.');
  }

  /** « Afficher les étapes » of the activities (Rencontres, Parcours…): the first time each one is done, always, never. */
  #showSteps() {
    const value = this.#store.state.showSteps;
    const choices = /** @type {const} */ ([['auto', 'La première fois', 'pour chaque activité, jusqu’à ce qu’on l’ait menée une fois à son terme'], ['on', 'Toujours', ''], ['off', 'Jamais', 'chaque activité s’ouvre en entier']]);
    return html`<fieldset class="steps-choice">
      <legend>Afficher les étapes des activités</legend>
      ${choices.map(([key, label, note]) => html`<label><input type="radio" name="show-steps" value=${key} .checked=${value === key}
        @change=${() => setShowSteps(key)} /> ${label}${note ? html` <small class="muted">(${note})</small>` : nothing}</label>`)}
    </fieldset>
    <p class="muted">Le menu ⋯ d’une activité en décide pour elle seule, jusqu’à ce qu’on la recommence.</p>`;
  }
  /** « Disposition libre » (app/layout): the ready-made layouts, and one of one's own. */
  #layouts() {
    return html`<h2 id="disposition">Disposition libre</h2>
      <p class="muted">Un écran à composer avec les outils de GeoFlora côte à côte — la carte, la recherche, la fiche ou un seul de ses blocs, les photos,
        les cartes à swiper —, tous reliés : une plante choisie dans l’un s’affiche dans tous les autres, la zone choisie sur la carte filtre la recherche.
        Colonnes et lignes se redimensionnent ; la disposition s’écrit dans l’adresse, un lien la partage telle quelle.</p>
      <ul class="layouts">${PRESETS.map(p => html`<li><a href=${href.layout(p.spec)}><b>${p.title}</b><small>${p.about}</small></a></li>`)}</ul>
      <p><a class="button" href=${href.layout('')}>${icon('pencil')} Composer la mienne</a></p>`;
  }

  render() {
    const { meta, offline } = this.#store.state;
    return html`
      <article>
        <a class="back link" href=${floreHref()}>${icon(tabShown('flore') ? 'leaf' : 'binoculars')} Aller à ${floreName()}</a>
        <h1>À propos et réglages</h1>
        <p class="muted"><a href=${href.legal()}>${icon('shield-check')} Mentions légales et confidentialité</a> : qui publie GeoFlora, ce qui reste sur cet appareil, ce que reçoit chaque service en ligne (votre position surtout).</p>
        <a class="builder" href=${href.builder()}>${icon('window-desktop')}<span><b>Créer une app</b>
          <small>Une grille à diviser à volonté, puis un bloc dans chaque emplacement (carte, recherche, fiche…) : votre écran, partageable par un lien.</small></span>${icon('chevron-right')}</a>
        ${this.#firstSteps()}
        ${this.#layouts()}
        ${this.#sheetLayout()}

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
          Dans un lieu, c’est sa position GPS qui compte.</p>
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
          <strong>${modeLabel(this.#store.state.mode)}</strong>
        </p>
        <p class="muted">Épuré : grandes photos et actions rapides (ajouter d’un geste à la liste ou au lieu en cours). Standard : l’essentiel pour tous.
          Scientifique : toutes les données, locales et distantes. La grille des résultats a aussi son propre choix, qui revient au mode de l’application quand celui-ci change.</p>
        ${this.#modes()}

        ${this.#maps()}

        ${this.#modules()}

        <h2>Mode cueillette</h2>
        <label class="switch">
          <input type="checkbox" .checked=${this.#store.state.harvestMode} @change=${e => setHarvestMode(e.target.checked)} />
          <span>Journal de récolte, qualité, plantes « en saison » / « bientôt »</span>
        </label>
        <p class="muted">Désactivé, vos lieux restent de simples « plantes vues ici » ; rien n’est effacé.
          ${harvestModeChosen() ? nothing : 'Automatique tant que vous ne l’avez pas réglé : allumé dès que l’appareil contient des récoltes (un import, un lien de transfert), éteint au lancement s’il n’en contient aucune.'}</p>

        <h2>Mes plantes : favoris, listes et lieux</h2>
        <p class="muted">
          ${this._kept ? `Sur cet appareil uniquement : ${this._kept}.` : 'Rien d’enregistré sur cet appareil.'}
          ${(() => { const d = lastExportDate(); return d ? `Dernière sauvegarde : ${new Date(d).toLocaleDateString('fr-FR')}.` : 'Aucune sauvegarde pour l’instant.'; })()}
          Exportez régulièrement : effacer les données du navigateur efface aussi vos plantes.
        </p>
        <div class="row">
          <button class="primary" type="button" @click=${this.#export} ?disabled=${!this._spotCount && !notesWithText().length}>Exporter (fichier GeoJSON)</button>
          <label class="file button">Importer un fichier…
            <input type="file" accept=".geojson,.json,application/geo+json,application/json" @change=${this.#import} />
          </label>
        </div>
        ${this._spotMessage ? html`<p class="muted" role="status">${this._spotMessage}</p>` : nothing}

        <h2>Transférer vers un autre appareil</h2>
        <p class="muted">Un lien contient toutes vos plantes (compressées, sans passer par un serveur). Ouvrez-le sur l’autre téléphone ou ordinateur : elles y sont ajoutées ou mises à jour. Gardé dans un e-mail ou une note, il sert aussi de sauvegarde.</p>
        <label class="switch">
          <input type="checkbox" .checked=${this._personal} @change=${e => { this._personal = e.target.checked; }} />
          <span>Inclure mes notes et journaux de récolte</span>
        </label>
        <div class="row"><button class="primary" type="button" @click=${this.#transfer} ?disabled=${!this._spotCount && !(this._personal && notesWithText().length)}>Créer le lien de transfert</button></div>
        ${this._transfer ? html`<p class="muted" role="status">${this._transfer}</p>` : nothing}
        ${this.#diagnostic()}

      </article>
    `;
  }
}

customElements.define('gf-settings', GfSettings);
