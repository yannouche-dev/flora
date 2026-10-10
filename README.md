# GeoFlora — flore française

Référentiel léger destiné à une application de recherche dans la flore vasculaire de France métropolitaine.

## Dataset local

Le build TAXREF v18 produit actuellement :

- **7 745 espèces**
- **180 familles**
- **1 245 genres**
- **15 487 noms vernaculaires français uniques**
- **33 121 synonymes scientifiques**
- **7 177 espèces** avec au moins un nom français
- **568 espèces** sans nom français disponible dans les données TAXREF utilisées
- **3 504 espèces** avec une vignette de recherche Wikimedia Commons (**45,24 %**)

Le principe est simple :

- **IndexedDB locale** = recherche, tri, filtres et données taxonomiques de base ;
- **sources ouvertes distantes** = vignette, photos, répartition, descriptions, traits et liens détaillés ;
- les images ne sont **pas téléchargées dans le dataset**.

## Structure d'une plante

`data/plants.json` contient notamment :

```json
{
  "id": 100225,
  "family": "Rosaceae",
  "genus": "Geum",
  "species": "urbanum",
  "scientificName": "Geum urbanum",
  "author": "L.",
  "vernacularNames": [
    "Benoîte des villes",
    "Benoîte commune",
    "Herbe de saint Benoît"
  ],
  "synonyms": [],
  "flowering": [4, 10],
  "status": {
    "france": "P"
  },
  "identifiers": {
    "taxref": 100225
  },
  "links": {
    "taxref": "https://taxref.mnhn.fr/taxref-web/taxa/100225",
    "inpn": null
  },
  "thumbnail": {
    "url": "https://upload.wikimedia.org/...",
    "source": "Wikimedia Commons",
    "sourceUrl": "https://commons.wikimedia.org/...",
    "author": "...",
    "license": "CC BY-SA 4.0"
  }
}
```

Les identifiants externes (GBIF, iNaturalist, Wikidata, Trefle) sont volontairement résolus **à la demande** au lieu d'être recalculés pour les 7 745 espèces à chaque build.

## Source et sélection

Le générateur utilise l'archive officielle **TAXREF v18** diffusée par PatriNat/MNHN :

- `TAXREFv18.txt` pour taxonomie, auteurs, synonymes et statut en France métropolitaine ;
- `TAXVERNv18.txt` pour les noms vernaculaires.

Filtres actuels :

- règne `Plantae` ;
- rang espèce `ES` ;
- nom accepté uniquement (`CD_NOM = CD_REF`) ;
- groupe TAXREF `Trachéophytes` ;
- présence en France métropolitaine ;
- statuts `P N E S C I J`.

Les synonymes TAXREF de rang espèce sont rattachés au taxon accepté. Les noms français portés par ces synonymes sont également rattachés à l'espèce acceptée.

**Statuts de protection** : `scripts/enrich-statuses.mjs` ajoute `statuses` depuis la **Base de connaissance Statuts** de l'INPN (PatriNat — OFB, MNHN, CNRS ; données ouvertes, archive `BDC.zip`), rapprochée par identifiant TAXREF (`CD_REF`). Sont retenus : protections **nationale** (`PN`), **régionale** (`PR`) et **départementale** (`PD`), **réglementation de la cueillette** (`REGL`), et **listes rouges** nationale (`LRN`) et régionales (`LRR`) pour les seules catégories menacées (RE, CR, EN, VU, NT). Chaque statut garde son territoire (`area`, `level`, `iso`) et l'intitulé du texte (`label`) ; les territoires d'outre-mer sont écartés. Si le téléchargement échoue, le jeu de données est publié sans statuts.

