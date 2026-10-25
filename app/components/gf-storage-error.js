// @ts-check
// IndexedDB that does not open (core/db.js StorageError, once tried again): the app cannot start. The banner says it in
// French, by its cause — what happened, what to try first (close the other tabs, restart the browser, free some
// space), the browser's own words folded away for support — and, where erasing the base can mend it (kind 'busy'),
// « Réparer le stockage »: asked first, in a dialog that says what comes back (from the backup copy of this device: its
// date, its favourites, collections, places and notes — or that there is none, and that they would be lost), what is
// downloaded again (the flora, the online services' answers) and what stays (settings, layouts, images and maps
// already seen). Confirmed: the base opened once more (it may open now: then nothing is erased — and, made again empty
// by the browser meanwhile, its collections come back as after a repair; failing now for another cause, a newer version
// or no room, nothing is erased either), the network checked (the flora must come back), the repair noted (the backup
// copy then held: collections.js restorePending), the base erased (db.js deleteDb; never localStorage) and the page
// reloaded on Mes plantes, where the collections come back by themselves (main.js restoreAfter). Once under way it
// cannot be cancelled, and never looks so: Échap does not close it while it works, « Masquer » only hides it while it
// waits for another tab, the banner says it is under way, and opened again (or after Back) the dialog shows its step.
// The backup copy can be downloaded as a file at every step: the one way out when the browser cannot erase the base
// either. Loaded by gf-app only then: never part of the start.

import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { backupContents, backupSummary, cancelRestore, downloadBackup, hasSpots, holdIfEmptied, lastExportDate, markRestore } from '../core/collections.js';
import { deleteDb, reopenDb, storageError } from '../core/db.js';
import { depth, openModal } from '../core/history.js';
import { timeoutSignal } from '../core/net.js';
import { href } from '../core/router.js';
import { store } from '../core/store.js';
import { ui } from '../styles/ui.js';
import { askStyles } from './ui-kit.js';

/** What happened and what to try, by cause (db.js openProblem). */
const ADVICE = {
  busy: {
    title: 'Le stockage de GeoFlora ne s’ouvre pas sur cet appareil.',
    text: 'Le navigateur n’arrive pas à ouvrir la base locale où sont gardées la flore, vos collections et vos notes. GeoFlora n’a rien effacé.',
    tries: ['fermez les autres onglets et fenêtres de GeoFlora, et l’application installée, puis Réessayer ;',
      'fermez complètement le navigateur et rouvrez-le (ou redémarrez l’appareil) ;',
      'vérifiez qu’il reste de la place sur l’appareil.'],
    last: 'Si rien n’y fait : réparez le stockage.'
  },
  newer: {
    title: 'Une version plus récente de GeoFlora a ouvert vos données.',
    text: 'Cette page est d’une version plus ancienne : elle ne peut pas les lire. Rien n’a été effacé.',
    tries: ['fermez les autres onglets de GeoFlora, puis Réessayer : la nouvelle version se chargera.'],
    last: ''
  },
  full: {
    title: 'Plus assez d’espace sur cet appareil.',
    text: 'Le stockage de GeoFlora ne peut pas s’ouvrir sans un peu de place. GeoFlora n’a rien effacé.',
    tries: ['libérez de l’espace (fichiers, applications, données d’autres sites), puis Réessayer.'],
    last: ''
  },
  blocked: {
    title: 'Le navigateur ne laisse pas GeoFlora enregistrer de données.',
    text: 'C’est le cas en navigation privée, ou quand les données des sites (cookies) sont bloquées dans ses réglages.',
    tries: ['ouvrez GeoFlora dans une fenêtre normale, ou autorisez les données de ce site dans les réglages du navigateur, puis Réessayer.'],
    last: ''
  }
};

