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

## Enrichissement distant

`lib/plant-sources.mjs` fournit une couche ES6 sans dépendance pour enrichir une plante au moment où elle devient visible ou lorsque l'utilisateur ouvre sa fiche.

Sources actuellement prises en charge :

- **GBIF** : résolution taxonomique, médias, descriptions, noms vernaculaires, répartition ;
- **iNaturalist** : taxon, nombre d'observations et photo par défaut lorsque sa licence est libre ;
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

### Mode cueillette (module optionnel)

*Plus → Mode cueillette.* Activé automatiquement si l'appareil contient déjà des récoltes, désactivé sinon. Désactivé, un lieu est simplement « des plantes vues ici » (abondance, notes) ; rien n'est effacé. Activé :

- journal de récolte, qualité (★), « Récolté aujourd'hui », bouton « + Récolte » ;
- badges **En saison** (récolté à ±15 jours de la date, une année quelconque) et **Bientôt** (dans les 30 prochains jours) ;

### Mes plantes : favoris, listes et lieux

Une **collection** est un ensemble de plantes, avec ou sans position :

- **Favoris** ♥ : un toucher sur ♡ dans la liste de recherche ou sur la fiche d'une plante.
- **Listes** (« Mellifères », « À chercher cet été »…) : sans position. « Ajouter à… » sur une fiche plante coche/décoche les collections et en crée une à la volée.
- **Lieux** : une liste avec une position GPS, visible sur la carte (voir ci-dessous). « 📍 Ajouter une position » transforme une liste en lieu ; « Retirer la position » fait l'inverse.

L'onglet **Mes plantes** les regroupe (lieux triés par distance). Les modifications sont **enregistrées automatiquement**. Dans la recherche, le filtre **Mes plantes** limite les résultats aux favoris, à une liste, à un lieu ou à « dans un de mes lieux ».

**Partager** sans serveur :

- une plante : lien `#/plant/<id>` ;
- une recherche (famille, statut…) : bouton *Partager* au-dessus des résultats, l'URL contient les filtres ;
- une liste ou un lieu : le lien contient la collection elle-même (`#/shared?d=…`, JSON compressé deflate + base64url, ~200 caractères pour 30 plantes). Notes et journaux de récolte ne sont **jamais** inclus ; pour un lieu, la position exacte l'est (confirmation demandée). Le destinataire voit un aperçu et peut l'enregistrer comme nouvelle collection.

### Lieux de récolte

L'onglet **Carte** enregistre les endroits où vous récoltez, sur les **photos aériennes IGN** (Géoplateforme, sans clé ; aussi Plan IGN et parcelles cadastrales). Un **lieu** est une **collection de plantes** : une lisière peut réunir l'ail des ours, l'ortie et la benoîte.

- **Sur place** : depuis une fiche plante, « 📍 Ajouter un lieu », ou **+** sur la carte. Le GPS s'affiche avec sa précision (± m) ; l'épingle peut être déplacée à la main, ou posée par un appui long sur la carte. À moins de 100 m d'un lieu existant, l'application propose d'**y ajouter la plante** plutôt que de créer un doublon.
- **Pour chaque lieu** : nom, notes (accès, propriétaire…), et ses plantes. **Pour chaque plante du lieu** : abondance, qualité (★), notes et **journal de récolte** (date, quantité, remarque). Une plante est **« en saison »** à un lieu si elle y a été récoltée, une année quelconque, à ±15 jours de la date du jour ; un lieu est en saison si l'une de ses plantes l'est.
- **Carte** : une épingle par lieu, colorée selon l'abondance la plus forte, avec le nombre de plantes quand il y en a plusieurs. Filtres « En saison » et par plante. La fiche du lieu liste ses plantes avec un bouton « + Récolte » chacune, « + Plante », et l'itinéraire vers l'application de navigation. **Liste** triée par distance.
- **Hors ligne** : le GPS et les lieux fonctionnent toujours ; les zones de carte déjà affichées restent disponibles (3 000 tuiles en cache).
- **Confidentialité** : les lieux restent **sur l'appareil** (IndexedDB, stockage persistant demandé). Ils sont stockés au format **GeoJSON** : *Réglages → Exporter* produit un fichier `.geojson` lisible par QGIS, uMap, geojson.io…, et *Importer* le fusionne (même identifiant → la version la plus récente l'emporte ; l'ancien format à une plante par point est aussi accepté). Pensez à exporter régulièrement.

```json
{
  "type": "Feature",
  "id": "c0f3…",
  "geometry": { "type": "Point", "coordinates": [4.8357, 45.7641] },
  "properties": {
    "name": "Lisière nord",
    "notes": "Parking au bout du chemin",
    "accuracy": 8, "createdAt": "…", "updatedAt": "…",
    "plants": [
      {
        "plantId": 81541, "scientificName": "Allium ursinum", "vernacularName": "Ail des ours",
        "abundance": "abondant", "rating": 4, "notes": "", "addedAt": "…",
        "harvests": [{ "date": "2026-04-12", "quantity": "1 kg", "note": "" }]
      }
    ],
    "plantIds": [81541]
  }
}
```

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