**Territoires** : `data/territories.json` (généré par `scripts/build-territories.mjs`) contient les contours simplifiés des départements métropolitains (d'après IGN ADMIN EXPRESS via france-geojson, Licence Ouverte), avec leur région actuelle et leur **ancienne région** : beaucoup d'arrêtés régionaux de protection nomment encore les régions d'avant 2016.

**Floraison** : `scripts/enrich-baseflor.mjs` ajoute `flowering: [premier mois, dernier mois]` (1–12 ; un dernier mois plus petit que le premier signifie une floraison à cheval sur l'année) depuis **Baseflor**, l'index botanique, écologique et chorologique de la flore de France de Philippe Julve (programme CATMINAT), diffusé par [Tela Botanica](https://www.tela-botanica.org/ressources/donnees/telechargements/) : données sous licence **CC BY-SA 2.0**, base sous **ODbL 1.0**. Le tableau (`baseflor.xlsx`, colonne `floraison` au format « 6-9 ») est récupéré dans le porte-documents Tela Botanica (Cumulus). Le rapprochement se fait par identifiant TAXREF (`CD_REF`), sinon par binôme latin (nom accepté, puis synonymes TAXREF) ; la ligne de l'espèce l'emporte sur celles de ses sous-espèces. Une autre adresse peut être imposée par la variable de dépôt `BASEFLOR_URL`. Environ la moitié des espèces ont une floraison renseignée dans Baseflor (case vide pour certaines plantes courantes, comme l'ail des ours ou l'ortie) ; pour les autres, le calendrier s'appuie sur les observations iNaturalist. Si le téléchargement échoue, le jeu de données est publié sans floraison.

## Enrichissement distant

`lib/plant-sources.mjs` fournit une couche ES6 sans dépendance pour enrichir une plante au moment où elle devient visible ou lorsque l'utilisateur ouvre sa fiche.

Sources actuellement prises en charge :

- **GBIF** : correspondance avec le Backbone GBIF (`species/match`, plantes seulement), descriptions, noms vernaculaires, répartition, profils d'espèce (habitat, port, envahissante), synonymes, catégorie UICN, publications ; occurrences en France (présences seulement, coordonnées sans problème connu) : nombre, par mois, par année, régions et départements (GADM), types de relevés, principales sources, carte de densité (tuiles GBIF), les plus proches de vous ; images d'occurrences sous licence libre (CC0, CC BY, CC BY-SA), photos d'observation et planches d'herbier à part. Chaque donnée n'est demandée que si son bloc ou sous-bloc est affiché ;
- **iNaturalist** : taxon, nombre d'observations et photo par défaut lorsque sa licence est libre ; **phénologie** : observations en France par mois, annotées « en fleurs » / « en fruits » (`phenology()`, histogramme `month_of_year`, `place_id=6753`) ;
- **Wikidata** : résolution sûre par propriété taxonomique `P225` ;
- **Wikimedia Commons** : photos libres avec URL, miniature, auteur et licence ;
- **Trefle** : taxon, image principale et fiche détaillée (token gratuit requis).

Exemple :

```js
import { PlantSources } from './lib/plant-sources.mjs';

const sources = new PlantSources({
  trefleToken: null
});

// Pour une ligne visible dans la liste :
const thumbnail = await sources.thumbnail(plant);

// Quand la fiche est ouverte :
const details = await sources.details(plant);
```

Avec un token Trefle :

```js
const sources = new PlantSources({
  trefleToken: 'YOUR_TREFLE_TOKEN'
});
```

Trefle impose actuellement un token et une limite standard de 60 requêtes par minute. Pour une application publique, il est préférable de placer le token derrière un petit proxy si le quota doit être protégé.

### Politique média

Par défaut, GeoFlora préfère uniquement les médias dont la licence est clairement compatible avec une réutilisation libre :

- CC0 / domaine public
- CC BY
- CC BY-SA

Les images iNaturalist sous CC BY-NC ou sans licence exploitable ne sont pas choisies automatiquement. Les résultats Wikimedia Commons sont filtrés de la même manière.

Trefle reste disponible pour ses données structurées et ses images par organes, mais une image dont la licence précise n'est pas vérifiée n'est pas utilisée automatiquement comme miniature, sauf avec l'option :

```js
new PlantSources({
  trefleToken: '...',
  allowUnverifiedMedia: true
});
```

## Architecture GeoFlora

```text
Recherche / filtres
        │
        ▼
IndexedDB
7 745 espèces
        │
        ├── famille
        ├── genre
        ├── espèce
        ├── noms vernaculaires
        ├── synonymes
        └── statut TAXREF
        │
        ▼
Liste de résultats
        │
        ├── données locales immédiates
        └── thumbnail.url déjà présent dans plants.json
        │
        ▼
Fiche plante
        │
        ├── photos / organes
        ├── répartition
        ├── descriptions
        ├── traits
        ├── observations
        └── ressources externes
```

Les réponses distantes peuvent être mises en cache quelques heures ou quelques jours dans IndexedDB. Les fichiers image restent servis par leur source et profitent simplement du cache HTTP du navigateur.

## Application web

GeoFlora est une application HTML5 **sans serveur et sans étape de build** : des modules ES natifs, des composants [Lit](https://lit.dev) et un service worker écrit à la main. Elle est publiée telle quelle sur GitHub Pages et fonctionne hors ligne après la première visite.

```text
index.html               shell + import map ("lit", "leaflet" → vendor/)
manifest.webmanifest     PWA installable
sw.js                    service worker (shell précaché, images et tuiles IGN en cache)
vendor/                  Lit 3 et Leaflet 1.9 en modules ES autonomes (scripts/vendor.sh)
lib/plant-sources.mjs    enrichissement distant (réutilisé tel quel)
app/
  main.js                démarrage : synchro du dataset → index de recherche
  config.js
  core/
    db.js                IndexedDB : plants, plantDetails, meta, spots (reconnexion automatique)
    dataset.js           synchro data/plants.json → IndexedDB selon meta.generatedAt
    search.js            client du worker de recherche
    query.js             requête (texte, filtres, tri) ↔ URL, recherches récentes
    highlight.js         surlignage insensible aux accents
    sources.js           PlantSources + cache IndexedDB persistant (7 jours)
    collections.js       favoris, listes et lieux (GeoJSON), saison, distances, export/import
    share.js             partage par lien (collections encodées dans l'URL)
    place-model.js       format d'une collection, migrations des anciens formats
    geo.js               suivi GPS partagé
    ign.js               couches IGN Géoplateforme (WMTS) pour Leaflet
    store.js             état observable + ReactiveController Lit
    router.js            routes par hash : #/, #/plant/:id, #/map, #/spot/:id, #/settings
  workers/
    search.worker.js     recherche, filtres à facettes, tri, abréviations, fautes de frappe
  components/            gf-app, gf-search-bar, gf-results-bar, gf-active-filters,
                         gf-filter-panel, gf-facet, gf-plant-list (virtualisée),
                         gf-plant-card, gf-plant-detail, gf-attribution, gf-settings,
                         gf-map (Leaflet), gf-map-page, gf-spot-editor, gf-plant-spots
  styles/                tokens.css (thème clair/sombre), app.css, map.css
```

### Icônes

Toutes les icônes de l'application sont des [Bootstrap Icons](https://icons.getbootstrap.com) (licence MIT) : un seul fichier `assets/icons/bi.svg` ne contenant que celles utilisées (38), mis en cache hors ligne, et `icon('heart')` (`app/core/icons.js`) pour les afficher. Elles prennent la taille et la couleur du texte. Pour en ajouter une : son nom dans `scripts/build-icons.mjs`, puis `node scripts/build-icons.mjs <dossier du paquet bootstrap-icons>`. Sur téléphone, le bouton des filtres est une icône d'entonnoir (pleine quand un filtre est actif, avec leur nombre) ; « Compact » et « Partager » au-dessus des résultats sont aussi des icônes.

### Onglet Flore : filtres, résultats, plante

- **Ordinateur** : trois panneaux côte à côte, **Filtres ┃ Résultats ┃ Plante**. Chacun se replie (« / ») en une fine barre verticale et se redimensionne en tirant les séparateurs (ou ←/→ au clavier, double-clic pour la largeur par défaut) ; largeurs et panneaux repliés sont mémorisés. Toucher un résultat ouvre la fiche dans le panneau Plante (l'adresse `#/plant/<id>` reste partageable) ; ⤢ la passe en pleine largeur, × la ferme.
- **Recherche** en haut des résultats (« Ex. : ortie, Urtica dioica, ger rob, Lamiaceae »).
- **Grille des résultats** : Photo, Nom français, puis Famille, Genre, Espèce (l'épithète, le genre ayant sa colonne), Statut, Protection, et les actions ♥ (favori) et 📍 (noter où je la trouve ; pleine si la plante est déjà dans un de mes lieux, elle ouvre alors la carte). Trois affichages, au choix par les icônes au-dessus de la grille (lignes · photo · tableau) : **Standard** (sans statut ni protection), **Épuré** (grandes photos, nom français sur le nom scientifique complet) et **Scientifique** (toutes les colonnes, auteur compris). Cliquer un en-tête trie par cette colonne, recliquer inverse l'ordre (`sort=-family` dans l'URL) ; un en-tête dont le filtre est actif affiche son nombre de valeurs, qui ouvre ce filtre. Quand le panneau est étroit, Genre (et Statut) se masquent, puis la liste repasse en fiches.
- **Tablette** : filtres en feuille, Résultats ┃ Plante. **Téléphone** : fiches, et la plante s'ouvre en plein écran par-dessus la liste (« ← Résultats » revient au même endroit).
- **Fiche plante : des blocs** : la fiche est faite des mêmes blocs dans les trois modes, en-tête compris : Nom, Photos, Protection et statuts, Plantes à confondre, Classification, Mes collections, Calendrier, Wikipédia, Descriptions, Noms, Occurrences et répartition, Carte, Médias GBIF, Habitat et écologie (GBIF), Trefle, Publications (GBIF), Identifiants, Ressources, et les blocs Note que l'on crée. Chacun est montré à la manière du mode (compact en Épuré, complet en Scientifique ; en Épuré, Noms n'est que la liste des noms français, style réglable en mode King ; Noms (TAXREF et GBIF, en français ; les autres langues seulement si « Autres langues » est coché) ne reprend pas le nom sous lequel la plante est affichée ni les doublons, et n'apparaît pas si la plante n'a pas d'autre nom ; de même, Wikipédia n'apparaît pas sans article) ; par défaut Nom, Photos et Wikipédia se lisent sans titre (le résumé Wikipédia porte sa source : « Source : article Wikipédia »), au choix en mode King ; un bloc sans donnée pour la plante le dit. Certains ont des **sous-blocs** (les lignes de Classification, Occurrences, Noms, Protection, chaque lien de Ressources et chaque Identifiant).
- **Menu des catégories** : à gauche de la fiche (une bande d'icônes en haut quand la fiche est étroite), une icône par catégorie de ses blocs — Noms, Images, Protection et risques, Saisons, Répartition, Écologie et climat, Savoirs, Territoire, Outils. Toucher une icône mène au premier bloc de la catégorie (la fiche y défile, le bloc s'éclaire ; épinglé, le volet se déplie ; placé en volet, le volet s'ouvre : Images → la visionneuse) ; au survol, la liste de ses blocs (Savoirs → Usages et cuisine sauvage, Descriptions…). L'icône de la catégorie lue s'allume pendant le défilement.
- **Barre d'actions** : Favori, Ajouter à… (choisir une collection ou un lieu), Partager, Noter ici, dans une barre fixée en bas de la fiche (au-dessus du menu sur téléphone), toujours à portée pendant le défilement. Chaque action s'affiche ou non, et s'ordonne, pour chaque mode : en mode King, une case ☑ sur chaque bouton de la barre ; dans *Réglages › Mode King › Barre d'actions*, la liste à cocher et à glisser.
- **Mode King** (en haut des *Réglages*) : le mode d'édition de la fiche. Une couronne dorée s'affiche en bas de l'écran tant qu'il est actif ; la toucher quitte le mode (elle disparaît). Tout est enregistré automatiquement, pour chaque mode d'affichage :
  - **ordre** : glisser un bloc par son titre (souris ou doigt ; pendant le glisser, les blocs se replient sur leur titre ; ↑ ↓ au clavier sur sa poignée ⠿) ; les sous-blocs s'ordonnent depuis l'icône « Sous-blocs » de leur bloc ;
  - **présence** : la corbeille masque un bloc (il reste, estompé, avec ↺ pour le réafficher ; hors mode King il n'apparaît pas et n'est pas chargé), une case masque un sous-bloc. Masquer un bloc de service (Photos, Wikipédia, Trefle) coupe ce module dans ce mode, comme dans *Réglages › Modules*, et inversement ; GBIF a plusieurs blocs, masqués un à un : le module n'est coupé qu'avec le dernier, et réafficher l'un d'eux le rallume ;
  - **masqué si vide** : l'icône « œil barré » d'un bloc qui peut n'avoir rien pour une plante (Protection, Plantes à confondre, Mes collections, Calendrier, Photos, Wikipédia, Descriptions, Noms, Occurrences, Médias GBIF, Habitat, Trefle, Publications, blocs Note) le retire de la fiche hors mode King quand il est vide, au lieu d'afficher « Aucune… » ; pour chaque mode (par défaut : Wikipédia, Noms, Habitat et Publications) ;
  - **titres** : ✎ renomme un bloc (vide : son nom d'origine) ;
  - **titre affiché ou caché** : l'icône « H2 » montre ou cache le titre d'un bloc hors mode King, pour chaque mode (par défaut Nom, Actions, Photos et Wikipédia sont sans titre) ;
  - **style** : certains blocs ont deux styles, au choix pour chaque mode (Noms : « Liste », les noms français seuls, par défaut en Épuré ; ou « Tableau », avec les autres langues et les sources) ;
  - **blocs Note** : « + Bloc Note » crée un bloc nommé, avec un texte libre par plante, gardé sur l'appareil ; ✕ le supprime avec ses textes ;
  - **blocs Carte** : la fiche a un bloc « Carte », et « + Bloc Carte » en ajoute d'autres, placés, renommés et masqués comme les autres blocs (✕ supprime une carte ajoutée). L'engrenage ⚙ d'une carte règle, pour tous les modes :
    - ce qu'elle montre, à cumuler : répartition GBIF (France ou monde), mes lieux de cette plante (et chaque plant à sa position), observations proches (iNaturalist, GBIF ou les deux, dans le rayon d'« Autour » ; la position n'est demandée qu'au premier toucher de « Observations autour de moi ») ;
    - son fond (plan IGN ou photos aériennes) et ses couches IGN (cadastre, courbes, forêts publiques, espaces protégés), propres à cette carte : le bouton « couches » de la carte les change aussi, sans toucher au choix de l'onglet Carte ;
    - son cadrage (France entière, ajusté à ce qui est affiché, autour de moi) et sa hauteur ;
    - ses actions : « Ouvrir dans la Carte » (l'onglet Carte filtré sur la plante, avec sa répartition GBIF), créer un endroit ici (appui long : le nouvel endroit contient déjà la plante), déplacer mes plants (✎), « Noter ici », « Me localiser ». Toucher un de mes lieux l'ouvre ; toucher une observation ouvre sa page ;
  - **position** (l'icône de position sur le titre d'un bloc — une croix ↑ ← fiche → ↓ et « À côté » —, ou le menu « Position » dans *Réglages › Mode King*) : chaque bloc est **dans la fiche** (le défilement), **collé à un bord du panneau Plante** — en haut, en bas, à gauche, à droite — ou **à côté** de la fiche (le volet, ci-dessous), pour chaque mode. Plusieurs bords à la fois (par exemple la carte à gauche et les médias en bas) ; la fiche défile entre eux. Plusieurs blocs sur un même bord en sont les onglets. Sur une fiche étroite (téléphone), gauche et droite deviennent des bandes en haut ; les bandes laissent toujours de la place à la fiche. Le panneau Plante de Flore et de Mes plantes s'élargit quand un bord gauche ou droit est utilisé. Les mises en page des versions précédentes (blocs épinglés, blocs en volet) sont reprises telles quelles.
  - **options d'un bord** (sa barre) : taille S / M / L, ou tirer sa bordure intérieure (la taille tirée est gardée) ; ⚙ **Pleine largeur du panneau** (une bande en haut ou en bas passe sous les colonnes : les médias en très grand), **Sans titre ni cadre** (le bloc remplit le bord, ses onglets et « agrandir » flottent dessus), **Replié** (la barre seule, le bord s'ouvre au toucher) ; **Agrandir** : le bord occupe tout le panneau Plante le temps de regarder (Échap ou le bouton le remet). Le menu des catégories ouvre le bon onglet et déplie son bord.
  - **tableau ou liste** : les données en lignes (Occurrences : régions et départements, types de relevés, sources ; Habitat et écologie ; Publications ; Identifiants) se lisent en **tableau** par défaut (valeur, nombre, part avec une petite barre), ou en **liste** compacte, au choix pour chaque mode.
  - **Réglages › Mode King** : les mêmes listes pour chaque mode (glisser : toute la ligne à la souris, la poignée au doigt), avec leurs sous-blocs, « Par défaut », « Nouveau bloc Note », **Exporter / Importer la mise en page** (un fichier JSON : ordre, blocs et sous-blocs masqués, titres, blocs Note et leurs textes) et « Tout réinitialiser » — ces trois boutons sont toujours visibles dans *Réglages › Mode King*, même sans entrer dans le mode.
- **Médias : la visionneuse** : le bloc **Médias** de la fiche (par défaut en Standard et Scientifique, à la place de Photos et Médias GBIF, qui restent disponibles en mode King ; en Épuré, la grande photo l'ouvre) réunit les images de la plante, de toutes les sources : photo du jeu de données, Wikimedia Commons, photos choisies du taxon sur iNaturalist, photos d'observation et planches d'herbier GBIF (licences libres seulement, auteur et licence sur chaque image).
  - **Dans la fiche** (compact) : l'image dans un cadre qui suit sa forme (une planche d'herbier en portrait reste lisible), son crédit en une ligne, la pellicule des autres ; le type de média (Photos, Observations, Herbier) se choisit dans un menu quand il y en a plusieurs ; ⤢ l'ouvre **en volet**, sur l'image montrée. La molette fait défiler la fiche, comme ailleurs.
  - **En volet** : l'image en grand. L'adresse `#/plant/<id>?pane=media&i=<n>` ouvre directement la n-ième image (les liens `?media=<n>` aussi).
  - **Un seul zoom, comme dans une appli Photos** : double-clic ou double-tap pour zoomer à l'endroit pointé (encore une fois : l'image entière), pincer ou Ctrl + molette pour un zoom progressif (la molette seule aussi dans le volet), les boutons − / % / + en bas à droite (« Ajusté » ↔ « 100 % » : un pixel de l'original par pixel d'écran), et glisser pour se déplacer. Zoomé, une **mini-carte** de l'image entière montre la zone vue ; la toucher ou y glisser déplace la vue. Clavier (quand la visionneuse a le focus) : ← → (image précédente / suivante, ou se déplacer quand on est zoomé), + − 0, Échap (l'image entière, puis fermer).
  - **La bonne image au bon moment, toute seule** : la vignette s'affiche aussitôt (floutée), l'image d'affichage (iNaturalist « large », Commons 1 280 px) apparaît en fondu, et dès que le zoom dépasse ce qu'elle contient, **l'original** se charge (« Chargement de l'original… », puis « Original »). Les images voisines sont préchargées.
  - **Calme** : le crédit (type, source, auteur, licence) tient en une ligne sous l'image ; ⓘ ouvre le détail (taille de l'original, collection, année, lieu, « Voir à la source », « Ouvrir l'original »). Sur ordinateur, les commandes s'effacent quand la souris reste immobile. Au doigt : balayer change d'image quand on n'est pas zoomé ; zoomé, glisser déplace la vue.
  - Les tailles se déduisent des adresses des images (iNaturalist `…/photos/<id>/square|small|medium|large|original`, Commons `…/thumb/…/<N>px-<fichier>` et le fichier), dans `app/core/media-items.js` ; une taille qui n'existe pas (Commons n'agrandit pas) bascule sur l'image donnée par la source. Les originaux, lourds, ne sont pas gardés par le service worker.
  - **Présentations** (style du bloc, en mode King) : **Scène** (la photo, ses détails et la pellicule), **Mosaïque** (toutes les images en grille ; une image touchée s'ouvre dans la scène, « ← Mosaïque » y revient) ou **Diaporama** (une image à la fois, ▶ pour défiler toutes les 5 s). Le zoom marche partout.
- **Les blocs en volet** : tout bloc de la fiche (sauf Nom et la barre d'actions) peut s'ouvrir **en grand dans un volet à côté de la fiche** : ⤢ sur son titre (au survol sur ordinateur). Le volet prend la place des résultats (les filtres se replient ; les déplier ferme le volet), avec le nom du bloc et de la plante, « plein écran » (toute la largeur) et ✕ ; dans la fiche, le bloc laisse une ligne « affiché dans le volet ». Une carte y remplit toute la hauteur, les tableaux s'y lisent en entier, la visionneuse y a sa loupe à côté. L'adresse `#/plant/<id>?pane=<bloc>` est partageable ; Retour ferme le volet ; plante précédente / suivante garde le volet ouvert, sur la nouvelle plante. Téléphone : le volet couvre la fiche (« ← Fiche ») ; hors de Flore (Mes plantes, Carte) : par-dessus la page.
  - **Disposition** : « À côté » est une des positions d'un bloc (ci-dessus) : il quitte la fiche, et un bouton « À côté : Carte » en haut de la fiche l'ouvre dans le volet ; ouvrir une plante ne l'ouvre jamais tout seul (Filtres ┃ Résultats ┃ Plante restent en place).
- **Plante précédente / suivante** : une barre en bas du volet de la fiche (juste au-dessus du menu sur téléphone) parcourt les résultats dans leur ordre — ou, dans *Mes plantes*, les plantes de la collection ou de l'endroit ouvert. Sur téléphone, simple : « ‹ Préc. · 3 / 17 · Résultats « ortie » · Suiv. › ». Sur ordinateur, complète : première, précédente, les positions autour (1 … 4 5 **6** 7 8 … 17), un champ pour aller directement à un numéro, d'où vient la liste, suivante, dernière ; un trait en haut de la barre montre où l'on en est. Les touches ← → font de même ; sur téléphone, la fiche se balaie comme une carte (à la Tinder, en CSS) : elle suit le doigt en s'inclinant, et la fiche de la plante vers laquelle on va attend déjà dessous, grandissant à mesure ; lâchée assez loin (ou d'un geste vif), elle poursuit sa course hors de l'écran et la fiche de dessous, déjà chargée, devient la fiche ouverte, sinon elle revient en place ; pas sur une carte ni une galerie. Sur ordinateur et tablette, pas de balayage : ‹ › et les touches ← → font disparaître la fiche en fondu, puis apparaître la suivante (déjà chargée). La ligne de la plante reste visible dans la liste, « Résultats » ramène à la liste et le retour à la plante précédente.

### Modules : les services en ligne, un par un

L'app fonctionne hors ligne avec la flore locale ; chaque service en ligne est un **module** qu'on active **mode par mode** dans **Réglages › Modules** : trois cases, Épuré · Standard · Scientifique (toutes cochées par défaut ; Trefle demande un jeton). La fiche plante suit son affichage, la grille des résultats le sien, la carte et le reste le mode de l'application. Dans un mode où il est décoché, un module n'est jamais appelé et ses données ne s'affichent pas, copies en cache comprises :

**Catégories.** Les services, comme les blocs de la fiche, sont rangés par ce que la donnée dit de la plante, quel qu'en soit le fournisseur (GBIF, par exemple, sert à plusieurs) :

| Catégorie | Question | Services |
|---|---|---|
| Noms | Comment s'appelle-t-elle ? | Wikidata (TAXREF en local ; aussi GBIF) |
| Images | À quoi ressemble-t-elle ? | Wikimedia Commons, Photos en ligne (aussi GBIF, iNaturalist) |
| Protection et risques | Puis-je la cueillir sans danger ? | statuts INPN et plantes à confondre en local (aussi GBIF, Wikidata, IGN espaces protégés) |
| Saisons | Quand la voir ? | Baseflor en local (aussi iNaturalist, Open-Meteo pollens) |
| Répartition | Où pousse-t-elle ? | iNaturalist, GBIF |
| Écologie et climat | Avec qui et dans quel milieu vit-elle ? | GloBI, Open-Meteo (aussi GBIF, IGN zones naturelles) |
| Savoirs | Que sait-on d'elle ? | Wikipédia, Trefle (aussi GBIF, Wikidata) |
| Carte et territoire | Où suis-je, qu'y a-t-il ici ? | IGN : fonds de carte, adresses et altitudes, espaces protégés, zones naturelles au point |
| Outils et notes | Vos actions et vos notes | Dictée vocale ; blocs Note, barre d'actions |

*Réglages › Modules* présente les services sous ces catégories (« Sert aussi : … » pour les autres). En mode King, chaque bloc porte sa catégorie (dans la fiche et dans *Réglages › Mode King*) et **« Ranger par catégorie »** regroupe les blocs d'un mode dans cet ordre, chacun gardant sa place parmi les siens.

| Module | Service | Apporte |
|---|---|---|
| IGN – fonds de carte | data.geopf.fr (WMTS) | photos aériennes, plan, cadastre, courbes de niveau, forêts, espaces protégés ; désactivé, seules les zones déjà vues restent affichées (tuiles du cache, sans réseau) |
| IGN – adresses et altitudes | data.geopf.fr (géocodage, altimétrie) | recherche d'adresse, adresse et altitude d'un point ou d'un lieu |
| IGN – espaces protégés | data.geopf.fr (WFS, couches INPN / PatriNat) | bandeau sur les cartes quand la vue touche un espace protégé (dès le zoom 11) |
| iNaturalist | api.inaturalist.org | Autour, courbes de floraison et fructification, nombre d'observations, photos de repli |
| GBIF | api.gbif.org | descriptions, noms étrangers, répartition, occurrences en France (carte, mois, années, départements, sources, près d'ici), photos et planches d'herbier, habitat, synonymes, UICN, publications ; sur la Carte, couche « Répartition GBIF » quand une seule plante est filtrée |
| Wikidata | www.wikidata.org | classification, statut UICN, identifiants ; donne l'article Wikipédia |
| Wikipédia | fr.wikipedia.org | résumé de l'article (nécessite Wikidata) |
| Wikimedia Commons | commons.wikimedia.org | galerie de photos libres, vignettes de repli |
| Trefle | trefle.io | données de culture, avec votre jeton (saisi dans sa carte) |
| Photos en ligne | thumb.wikimedia.org, inaturalist-open-data, herbiers… | vignettes et photos ; désactivé, 🌿 à la place |
| Dictée vocale (navigateur) | reconnaissance vocale du navigateur | bouton 🎙 dans la recherche Flore et dans « Noter ici » ; sur Chrome, l'audio est traité par Google |

### Modes d'affichage : Épuré, Standard, Scientifique

Un mode pour toute l'application, choisi par trois icônes dans l'en-tête (ou dans Réglages › Affichage sur téléphone) :

- **Épuré** — grandes photos et actions rapides. La fiche plante devient une « porte de collection » : photo, noms, famille, alertes de protection, calendrier de floraison, et un gros bouton **« ＋ Ajouter à <collection en cours> »** (« ✓ Dans … » une fois ajoutée, un nouvel appui la retire). La collection ou le lieu en cours se choisit dans la liste juste dessous et reste mémorisé ; c'est aussi la dernière collection utilisée dans « Ajouter à… ».
- **Standard** — grand public : calendrier, photos, description (résumé Wikipédia, sinon GBIF), noms ; « Dans mes collections » tient en une ligne qu'on déplie.
- **Scientifique** — tout ce que l'application connaît ou peut obtenir, sources citées : classification (Wikidata, jusqu'à l'ordre), auteur, synonymes, noms dans d'autres langues, tous les statuts INPN par territoire, statut UICN mondial, phénologie, observations iNaturalist, occurrences GBIF en France, répartition et descriptions GBIF, médias GBIF, données Trefle (avec votre jeton), identifiants (TAXREF, INPN, GBIF, iNaturalist, Wikidata, Tela Botanica, IPNI, POWO).

La grille des résultats et la fiche plante ont chacune leurs icônes pour s'écarter du mode (un point ↺ ramène au mode de l'application) ; changer le mode de l'application les réaligne.

**Vos modes** (*Réglages › Affichage › Modes d'affichage*) : « Dupliquer » un mode en crée un nouveau, copie de celui-ci — blocs et sous-blocs, ordre, titres, styles, épinglés et leur position, volets, barre d'actions, modules — qu'on renomme, à qui on donne une icône, puis qu'on arrange à sa guise en mode King et dans les modules, sans toucher à son modèle. Par exemple une **visionneuse** (à partir d'Épuré : Médias en volet, presque rien d'autre) ou un **poste scientifique** (à partir de Scientifique : carte épinglée, interactions, climat, occurrences en volet). Il s'affiche à la manière de son modèle (Épuré, Standard ou Scientifique : la grille des résultats et la façon de dessiner chaque bloc), apparaît dans tous les sélecteurs d'affichage et voyage avec la mise en page exportée. « Supprimer » l'efface avec sa mise en page ; s'il était utilisé, l'application revient au mode Standard. Les trois modes de l'application restent, modifiables et réinitialisables.

### Recherche, filtres et tri

- **Texte** : noms français, noms scientifiques, synonymes et familles, sans tenir compte des accents (`benoite` → *Benoîte*).
- **Partout la même recherche** : « Ajouter une plante » (liste, lieu) et « Noter ici » trouvent les mêmes plantes, dans le même ordre, que l'onglet Flore, avec leur nombre et « Afficher plus » jusqu'à la dernière.
- **La liste ne bouge pas** sous les actions d'une ligne (♥ favori…) : elle ne revient en haut que pour une nouvelle recherche (texte, filtres, tri), et retrouve sa position au retour d'une fiche plante.
- **Abréviations** : chaque mot tapé correspond au début d'un mot du nom, dans l'ordre (`ger rob` → *Geranium robertianum*, `ben vil` → *Benoîte des villes*).
- **Fautes de frappe** : s'il y a moins de 5 résultats, une seconde passe tolère 1 faute (mots de 5 lettres et plus) ou 2 fautes (8 lettres et plus), avec la mention « résultats approchants » (`pisenlit` → *Taraxacum*).
- **Suggestions** : les familles et genres qui commencent par le texte saisi sont proposés comme filtres en un clic (`ros` → Rosaceae, *Rosa*).
- **Filtres à choix multiples** : statut, famille, genre, photo, nom français. Les valeurs d'un même filtre se combinent en OU, les filtres entre eux en ET. Chaque valeur affiche le nombre de résultats qu'on obtiendrait en l'ajoutant.
- **Tri** : pertinence, nom français, nom scientifique, famille, avec photo d'abord. Un affichage **compact** est disponible.
- **URL partageable** : `#/?q=ortie&family=Urticaceae,Lamiaceae&status=I,J&photo=avec&sort=sci`.

Sur ordinateur, les filtres sont dans un panneau latéral ; sur mobile, dans un panneau qui s'ouvre depuis le bas de l'écran.

Fonctionnement :

1. au démarrage, `data/meta.json` est comparé à la version locale ; `data/plants.json` n'est téléchargé que s'il a changé, puis stocké dans IndexedDB ;
2. un Web Worker construit l'index de recherche depuis IndexedDB ;
3. la fiche plante appelle `PlantSources.details()` à la demande, et la réponse reste en cache dans IndexedDB ;
4. sans réseau, la recherche, les fiches déjà consultées et les images déjà vues restent disponibles.

Lancer en local (n'importe quel serveur statique fait l'affaire) :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Le workflow `Deploy web app` publie l'application sur GitHub Pages à chaque modification de l'app sur `main` et après chaque build du dataset. Il faut l'activer une fois : **Settings → Pages → Source : GitHub Actions**.

Ajouter un fichier JS ou CSS dans `app/` impose de l'ajouter aussi à la liste `SHELL` de `sw.js` ; le workflow le vérifie. Pour mettre Lit ou Leaflet à jour : `LIT_VERSION=3.x.y LEAFLET_VERSION=1.x.y scripts/vendor.sh`.

### Navigation et saisie rapide

- **Navigation et historique** : chaque vue est une étape de l'historique du navigateur — recherche, fiche plante (chaque plante parcourue avec ‹ › aussi), carte et lieu ouvert, collections, éditeur, réglages. Le bouton retour du navigateur ou du téléphone revient à la vue précédente et ferme une fenêtre ouverte (Ajouter à…, Noter ici, filtres, couches de carte). La recherche (texte, filtres, tri) est une seule vue mise à jour sur place. « ✕ / Résultats » revient à la liste, « Terminé » à la vue d'où l'on venait ; une collection supprimée ou un lieu fusionné ne restent pas dans l'historique.
- Sur téléphone, une barre en bas : **Flore** (feuille) · **Carte** · **Mes collections** · **Réglages** (engrenage ; sauvegarde) ; l'onglet actif a son icône pleine sur une pastille. « Noter ici » est dans Mes collections, sur la carte (+) et dans les Actions de la fiche plante. Sur ordinateur, les mêmes entrées sont dans l'en-tête.
- **Noter ici** : le GPS démarre, des suggestions s'affichent (plantes des lieux à moins de 200 m, favoris, plantes récentes) ; un toucher sur une plante l'enregistre **dans le lieu le plus proche (< 30 m)** ou dans un nouveau lieu. Un bandeau propose **Annuler** et **Détails**.
- **Recherche vocale** 🎙 (recherche Flore et « Noter ici ») : on dit le nom, la recherche se lance. Elle utilise la reconnaissance vocale du navigateur, en français (sur Chrome l'audio part chez Google, sur Safari chez Apple ou reste sur l'appareil) ; le bouton n'apparaît que si le navigateur la propose et si le module « Dictée vocale » est actif.

### Mode cueillette (module optionnel)

*Réglages → Mode cueillette.* Activé automatiquement si l'appareil contient déjà des récoltes, désactivé sinon. Désactivé, un lieu est simplement « des plantes vues ici » (abondance, notes) ; rien n'est effacé. Activé :

- journal de récolte, qualité (★), « Récolté aujourd'hui », bouton « + Récolte » ;
- badges **En saison** (récolté à ±15 jours de la date, une année quelconque) et **Bientôt** (dans les 30 prochains jours) ;
- **plantes à confondre** : noter une plante avec « Noter ici » ou « + Récolte » rappelle les plantes toxiques avec lesquelles elle est confondue (ci-dessous).

### Données ouvertes croisées : interactions, climat, pollens, zones naturelles

GeoFlora croise la flore avec des API ouvertes appelées directement par le navigateur, sans clé (vérifié depuis le site déployé). Chacune est un **module** (*Réglages › Modules*) ; désactivé, il n'est jamais appelé. Les réponses sont gardées en cache (IndexedDB).

- **Pollinisateurs et interactions** (bloc de la fiche, module GloBI) : ce que [GloBI](https://www.globalbioticinteractions.org/) recense pour l'espèce, regroupé par rôle — pollinisateurs et visiteurs des fleurs, ce qui la mange ou la parasite (chenilles, pucerons, rouilles…), symbioses (mycorhizes), ce qu'elle-même parasite, autres — et par groupe (abeilles et bourdons, syrphes, papillons, coléoptères, champignons…). Trois styles au choix en mode King : **tableau** (par défaut : espèce, groupe, nombre de mentions), **liste** (groupes puis espèces) ou **réseau** (la plante au centre, chaque partenaire coloré par groupe et dimensionné par ses mentions). Chaque rôle est un sous-bloc. Source : nombre de mentions et d'études.
- **Climat et pollen** (bloc de la fiche, module Open-Meteo) :
  - *Niche climatique* : le climat (température moyenne annuelle, pluie annuelle ; ERA5 via Open-Meteo, deux ans) de 24 occurrences GBIF de l'espèce réparties en France, en nuage de points ; le cadre réunit 80 % d'entre elles. « Me situer » ajoute votre position (arrondie à 100 m) : dans sa niche ou non, et le diagramme climatique de chez vous (10 ans).
  - *Pollen aujourd'hui* : pour les plantes dont le modèle européen CAMS prévoit le pollen (aulne, bouleau, graminées, armoise, olivier, ambroisie), le niveau du jour autour de vous.
- **Autour d'un lieu ou d'un point** (panneau d'un endroit sur la Carte et dans Mes plantes ; « Ici : zones naturelles… » dans la fiche d'un point de la carte, appui long) :
  - *Zones naturelles* (module IGN – zones naturelles au point, API Carto) : ZNIEFF I et II, sites Natura 2000 (habitats, oiseaux), parcs nationaux et régionaux, réserves naturelles qui contiennent le point, avec leur fiche INPN ;
  - *Plantes vues ici* (iNaturalist, observations validées à moins de 500 m) : les plus observées, celles de la flore ouvrent leur fiche, celles du lieu sont signalées ;
  - *Pollens aujourd'hui* (CAMS via Open-Meteo) et *Climat du lieu* (diagramme : pluie par mois en barres, température en courbe, moyennes sur 10 ans, ERA5).
- **Usages et cuisine sauvage** (bloc de la fiche, catégorie Savoirs) — la prudence d'abord, chaque ligne avec sa source et la partie de la plante concernée ; l'app ne dit jamais qu'une plante est « comestible » :
  - *Prudence* : Pharmacopée française, **liste B** de l'ANSM (plantes dont les effets indésirables potentiels l'emportent sur le bénéfice attendu) et parties toxiques citées par la **liste A** ; toxicité de la base **TPPT** d'Agroscope (plantes toxiques d'Europe centrale : niveau, parties toxiques, principales toxines) ; risque de confusion (Anses) ; espèce protégée ou cueillette réglementée (INPN). Ces données sont dans `data/safety.json`, construit en CI (`scripts/build-safety.mjs`) et disponible hors ligne. S'il y a un risque, les usages sont titrés « non vérifiés ».
  - *Usages rapportés* : usages déclarés sur Wikidata (alimentation, médecine traditionnelle, autres) et, pour la liste A de l'ANSM, les parties utilisées ;
  - *Parties et produits* (tableau ou liste) : ce que l'on tire de la plante et de quelle partie (Wikidata) ;
  - *En cuisine* : plats qui l'utilisent (Wikidata) et recettes de Wikibooks (module « Wikibooks (recettes) ») ;
  - *Pour aller plus loin* : PFAF (identifiant Wikidata), monographies de l'Agence européenne du médicament, Pharmacopée française.
- La **floraison observée** (iNaturalist, observations annotées « en fleurs » / « en fruits » en France) était déjà dans le bloc Calendrier, à côté de la floraison Baseflor.

### Plantes à confondre (Anses, Centres antipoison)

Sur la fiche d'une plante comestible souvent confondue avec une plante toxique — ou de la plante toxique elle-même —, un encadré **« Peut être confondue avec… »** (rouge si l'intoxication peut être mortelle) donne la partie concernée, les **critères pour les distinguer**, les symptômes (vue Scientifique) et les sources. En vue Épurée, une ligne, les critères sur demande. Exemples : ail des ours ↔ colchique et muguet, consoude ↔ digitale, gentiane jaune ↔ vérâtre, carotte sauvage ↔ œnanthe safranée, sureau noir ↔ sureau yèble, châtaignier ↔ marronnier d'Inde.

Les données (`data/lookalikes.json`, 15 confusions) ne reprennent **que** les confusions et critères publiés par l'Anses et les Centres antipoison : aide-mémoire *Plantes toxiques et plantes comestibles : attention aux confusions !* (2020), *Vigil'Anses* n°8 (2019), articles de l'Anses sur le colchique et l'ail des ours (2025), « gare aux confusions » (2020) et les plantes de l'été (2022). Un genre entier (« Digitalis sp. ») y est noté par son seul nom. Le fichier est inclus dans l'application : l'avertissement fonctionne hors ligne.

### Contexte et passerelles Flore ⇄ lieux

L'application retient où vous en êtes dans chaque partie, aussi après un rechargement :

- **Flore** : la recherche (texte, filtres, tri) et la plante ouverte. L'onglet Flore rouvre la plante ; touché une seconde fois, il revient à la liste. Rouvert ailleurs (Carte, lien), la recherche est restaurée : les flèches ‹ › d'une fiche parcourent les mêmes résultats.
- **Mes plantes** : la collection ou l'endroit ouvert et la plante à côté. **Carte** : le lieu choisi et le filtre de plantes.
- **Plante courante** : la dernière ouverte, où que ce soit. **Collection courante** : la dernière collection ou le dernier lieu ouvert.

Passerelles :

- d'une **fiche** : « Carte » (l'onglet Carte filtré sur la plante, avec sa répartition GBIF) et « + *collection courante* », qui ajoute la plante d'un geste à la dernière collection ou au dernier lieu ouvert (le bouton disparaît une fois la plante ajoutée) ; deux actions de la barre, à afficher ou non par mode ;
- d'une **collection ou d'un lieu** : « Voir dans Flore » (Mes plantes, éditeur de collection, fiche d'un lieu sur la Carte) ouvre la recherche filtrée sur ses plantes ;
- des **résultats Flore** : l'icône carte ouvre la Carte limitée à mes lieux qui ont une plante de ces résultats (puce « Recherche Flore » pour l'enlever) ;
- la **barre de contexte**, sous l'en-tête : la plante, la collection et la recherche en cours, chacune un lien pour y revenir et ✕ pour l'oublier ; ce que la page montre déjà n'y figure pas. Elle se masque dans *Réglages › Barre de contexte*.

**Les données de la fiche parlent à ses cartes.** Quand la fiche a une carte (épinglée ou dans la fiche), ses valeurs se touchent (soulignées en pointillés) et la carte les montre :
- une **région** ou un **département**, un **mois**, une **année**, un **type de relevé** (spécimens d'herbier…), une **source** (jeu de données) : la carte n'affiche plus que ces occurrences GBIF (tuiles GBIF filtrées, présences aux coordonnées sans problème connu) ; une région ou un pays recadre la carte sur ses occurrences ;
- un **pays** de la répartition dans le monde, quand la liste GBIF donne son code : ses occurrences, carte dézoomable jusqu'au monde ;
- une occurrence **Près d'ici**, une **photo** ou une **planche d'herbier** géolocalisée (📍 sous l'image), un de **mes lieux** : un point rouge nommé, la carte y vole ;
- **Plantes à confondre** : « Comparer sur la carte » ajoute les occurrences GBIF de la plante à confondre, en violet, à côté de celles de la plante.
Une puce sur la carte dit ce qui est affiché (« Filtre : Occitanie », « Comparaison : Colchique d'automne ») ; ✕, ou toucher à nouveau la valeur, l'efface. Sans carte dans la fiche, les valeurs restent du texte.

Le **cadrage** d'un bloc Carte suit ses réglages : « Automatique » (par défaut) cadre le cercle autour de moi quand les observations proches sont affichées, sinon mes lieux et leurs plants, sinon le monde pour une répartition GBIF mondiale, sinon la France ; « Monde entier » permet de dézoomer jusqu'au planisphère. Chaque changement de réglage recadre la carte ; la déplacer à la main reste jusqu'au réglage suivant.

### Mes plantes : favoris, listes et lieux

Une **collection** est un ensemble de plantes, avec ou sans position :

- **Favoris** ♥ : un toucher sur ♡ dans la liste de recherche ou sur la fiche d'une plante.
- **Listes** (« Mellifères », « À chercher cet été »…) : sans position. « Ajouter à… » sur une fiche plante coche/décoche les collections et en crée une à la volée.
- **Lieux** : une liste avec une position GPS, visible sur la carte (voir ci-dessous). « 📍 Ajouter une position » transforme une liste en lieu ; « Retirer la position » fait l'inverse.
- **Noms** : dans chaque champ de nom de collection (« Ajouter à… → Nouvelle collection », éditeur d'une nouvelle collection), les collections existantes qui correspondent sont proposées ; en choisir une y ajoute la plante au lieu de créer un doublon.

**Espèces protégées** : la fiche plante, le panneau d'une plante dans un endroit et le message de « Noter ici » signalent une **protection** (bandeau rouge) ou une **cueillette réglementée** (bandeau orange) là où l'on est, ainsi que la liste rouge. Le territoire est celui du point GPS de l'endroit (département, région, ancienne région), sinon « Ma région » choisie dans *Réglages* ; les statuts d'ailleurs restent consultables. Chaque bloc renvoie aux textes officiels sur l'INPN. La recherche a un filtre « Protection et menace ».

**Calendrier** sur la fiche plante, chargé automatiquement : floraison Baseflor (hors ligne, dans le jeu de données) et observations iNaturalist en fleurs / en fruits en France, mois par mois, chaque ligne avec sa source. Ce sont des indications de floraison et de fructification, **pas des dates de cueillette**.

L'onglet **Mes plantes** les regroupe : collections, puis endroits triés par distance. Une collection à laquelle on ajoute des coordonnées GPS devient un endroit ; toucher un endroit ouvre la carte cadrée sur son point et toutes ses plantes. Toucher l'en-tête d'une collection (Favoris, collection, endroit) **déplie la liste de ses plantes** (ce qui est déplié est mémorisé) ; un endroit montre aussi **sa carte**, avec chacune de ses plantes. Toucher une plante ouvre **sa fiche à côté**, avec en bas la barre plante précédente / suivante de la collection : sur ordinateur, trois volets (liste · carte de l'endroit · fiche), comme dans Flore : chacun a son en-tête, se **redimensionne** en glissant son séparateur (← → au clavier, double-clic : largeur par défaut) et se **replie** (« ») en une fine colonne titrée ; la liste garde sa largeur quand une plante ou un endroit s'ouvre à côté (rien ne bouge sous le doigt) et un volet « Aperçu » attend tant que rien n'est ouvert ; sur tablette, la carte et la fiche se partagent la colonne de droite ; sur téléphone, la carte s'affiche dans l'endroit déplié et la fiche glisse par-dessus la page. L'adresse garde ce qui est ouvert (`#/collections?c=…&plant=…`) : le retour du navigateur revient à la vue précédente. Sur chaque ligne, **Partager** envoie un lien qui contient la collection (la position exacte d'un endroit, après confirmation) et l'icône crayon (ou carte, pour un endroit) ouvre la collection pour la modifier. Le rappel « Sauvegardez vos collections » est en bas de la page. Les modifications sont **enregistrées automatiquement**. Dans la recherche, le filtre **Mes plantes** limite les résultats aux favoris, à une liste, à un lieu ou à « dans un de mes lieux ».

**Partager** sans serveur :

- une plante : lien `#/plant/<id>` ;
- une recherche (famille, statut…) : bouton *Partager* au-dessus des résultats, l'URL contient les filtres ;
- une liste ou un lieu : le lien contient la collection elle-même (`#/shared?d=…`, JSON compressé deflate + base64url, ~200 caractères pour 30 plantes). Notes et journaux de récolte ne sont **jamais** inclus ; pour un lieu, la position exacte l'est (confirmation demandée), ainsi que celle de chaque plante. Le destinataire voit un aperçu et peut l'enregistrer comme nouvelle collection.

Partout où des plantes sont listées (lieu ou collection, ajout d'une plante, « Noter ici », fiche du lieu sur la carte, lien partagé), chaque nom est précédé de la **miniature de sa photo**, comme dans les résultats de recherche ; les photos déjà vues restent disponibles hors ligne (cache du service worker, 400 images).

### Carte : recherche, réglages, infos d'un point

- **Barre de recherche** en haut de la Carte : adresse, commune ou lieu-dit avec suggestions (géocodage IGN) ; le résultat choisi est centré et sa fiche s'ouvre.
- **▦ Carte** (au bout de la barre, ou bouton rond sur les autres cartes) : un seul panneau pour tout ce qui règle l'affichage — **fond** (photos aériennes, plan IGN), **couches** de terrain (parcelles cadastrales, courbes de niveau) et de **règles de cueillette** (forêts publiques ONF, parcs nationaux, réserves naturelles nationales et régionales, arrêtés de protection de biotope — données INPN / PatriNat servies par l'IGN), **légende** et **sources**. Les choix sont mémorisés.
- **Espaces protégés** : dès le zoom 11, sur toutes les cartes (Carte, éditeur d'un lieu, fiche plante, lien partagé), un petit bandeau nomme le **parc national** (cœur), la **réserve naturelle** nationale ou régionale ou l'**arrêté de protection de biotope** que la vue touche, avec le lien vers sa fiche INPN : « la cueillette y est souvent interdite ou réglementée : vérifiez les règles du site ». × le masque pour ces espaces ; il ne s'affiche pas pendant le déplacement des positions. Données INPN / PatriNat interrogées sur le WFS de l'IGN (noms seulement), gardées un mois sur l'appareil ; module « IGN – espaces protégés ».
- **Appui long** n'importe où sur la carte : fiche du point avec l'**adresse la plus proche**, l'**altitude** (RGE ALTI®), les **coordonnées** (copiables), « Créer un endroit ici » et « Itinéraire ». La fiche d'un endroit affiche sa commune et son altitude, l'éditeur l'adresse, l'altitude et les coordonnées de son point.

Source : IGN – Géoplateforme (WMTS, WFS, géocodage, altimétrie ; gratuit, sans clé, Licence Ouverte). Adresses et altitudes déjà vues sont gardées sur l'appareil.

### Autour : les plantes observées dans un périmètre

Sur la **Carte**, le bouton **Autour** trace un cercle (5 km par défaut ; 500 m, 1, 2, 5 ou 10 km) autour de l'endroit sélectionné, sinon de votre position, sinon du centre de la carte, et liste **toutes les espèces de plantes observées dans ce cercle**, classées par nombre d'observations (toutes dates confondues). Toucher une espèce place ses observations sur la carte (les 200 plus récentes ; toucher un point ouvre l'observation) et mène à sa fiche quand elle fait partie de la flore de l'app (rapprochement par nom scientifique ou synonyme TAXREF). En tête de liste, un récapitulatif : nombre d'espèces, de familles et de genres (familles et genres TAXREF pour les espèces de la flore de l'app) et d'observations ; une recherche filtre la liste par nom français, nom scientifique, genre ou famille (sans tenir compte des accents), et deux filtres à choix multiples, **Famille** et **Genre** (repliés par défaut, valeurs de la plus à la moins représentée dans le cercle, ordre fixe), la restreignent ; le filtre Genre ne propose que les genres des familles choisies.

Source : API **iNaturalist** (`observations/species_counts` et `observations`), observations de **niveau recherche** uniquement (identification confirmée par la communauté) ; résultats gardés 24 h sur l'appareil.

### Lieux de récolte

L'onglet **Carte** enregistre les endroits où vous récoltez, sur les **photos aériennes IGN** (Géoplateforme, sans clé ; aussi Plan IGN et parcelles cadastrales). Un **lieu** (endroit) est une **collection de plantes qui a des coordonnées GPS** : une lisière peut réunir l'ail des ours, l'ortie et la benoîte. **Chaque plante du lieu a aussi sa propre position GPS.**

- **Sur place** : depuis une fiche plante, « 📍 Ajouter un lieu », ou **+** sur la carte. Le GPS s'affiche avec sa précision (± m) ; l'épingle peut être déplacée à la main, ou posée par un appui long sur la carte. À moins de 100 m d'un lieu existant, l'application propose d'**y ajouter la plante** plutôt que de créer un doublon.
- **Position de chaque plante** : « Noter ici » enregistre la plante à votre position GPS (et la rattache au lieu le plus proche à moins de 30 m). Ajoutée depuis l'éditeur, une plante prend votre position GPS si vous êtes à moins de 100 m du lieu, sinon le point du lieu. Sur la carte d'un endroit, les marqueurs sont **fixes** : son bouton **✎** permet de faire glisser le point de l'endroit (le carré) et chaque plante (les ronds), indépendamment (appui long : placer l'endroit) ; chaque position est **enregistrée dès qu'on lâche** le marqueur, « Terminé » quitte le mode. En mode modification, le panneau d'une plante propose aussi « Ici (GPS) » ; sinon « Déplacer » ouvre ce mode. Un nouvel endroit s'ouvre directement en mode modification.
- **Carte et lieu, une seule page** : choisir un lieu sur la Carte ouvre **toute sa fiche** à côté de la carte (à droite sur ordinateur, dans un volet redimensionnable et repliable « » comme ceux de Flore ; en dessous sur téléphone, à moitié de la hauteur, la poignée l'agrandit) : nom, plantes avec abondance, qualité, notes et journal de récolte, « + Ajouter une plante », notes du lieu, partage, export, suppression ; en tête, le nombre de plantes, la distance et « Itinéraire ». Tout est **enregistré automatiquement**. La carte au-dessus est celle du lieu : toucher une plante sur la carte ouvre son panneau, ouvrir une plante dans la fiche la met en évidence sur la carte, « Déplacer » passe la carte en modification (✎). Un lien vers un lieu (Mes plantes, « Noter ici › Détails », fiche plante) ouvre la Carte sur ce lieu. En mode cueillette, le panneau d'une plante rappelle aussi les **plantes à confondre**.
- **Pour chaque lieu** : nom, notes (accès, propriétaire…), et ses plantes. **Pour chaque plante du lieu** : abondance, qualité (★), notes et **journal de récolte** (date, quantité, remarque). Une plante est **« en saison »** à un lieu si elle y a été récoltée, une année quelconque, à ±15 jours de la date du jour ; un lieu est en saison si l'une de ses plantes l'est.
- **Carte** : deux icônes distinctes. Un **lieu** est un carré sur pied, coloré selon l'abondance la plus forte, avec le nombre de plantes ; il est toujours visible. Une **plante** est sa **photo en miniature** dans un rond cerclé de la couleur de son abondance (une feuille si elle n'a pas de photo), à sa propre position, visible **en zoomant** (niveau 16 et plus) ; la toucher ouvre la fiche du lieu sur cette plante. Filtres « En saison » et par plante. **Choisir un lieu zoome sur lui et toutes ses plantes.** Le bouton **✎** de la carte est toujours là : en mode modification, **tous les marqueurs se glissent librement** (lieux, et plantes en zoomant) et chaque position est **enregistrée au lâcher**, sans étape de validation ; « Terminé » (ou ✎) quitte le mode. Un marqueur tenu sous le doigt n'est jamais replacé par une mise à jour du GPS. Pendant la modification, la carte occupe **tout l'écran**, puis reprend sa place. Une plante sans position propre suit son lieu.
- **Une seule carte** : la même interface partout (Carte et ses lieux, nouveau lieu, lieux d'une plante sur sa fiche, lien partagé) — recherche d'adresse, ▦ fonds, couches et légende, ◎ ma position, fiche d'un point à l'appui long, et ✎ pour déplacer les marqueurs (sauf sur un lien partagé). **Liste** triée par distance.
- **Hors ligne** : le GPS et les lieux fonctionnent toujours ; les zones de carte déjà affichées restent disponibles (3 000 tuiles en cache).
- **Sécurité des données** : une **copie de secours** de toutes les collections est réécrite dans le `localStorage` à chaque modification (jamais remplacée par une liste vide, sauf suppression volontaire). Si la base IndexedDB perd des collections, « Mes plantes » propose de les **restaurer**. La protection du stockage est demandée au navigateur dès la première collection, et *Réglages → Protéger mes données* la redemande ; « Mes plantes » rappelle d'**exporter** quand la dernière sauvegarde a plus de 14 jours. Seul un fichier exporté survit à l'effacement complet des données du site par le navigateur. Réglages affiche un diagnostic du stockage (version, nombre de collections, protection, espace, dates de copie et d'export).
- **Confidentialité** : les lieux restent **sur l'appareil** (IndexedDB, stockage persistant demandé). Ils sont stockés au format **GeoJSON** : *Réglages → Exporter* produit un fichier `.geojson` lisible par QGIS, uMap, geojson.io…, et *Importer* le fusionne (même identifiant → la version la plus récente l'emporte ; l'ancien format à une plante par point est aussi accepté). Pensez à exporter régulièrement.

Format d'échange (`formatVersion` 5) : un **GeoJSON allégé** qui ne contient que **vos saisies**. Ce que l'application connaît déjà (noms des plantes, familles…) n'y figure pas : les plantes sont désignées par leur identifiant TAXREF et leurs noms sont retrouvés à l'import. Les valeurs par défaut (abondance « moyen », note 0, notes vides…), les champs calculés et la position d'une plante quand c'est celle de l'endroit sont omis ; le fichier est écrit sur une ligne. Les anciens fichiers (formats 1 à 4) restent importables.

```json
{
  "type": "FeatureCollection", "generator": "GeoFlora", "formatVersion": 5, "exportedAt": "…",
  "features": [{
    "type": "Feature", "id": "c0f3…",
    "geometry": { "type": "Point", "coordinates": [4.8357, 45.7641] },
    "properties": {
      "name": "Lisière nord", "notes": "Parking au bout du chemin", "accuracy": 8,
      "createdAt": "…", "updatedAt": "…",
      "plants": [
        { "plantId": 81541, "abundance": "abondant", "rating": 4,
          "harvests": [{ "date": "2026-04-12", "quantity": "1 kg" }] },
        { "plantId": 128268, "coordinates": [4.83581, 45.76402], "accuracy": 6 }
      ]
    }
  }]
}
```

Une collection sans `geometry` est une liste ; l'identifiant `favorites` désigne les favoris.

**Transférer vers un autre appareil** (*Réglages*) : le même GeoJSON allégé, compressé (deflate + base64url), voyage dans un lien `#/shared?d=g…` — rien ne passe par un serveur. À l'ouverture, un aperçu liste les collections ; « Importer » les ajoute ou les met à jour (même identifiant → la plus récente l'emporte, sans doublon). Une case permet d'inclure ou non les notes et journaux de récolte ; une copie plus récente sans notes ne supprime pas celles déjà présentes sur l'appareil.

## Génération locale

Node.js 20+ :

```bash
mkdir -p .cache/taxref
curl -L "https://assets.patrinat.fr/files/referentiel/TAXREF_v18_2025.zip" -o .cache/taxref.zip
unzip .cache/taxref.zip -d .cache/taxref
node scripts/build-plants.mjs
```

La GitHub Action `Build flora dataset` télécharge la source officielle, valide le module d'enrichissement, génère puis versionne :

- `data/plants.json`
- `data/meta.json`
- `data/thumbnails.json` (cache d'enrichissement Wikimedia)

## IndexedDB recommandée

```text
plants
 ├─ id
 ├─ family
 ├─ genus
 ├─ species
 ├─ scientificName
 ├─ vernacularNames[]
 ├─ synonyms[]
 └─ status.france

plantDetails
 ├─ id
 ├─ fetchedAt
 ├─ identifiers
 ├─ thumbnail
 └─ remoteData
```

Indexes principaux :

```text
by_family
by_genus
by_taxon [genus, species]
```

Une future passe pourra encore enrichir les noms vernaculaires via BDTFX/Tela Botanica et ajouter des sources comme Pl@ntNet, Baseflor et TRY.
