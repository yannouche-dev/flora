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

- **GBIF** : résolution taxonomique, médias, descriptions, noms vernaculaires, répartition ;
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

### Onglet Flore : filtres, résultats, plante

- **Ordinateur** : trois panneaux côte à côte, **Filtres ┃ Résultats ┃ Plante**. Chacun se replie (« / ») en une fine barre verticale et se redimensionne en tirant les séparateurs (ou ←/→ au clavier, double-clic pour la largeur par défaut) ; largeurs et panneaux repliés sont mémorisés. Toucher un résultat ouvre la fiche dans le panneau Plante (l'adresse `#/plant/<id>` reste partageable) ; ⤢ la passe en pleine largeur, × la ferme.
- **Recherche** en haut des résultats (« Ex. : ortie, Urtica dioica, ger rob, Lamiaceae »).
- **Grille des résultats** : Photo, Nom français, puis Famille, Genre, Espèce (l'épithète, le genre ayant sa colonne), Statut, Protection, et les actions ♥ (favori) et 📍 (noter où je la trouve ; pleine si la plante est déjà dans un de mes lieux, elle ouvre alors la carte). Trois affichages, au choix par les icônes au-dessus de la grille (lignes · photo · tableau) : **Standard** (sans statut ni protection), **Épuré** (grandes photos, nom français sur le nom scientifique complet) et **Scientifique** (toutes les colonnes, auteur compris). Cliquer un en-tête trie par cette colonne, recliquer inverse l'ordre (`sort=-family` dans l'URL) ; un en-tête dont le filtre est actif affiche son nombre de valeurs, qui ouvre ce filtre. Quand le panneau est étroit, Genre (et Statut) se masquent, puis la liste repasse en fiches.
- **Tablette** : filtres en feuille, Résultats ┃ Plante. **Téléphone** : fiches, et la plante s'ouvre en plein écran par-dessus la liste (« ← Résultats » revient au même endroit).

### Modules : les services en ligne, un par un

L'app fonctionne hors ligne avec la flore locale ; chaque service en ligne est un **module** qu'on active **mode par mode** dans **Réglages › Modules** : trois cases, Épuré · Standard · Scientifique (toutes cochées par défaut ; Trefle demande un jeton). La fiche plante suit son affichage, la grille des résultats le sien, la carte et le reste le mode de l'application. Dans un mode où il est décoché, un module n'est jamais appelé et ses données ne s'affichent pas, copies en cache comprises :

| Module | Service | Apporte |
|---|---|---|
| IGN – fonds de carte | data.geopf.fr (WMTS) | photos aériennes, plan, cadastre, courbes de niveau, forêts, espaces protégés ; désactivé, seules les zones déjà vues restent affichées (tuiles du cache, sans réseau) |
| IGN – adresses et altitudes | data.geopf.fr (géocodage, altimétrie) | recherche d'adresse, adresse et altitude d'un point ou d'un lieu |
| IGN – espaces protégés | data.geopf.fr (WFS, couches INPN / PatriNat) | bandeau sur les cartes quand la vue touche un espace protégé (dès le zoom 11) |
| iNaturalist | api.inaturalist.org | Autour, courbes de floraison et fructification, nombre d'observations, photos de repli |
| GBIF | api.gbif.org | descriptions, noms étrangers, répartition, médias, occurrences en France |
| Wikidata | www.wikidata.org | classification, statut UICN, identifiants ; donne l'article Wikipédia |
| Wikipédia | fr.wikipedia.org | résumé de l'article (nécessite Wikidata) |
| Wikimedia Commons | commons.wikimedia.org | galerie de photos libres, vignettes de repli |
| Trefle | trefle.io | données de culture, avec votre jeton (saisi dans sa carte) |
| Photos en ligne | thumb.wikimedia.org, inaturalist-open-data, herbiers… | vignettes et photos ; désactivé, 🌿 à la place |
| Dictée vocale (navigateur) | reconnaissance vocale du navigateur | bouton 🎙 dans la recherche Flore et dans « Noter ici » ; sur Chrome, l'audio est traité par Google |

### Modes d'affichage : Épuré, Standard, Scientifique

Un mode pour toute l'application, choisi par trois icônes dans l'en-tête (ou dans Réglages › Affichage sur téléphone) :

- **Épuré** — grandes photos et actions rapides. La fiche plante devient une « porte de collection » : photo, noms, famille, floraison, alertes de protection, et un gros bouton **« ＋ Ajouter à <collection en cours> »** (« ✓ Dans … » une fois ajoutée, un nouvel appui la retire). La collection ou le lieu en cours se choisit dans la liste juste dessous et reste mémorisé ; c'est aussi la dernière collection utilisée dans « Ajouter à… ».
- **Standard** — grand public : calendrier, photos, description (résumé Wikipédia, sinon GBIF), noms ; « Dans mes collections » tient en une ligne qu'on déplie.
- **Scientifique** — tout ce que l'application connaît ou peut obtenir, sources citées : classification (Wikidata, jusqu'à l'ordre), auteur, synonymes, noms dans d'autres langues, tous les statuts INPN par territoire, statut UICN mondial, phénologie, observations iNaturalist, occurrences GBIF en France, répartition et descriptions GBIF, médias GBIF, données Trefle (avec votre jeton), identifiants (TAXREF, INPN, GBIF, iNaturalist, Wikidata, Tela Botanica, IPNI, POWO).

La grille des résultats et la fiche plante ont chacune leurs trois icônes pour s'écarter du mode (un point ↺ ramène au mode de l'application) ; changer le mode de l'application les réaligne.

### Recherche, filtres et tri

- **Texte** : noms français, noms scientifiques, synonymes et familles, sans tenir compte des accents (`benoite` → *Benoîte*).
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

- Sur téléphone, une barre en bas : **Flore · Mes plantes · ＋ Noter ici · Carte · Plus** (réglages, sauvegarde). Sur ordinateur, les mêmes entrées sont dans l'en-tête.
- **Noter ici** : le GPS démarre, des suggestions s'affichent (plantes des lieux à moins de 200 m, favoris, plantes récentes) ; un toucher sur une plante l'enregistre **dans le lieu le plus proche (< 30 m)** ou dans un nouveau lieu. Un bandeau propose **Annuler** et **Détails**.
- **Recherche vocale** 🎙 (recherche Flore et « Noter ici ») : on dit le nom, la recherche se lance. Elle utilise la reconnaissance vocale du navigateur, en français (sur Chrome l'audio part chez Google, sur Safari chez Apple ou reste sur l'appareil) ; le bouton n'apparaît que si le navigateur la propose et si le module « Dictée vocale » est actif.

### Mode cueillette (module optionnel)

*Plus → Mode cueillette.* Activé automatiquement si l'appareil contient déjà des récoltes, désactivé sinon. Désactivé, un lieu est simplement « des plantes vues ici » (abondance, notes) ; rien n'est effacé. Activé :

- journal de récolte, qualité (★), « Récolté aujourd'hui », bouton « + Récolte » ;
- badges **En saison** (récolté à ±15 jours de la date, une année quelconque) et **Bientôt** (dans les 30 prochains jours) ;
- **plantes à confondre** : noter une plante avec « Noter ici » ou « + Récolte » rappelle les plantes toxiques avec lesquelles elle est confondue (ci-dessous).

### Plantes à confondre (Anses, Centres antipoison)

Sur la fiche d'une plante comestible souvent confondue avec une plante toxique — ou de la plante toxique elle-même —, un encadré **« Peut être confondue avec… »** (rouge si l'intoxication peut être mortelle) donne la partie concernée, les **critères pour les distinguer**, les symptômes (vue Scientifique) et les sources. En vue Épurée, une ligne, les critères sur demande. Exemples : ail des ours ↔ colchique et muguet, consoude ↔ digitale, gentiane jaune ↔ vérâtre, carotte sauvage ↔ œnanthe safranée, sureau noir ↔ sureau yèble, châtaignier ↔ marronnier d'Inde.

Les données (`data/lookalikes.json`, 15 confusions) ne reprennent **que** les confusions et critères publiés par l'Anses et les Centres antipoison : aide-mémoire *Plantes toxiques et plantes comestibles : attention aux confusions !* (2020), *Vigil'Anses* n°8 (2019), articles de l'Anses sur le colchique et l'ail des ours (2025), « gare aux confusions » (2020) et les plantes de l'été (2022). Un genre entier (« Digitalis sp. ») y est noté par son seul nom. Le fichier est inclus dans l'application : l'avertissement fonctionne hors ligne.

### Mes plantes : favoris, listes et lieux

Une **collection** est un ensemble de plantes, avec ou sans position :

- **Favoris** ♥ : un toucher sur ♡ dans la liste de recherche ou sur la fiche d'une plante.
- **Listes** (« Mellifères », « À chercher cet été »…) : sans position. « Ajouter à… » sur une fiche plante coche/décoche les collections et en crée une à la volée.
- **Lieux** : une liste avec une position GPS, visible sur la carte (voir ci-dessous). « 📍 Ajouter une position » transforme une liste en lieu ; « Retirer la position » fait l'inverse.
- **Noms** : dans chaque champ de nom de collection (« Ajouter à… → Nouvelle collection », éditeur d'une nouvelle collection), les collections existantes qui correspondent sont proposées ; en choisir une y ajoute la plante au lieu de créer un doublon.

**Espèces protégées** : la fiche plante, le panneau d'une plante dans un endroit et le message de « Noter ici » signalent une **protection** (bandeau rouge) ou une **cueillette réglementée** (bandeau orange) là où l'on est, ainsi que la liste rouge. Le territoire est celui du point GPS de l'endroit (département, région, ancienne région), sinon « Ma région » choisie dans *Réglages* ; les statuts d'ailleurs restent consultables. Chaque bloc renvoie aux textes officiels sur l'INPN. La recherche a un filtre « Protection et menace ».

**Calendrier** sur la fiche plante, chargé automatiquement : floraison Baseflor (hors ligne, dans le jeu de données) et observations iNaturalist en fleurs / en fruits en France, mois par mois, chaque ligne avec sa source. Ce sont des indications de floraison et de fructification, **pas des dates de cueillette**.

L'onglet **Mes plantes** les regroupe : collections, puis endroits triés par distance. Une collection à laquelle on ajoute des coordonnées GPS devient un endroit ; toucher un endroit ouvre la carte cadrée sur son point et toutes ses plantes. Les modifications sont **enregistrées automatiquement**. Dans la recherche, le filtre **Mes plantes** limite les résultats aux favoris, à une liste, à un lieu ou à « dans un de mes lieux ».

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
- **Position de chaque plante** : « Noter ici » enregistre la plante à votre position GPS (et la rattache au lieu le plus proche à moins de 30 m). Ajoutée depuis l'éditeur, une plante prend votre position GPS si vous êtes à moins de 100 m du lieu, sinon le point du lieu. Sur la carte d'un endroit, les marqueurs sont **fixes** : son bouton **✎** permet de faire glisser le point de l'endroit (le carré) et chaque plante (les ronds), indépendamment (appui long : placer l'endroit) ; « ✓ Valider » enregistre, « Annuler » remet les positions d'avant. En mode modification, le panneau d'une plante propose aussi « Ici (GPS) » ; sinon « Déplacer » ouvre ce mode. Un nouvel endroit s'ouvre directement en mode modification.
- **Carte et lieu, une seule page** : choisir un lieu sur la Carte ouvre **toute sa fiche** à côté de la carte (à droite sur ordinateur ; en dessous sur téléphone, à moitié de la hauteur, la poignée l'agrandit) : nom, plantes avec abondance, qualité, notes et journal de récolte, « + Ajouter une plante », notes du lieu, partage, export, suppression ; en tête, le nombre de plantes, la distance et « Itinéraire ». Tout est **enregistré automatiquement**. La carte au-dessus est celle du lieu : toucher une plante sur la carte ouvre son panneau, ouvrir une plante dans la fiche la met en évidence sur la carte, « Déplacer » passe la carte en modification (✎). Un lien vers un lieu (Mes plantes, « Noter ici › Détails », fiche plante) ouvre la Carte sur ce lieu. En mode cueillette, le panneau d'une plante rappelle aussi les **plantes à confondre**.
- **Pour chaque lieu** : nom, notes (accès, propriétaire…), et ses plantes. **Pour chaque plante du lieu** : abondance, qualité (★), notes et **journal de récolte** (date, quantité, remarque). Une plante est **« en saison »** à un lieu si elle y a été récoltée, une année quelconque, à ±15 jours de la date du jour ; un lieu est en saison si l'une de ses plantes l'est.
- **Carte** : deux icônes distinctes. Un **lieu** est un carré sur pied, coloré selon l'abondance la plus forte, avec le nombre de plantes ; il est toujours visible. Une **plante** est sa **photo en miniature** dans un rond cerclé de la couleur de son abondance (une feuille si elle n'a pas de photo), à sa propre position, visible **en zoomant** (niveau 16 et plus) ; la toucher ouvre la fiche du lieu sur cette plante. Filtres « En saison » et par plante. **Choisir un lieu zoome sur lui et toutes ses plantes.** Le bouton **✎** de la carte est toujours là : sans lieu choisi, tous les lieux deviennent déplaçables ; avec un lieu choisi, ce lieu et ses plantes ; puis **✓ Valider** ou **Annuler**. Pendant la modification, la carte occupe **tout l'écran** pour travailler à l'aise, puis reprend sa place une fois validée ou annulée. Une plante sans position propre suit son lieu.
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
