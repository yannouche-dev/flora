// @ts-check
// « Mentions légales et confidentialité » (#/legal, from Réglages): who publishes the app, what stays on the device,
// what each online service receives (the position above all) and when, and how to forget it. The services named
// here are the modules of modules.js: a description changed there should be changed here too.
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import * as db from '../core/db.js';
import { forgetFailures } from '../core/cache.js';
import { discoverState, forgetDiscoverPoint } from '../core/discover.js';
import { ui } from '../styles/ui.js';

/** The publisher's name or pseudonym, as the law asks it shown (LCEN, art. 6). To be filled in by the owner. */
const PUBLISHER = 'yannouche-dev (propriétaire du dépôt GitHub du projet)';
const REPO = 'https://github.com/yannouche-dev/flora';

/**
 * What each service receives. `position`: what of a position it gets, and when; the rest is plant names.
 * @type {{ name: string, hosts: string, what: string, position: string }[]}
 */
const SERVICES = [
  { name: 'IGN – Géoplateforme', hosts: 'data.geopf.fr, apicarto.ign.fr',
    what: 'Les tuiles des cartes de la zone affichée ; le texte d’une adresse cherchée ; les coordonnées d’un point ou d’un lieu (adresse, altitude, zones naturelles, espaces protégés).',
    position: 'Votre position, quand Découvrir ou le Parcours botanique cherchent le nom de la commune où vous êtes, et la position de chaque lieu et de chaque plante notés (adresse, altitude).' },
  { name: 'iNaturalist', hosts: 'api.inaturalist.org',
    what: 'Les noms des plantes (observations, floraison, photos).',
    position: 'Le centre du cercle de recherche d’Autour, de Découvrir et des observations autour de moi : votre position précise quand vous touchez « Autour de moi », sinon le lieu ou la commune choisis.' },
  { name: 'GBIF', hosts: 'api.gbif.org',
    what: 'Les noms des plantes (descriptions, occurrences, photos, planches d’herbier).',
    position: 'Votre position, seulement quand vous demandez « Près d’ici » ou « Observations autour de moi » sur une fiche.' },
  { name: 'Open-Meteo', hosts: 'archive-api.open-meteo.com, air-quality-api.open-meteo.com',
    what: 'Les coordonnées d’un lieu (climat) et des occurrences d’une espèce (niche climatique).',
    position: 'Votre position arrondie à 100 m, seulement quand vous demandez le pollen ou le climat « ici ».' },
  { name: 'Wikipédia, Wikidata, Wikibooks, Wikimedia Commons', hosts: 'fr.wikipedia.org, www.wikidata.org, query.wikidata.org, fr.wikibooks.org, en.wikibooks.org, commons.wikimedia.org',
    what: 'Les noms des plantes (articles, identifiants, recettes, photos).', position: 'Jamais.' },
  { name: 'GloBI', hosts: 'api.globalbioticinteractions.org', what: 'Les noms des plantes (interactions).', position: 'Jamais.' },
  { name: 'Trefle', hosts: 'trefle.io', what: 'Les noms des plantes et votre jeton personnel, si vous en avez saisi un.', position: 'Jamais.' },
  { name: 'Serveurs des photos', hosts: 'thumb.wikimedia.org, upload.wikimedia.org, inaturalist-open-data.s3.amazonaws.com, static.inaturalist.org, serveurs d’images des herbiers',
    what: 'La demande de chaque image affichée (module « Photos en ligne »).', position: 'Jamais.' },
  { name: 'Dictée vocale du navigateur', hosts: 'selon le navigateur (Google pour Chrome, Apple pour Safari)',
    what: 'Le son enregistré quand vous touchez le micro.', position: 'Jamais.' }
];

