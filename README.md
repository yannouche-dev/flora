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
        └── vignette distante chargée paresseusement
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