/** Where the backup file is read back: the button and its section, in gf-settings' own words. */
const IMPORT_AT = '« Importer un fichier… » de Réglages › Mes plantes : favoris, listes et lieux';
/** @param {string} iso */
const when = iso => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/**
 * The page reloaded (at `hash`, if given), the dialog's step in history left out (core/history.js openModal: a step whose
 * dialog is gone would be skipped by Back). @param {string} [hash]
 */
function reload(hash) {
  history.replaceState({ gfDepth: depth() }, '', hash);
  location.reload();
}

/**
 * @typedef {'ask' | 'working' | 'blocked' | 'failed'} Step
 * @typedef {{ text: string, steps?: boolean, error?: { name: string, message: string } }} Failure
 */

export class GfStorageError extends LitElement {
  static properties = {
    problem: { attribute: false },
    _step: { state: true },
    _doing: { state: true },
    _failure: { state: true },
    _summary: { state: true }
  };

  static styles = [ui, askStyles, css`
    :host { display: block; }
    .banner { padding: 10px 16px 12px; font-size: 0.875rem; background: var(--gf-accent-soft); border-bottom: 2px solid var(--gf-danger); }
    .banner p, .banner ul { margin: 0 0 6px; }
    .banner ul { padding-left: 20px; }
    strong { color: var(--gf-danger); }
    .row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 8px 0 4px; }
    details { color: var(--gf-text-muted); font-size: 0.8rem; }
    details p { margin: 4px 0 0; overflow-wrap: anywhere; }
    dialog.ask ul, dialog.ask ol { margin: 0 0 16px; padding-left: 20px; color: var(--gf-text-muted); }
    dialog.ask li + li { margin-top: 6px; }
    dialog.ask .lost { color: var(--gf-danger); }
    dialog.ask p[tabindex] { outline: none; }
  `];

  constructor() {
    super();
    /** Why IndexedDB did not open, and what the browser said (main.js). @type {import('../core/store.js').StorageProblem} */
    this.problem = { kind: 'busy', name: '', message: '' };
    /** The repair's dialog: asked, under way, waiting for another tab, failed. @type {Step} */
    this._step = 'ask';
    /** What the repair is doing. */
    this._doing = '';
    /** @type {Failure | null} */
    this._failure = null;
    /** What the backup copy holds (localStorage: nothing writes it while the base does not open). */
    this._summary = backupSummary();
    /**
     * The repair's last try failed for another cause: the banner says it once the dialog is closed.
     * @type {import('../core/store.js').StorageProblem | null}
     */
    this._next = null;
  }