export class GfLegal extends LitElement {
  static properties = {
    _done: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; padding: 16px; }
    article { max-width: 720px; margin: 0 auto; }
    .back { font-size: 0.9rem; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1rem; margin-top: 28px; }
    p, li, dd { font-size: 0.9rem; line-height: 1.5; }
    a { color: var(--gf-accent); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
    dt { color: var(--gf-text-muted); font-size: 0.9rem; }
    dd { margin: 0; }
    .services { list-style: none; padding: 0; display: grid; gap: 8px; }
    .services li { padding: 8px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); }
    .services .hosts { display: block; color: var(--gf-text-muted); font-size: 0.8rem; overflow-wrap: anywhere; }
    .services .pos { display: block; margin-top: 2px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
    .done { color: var(--gf-text-muted); font-size: 0.85rem; }
    @media (max-width: 520px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
  `];

  constructor() {
    super();
    /** What the last button did. @type {string | null} */
    this._done = null;
  }

  #forgetPosition() {
    forgetDiscoverPoint();
    this._done = 'Dernière position de Découvrir oubliée.';
  }

  /** The answers of the online services kept on the device (some hold the coordinates searched), and their images and map tiles. */
  async #clearCache() {
    if (!confirm('Effacer les réponses des services en ligne gardées sur cet appareil, avec les images et les cartes déjà vues ? Vos lieux, collections et réglages restent.')) return;
    await db.clear('plantDetails').catch(() => {});
    forgetFailures();
    try {
      for (const key of await caches.keys()) if (key.startsWith('geoflora-images') || key === 'geoflora-tiles') await caches.delete(key);
    } catch { /* no Cache Storage */ }
    this._done = 'Réponses, images et cartes gardées en cache effacées.';
  }

  render() {
    document.title = 'Mentions légales et confidentialité — GeoFlora';
    const kept = discoverState().point;
    return html`<article>
      <a class="back link" href=${href.settings()}>${icon('arrow-left')} Réglages</a>
      <h1>Mentions légales et confidentialité</h1>

      <h2>Éditeur et hébergeur</h2>
      <dl>
        <dt>Application</dt><dd>GeoFlora, flore de France, gratuite et non commerciale. Code source public : <a href=${REPO} target="_blank" rel="noopener">${REPO.replace('https://', '')}</a></dd>
        <dt>Éditeur, directeur de la publication</dt><dd>${PUBLISHER}</dd>
        <dt>Contact</dt><dd><a href=${REPO + '/issues'} target="_blank" rel="noopener">Issues du dépôt GitHub</a> : une question, une erreur, une demande de retrait</dd>
        <dt>Hébergeur</dt><dd>GitHub Pages — GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis</dd>
      </dl>
      <p>Une erreur dans les données de sécurité (une plante toxique sans alerte, une confusion manquante, un statut de protection faux) se signale sans attendre dans une issue, en citant la plante. Une faille de sécurité, elle, se signale en privé : voir <a href=${REPO + '/blob/main/SECURITY.md'} target="_blank" rel="noopener">SECURITY.md</a>.</p>
      <p>GeoFlora ne remplace ni un botaniste, ni un médecin : ne consommez jamais une plante sur la seule foi de l’application. En cas d’ingestion d’une plante suspecte, appelez un <a href="https://centres-antipoison.net/" target="_blank" rel="noopener">Centre antipoison</a>, ou le 15 ou le 112.</p>

      <h2>Ni compte, ni publicité, ni mesure d’audience</h2>
      <p>GeoFlora n’a ni compte, ni publicité, ni outil de mesure d’audience ou de suivi, ni cookie. L’éditeur ne reçoit aucune donnée vous concernant : l’application est un ensemble de fichiers servis par GitHub Pages, qui, comme tout hébergeur, voit l’adresse IP de qui les télécharge.</p>

      <h2>Ce qui reste sur cet appareil</h2>
      <ul>
        <li>La flore (espèces, noms, statuts, données de toxicité), pour fonctionner hors ligne.</li>
        <li>Vos lieux, collections, favoris, parcours, récoltes et notes, avec leur position GPS, et leur copie de secours. Ils ne quittent l’appareil que si vous les exportez ou les partagez (un lien de partage porte les données dans l’adresse après « # », que le serveur ne reçoit pas).</li>
        <li>Vos réglages : modes d’affichage, modules, mise en page des fiches, région, recherches récentes, jeton Trefle si vous en avez saisi un.</li>
        <li>Le dernier lieu de Découvrir (votre position, ou la commune choisie), pour reprendre là à la prochaine visite${kept ? '' : ' (aucun pour le moment)'}.</li>
        <li>Les réponses des services en ligne, de 7 jours à un an pour les altitudes (certaines portent les coordonnées cherchées), et les images et cartes déjà vues, pour les revoir hors ligne.</li>
      </ul>
      <div class="row">
        <button class="secondary" type="button" ?disabled=${!kept} @click=${this.#forgetPosition}>${icon('geo-alt')} Oublier ma dernière position</button>
        <button class="secondary" type="button" @click=${this.#clearCache}>${icon('trash3')} Effacer le cache des services en ligne</button>
      </div>
      ${this._done ? html`<p class="done" role="status">${this._done}</p>` : nothing}
      <p>Pour tout effacer, y compris vos lieux : effacez les données du site dans les réglages du navigateur (exportez d’abord vos lieux depuis <a href=${href.settings()}>Réglages</a> pour les garder).</p>

      <h2>Votre position</h2>
      <p>Le navigateur ne demande votre position qu’après un geste de votre part : « Autour de moi », « Me localiser », « Commencer ici », « Noter ici », « Près d’ici »… Une fois l’autorisation accordée, les cartes et les listes de lieux s’en servent aussi (distances, votre point sur la carte) ; vous pouvez la retirer à tout moment dans les réglages du navigateur. Avant chaque envoi, l’écran dit à quel service elle part. Elle n’est jamais envoyée à l’éditeur.</p>

      <h2>Ce que reçoivent les services en ligne</h2>
      <p>Chaque service ci-dessous est un module, que vous pouvez couper dans <a href=${href.settings()}>Réglages › Modules</a> : il n’est alors plus appelé. Tous voient, comme pour toute page web, votre adresse IP et votre navigateur, et appliquent leur propre politique de confidentialité.</p>
      <ul class="services">
        ${SERVICES.map(s => html`<li><strong>${s.name}</strong><span class="hosts">${s.hosts}</span>${s.what}<span class="pos">${icon('geo-alt-fill')} Position : ${s.position}</span></li>`)}
      </ul>
      <p>Un lien vers un autre site (INPN, Tela Botanica, une source citée…) ouvre ce site, dans un onglet ou dans un volet « Page web » de la fiche : c’est alors ce site qui vous sert la page.</p>

      <h2>Données et licences</h2>
      <p>La flore vient de TAXREF (PatriNat), les floraisons de Baseflor (Ph. Julve, Tela Botanica), les statuts de protection de l’INPN, les données de toxicité de l’ANSM et d’Agroscope (base TPPT, usage non commercial), les plantes à confondre de l’Anses et des Centres antipoison. Les bases assemblées par GeoFlora sont diffusées sous licence ODbL 1.0, comme le demande Baseflor : sources et licences dans <a href=${REPO + '/blob/main/data/LICENSE'} target="_blank" rel="noopener">data/LICENSE</a>. Chaque photo reste sous sa propre licence, créditée sous l’image. Le code de l’application est sous licence <a href=${REPO + '/blob/main/LICENSE'} target="_blank" rel="noopener">MIT</a>.</p>
    </article>`;
  }
}

customElements.define('gf-legal', GfLegal);