  render() {
    const advice = ADVICE[this.problem.kind] ?? ADVICE.busy;
    const repairable = this.problem.kind === 'busy';
    const underway = this._step === 'working' || this._step === 'blocked';
    // Only what happened is announced (role alert): what to try, the buttons and the details are read when reached.
    return html`<div class="banner">
        <p role="alert"><strong>${advice.title}</strong> ${advice.text}</p>
        <p>À essayer :</p>
        <ul>${advice.tries.map(t => html`<li>${t}</li>`)}</ul>
        ${repairable ? html`<p>${this._step === 'blocked' ? 'Réparation en attente : fermez GeoFlora ailleurs (autre onglet, autre fenêtre, application installée) ; la page se rechargera d’elle-même.'
          : underway ? 'Réparation en cours : la page se rechargera d’elle-même.' : advice.last}</p>` : nothing}
        <div class="row">
          <button class="primary" type="button" @click=${() => location.reload()}>Réessayer</button>
          ${repairable ? html`<button class="danger" type="button" @click=${this.#ask}>${underway ? 'Voir la réparation…' : 'Réparer le stockage…'}</button>` : nothing}
          ${this._summary ? html`<button class="link" type="button" @click=${() => downloadBackup()}>Télécharger la copie de secours</button>` : nothing}
        </div>
        ${this.#details(this.problem)}
      </div>
      ${repairable ? this.#dialog() : nothing}`;
  }

  /** What the browser said, folded away (for support). @param {{ name: string, message: string }} e */
  #details(e) {
    return html`<details><summary>Détails techniques</summary><p><code>${e.name || 'Erreur'}</code>${e.message ? ` — ${e.message}` : ''}</p></details>`;
  }

  /** The repair's dialog: its question — or, under way (closed by Back meanwhile), its step, which cannot be undone. */
  async #ask() {
    if (this._step !== 'working' && this._step !== 'blocked') {
      this._step = 'ask';
      this._failure = null;
      this._summary = backupSummary();
    }
    await this.updateComplete;
    openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.ask')));
  }

  /**
   * The step shown, the focus on it: its buttons are replaced, and `autofocus` acts only when the dialog opens (each step
   * has one element so marked: Annuler, the progress, Fermer).
   */
  async #focusStep() {
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('dialog.ask [autofocus]'))?.focus();
  }

  /** Under way, Échap does not close the dialog (it would look cancelled: it is not). @param {Event} event */
  #cancel(event) {
    if (this._step === 'working') event.preventDefault();
  }

  /** Closed: a cause found by the repair's last try now heads the banner (the dialog had to stay for its message). */
  #closed() {
    if (!this._next) return;
    const next = this._next;
    this._next = null;
    store.set({ storageError: next });
  }

  /** The repair's confirmation: what comes back, what is downloaded again, what stays — then its progress, or why it stopped. */
  #dialog() {
    const close = (/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close();
    const summary = this._summary;
    const download = summary ? html`<button class="link" type="button" @click=${() => downloadBackup()}>Télécharger la copie de secours</button>` : nothing;
    let body;
    let buttons;
    if (this._step === 'working' || this._step === 'blocked') {
      body = html`<p id="repair-text" role="status" tabindex="-1" autofocus>${this._step === 'blocked'
        ? 'En attente : GeoFlora est encore ouvert ailleurs (un autre onglet, une autre fenêtre ou l’application installée). Fermez-le : la réparation continue aussitôt.'
        : this._doing}</p>`;
      buttons = this._step === 'blocked' ? html`<button type="button" @click=${close}>Masquer (la réparation continue)</button>`
        : html`<button type="button" disabled>Réparation…</button>`;
    } else if (this._step === 'failed' && this._failure) {
      const f = this._failure;
      body = html`<p id="repair-text" role="alert">${f.text}</p>
        ${f.steps ? html`<ol>
          <li>Téléchargez la copie de secours (un fichier)${summary ? '' : ' : il n’y en a pas sur cet appareil'}.</li>
          <li>Fermez complètement le navigateur, ou redémarrez l’appareil, puis rouvrez GeoFlora.</li>
          <li>Si le problème reste : effacez les données de ce site dans les réglages du navigateur — cela efface aussi la copie de secours —,
            rouvrez GeoFlora, puis importez le fichier avec ${IMPORT_AT}.</li>
        </ol>` : nothing}
        ${f.error ? this.#details(f.error) : nothing}`;
      buttons = html`${download}<button type="button" autofocus @click=${close}>Fermer</button>`;
    } else {
      const exported = lastExportDate();
      body = html`<p id="repair-text">La base locale de GeoFlora sera effacée puis recréée, et la page rechargée.</p>
        <ul id="repair-what">
          ${summary ? html`<li>Reviennent de la copie de secours de cet appareil, du ${when(summary.savedAt)} : ${backupContents(summary)}.
            Ce qui aurait été modifié après cette date ne reviendrait pas.</li>`
          : html`<li class="lost">Aucune copie de secours sur cet appareil : vos favoris, collections, lieux et notes de fiche, s’il y en a,
            seraient perdus.${exported ? ` Votre dernier export date du ${when(exported)} : après la réparation, importez ce fichier avec ${IMPORT_AT}.` : ''}
            ${hasSpots() ? 'Cet appareil a déjà eu des collections : redémarrez d’abord le navigateur, la base s’ouvrira peut-être de nouveau.' : ''}</li>`}
          <li>Téléchargées de nouveau : la flore (une connexion est nécessaire) et les réponses des services en ligne gardées sur cet appareil,
            redemandées quand vous en aurez besoin.</li>
          <li>Restent : vos réglages, vos modes et mises en page, les activités en cours, les images et les cartes déjà vues.</li>
        </ul>`;
      buttons = html`${download}<button type="button" autofocus @click=${close}>Annuler</button>
        <button class="danger" type="button" @click=${this.#repair}>${summary ? 'Réparer le stockage' : 'Réparer et perdre mes collections et notes'}</button>`;
    }
    // What comes back and what is lost is part of the question (aria-describedby), not only what follows it.
    return html`<dialog class="ask" aria-labelledby="repair-title" aria-describedby="repair-text repair-what"
      @cancel=${this.#cancel} @close=${this.#closed}>
      <h2 id="repair-title">Réparer le stockage ?</h2>
      ${body}
      <div class="row">${buttons}</div>
    </dialog>`;
  }

  /** @param {string} text @param {Omit<Failure, 'text'>} [more] */
  #stop(text, more = {}) {
    this._failure = { text, ...more };
    this._step = 'failed';
    this.#focusStep();
  }

  async #repair() {
    this._step = 'working';
    this._doing = 'Nouvel essai d’ouverture du stockage…';
    this.#focusStep();
    // Opening now (the other tabs closed, a moment later): nothing to erase. Made again, empty, by the browser meanwhile
    // (a damaged store): what the backup copy holds comes back as after a repair — on Mes plantes.
    try {
      await reopenDb();
      reload(holdIfEmptied() ? href.collections() : undefined);
      return;
    } catch (error) {
      // Failing now for another cause — a newer GeoFlora opened it meanwhile, no room, storage blocked: erasing would not
      // mend it, or would lose what the newer version keeps. Said, and the banner follows that cause once closed.
      const e = storageError(error);
      if (e && e.kind !== 'busy') {
        const cause = /** @type {any} */ (e.cause);
        const advice = ADVICE[e.kind];
        this._next = { kind: e.kind, name: cause?.name || e.name, message: cause?.message || '' };
        this.#stop(`Réparation arrêtée, rien n’a été effacé. ${advice.title} À essayer : ${advice.tries.join(' ')}`,
          { error: { name: this._next.name, message: this._next.message } });
        return;
      }
    }
    // The flora comes back from the network only: none, nothing is erased.
    this._doing = 'Vérification de la connexion…';
    try {
      const response = await fetch(config.metaUrl, { cache: 'no-cache', signal: timeoutSignal(8000) });
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
    } catch {
      this.#stop('Pas de connexion : la flore ne pourrait pas être téléchargée de nouveau. Rien n’a été effacé ; réessayez une fois en ligne.');
      return;
    }
    // The backup copy held before anything is erased (put back at the next launch), or nothing is erased.
    const restoring = Boolean(this._summary = backupSummary());
    if (restoring && !markRestore()) {
      this.#stop('Réparation impossible : la copie de secours ne peut pas être protégée (stockage du navigateur plein). Rien n’a été effacé.');
      return;
    }
    this._doing = 'Effacement de la base locale…';
    try {
      await deleteDb(() => { this._step = 'blocked'; });
    } catch (error) {
      console.error(error);
      if (restoring) cancelRestore();
      const e = /** @type {Error} */ (error);
      this.#stop('La réparation n’a pas abouti : le navigateur ne peut pas non plus effacer la base. Rien n’a été effacé.',
        { steps: true, error: { name: e?.name || 'Erreur', message: e?.message || '' } });
      return;
    }
    // Reloaded on Mes plantes, where the collections come back (main.js).
    reload(restoring ? href.collections() : undefined);
  }
}

customElements.define('gf-storage-error', GfStorageError);
