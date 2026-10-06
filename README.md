# GeoFlora — flore française

Référentiel léger destiné à une application hors-ligne de recherche dans la flore vasculaire de France métropolitaine.

## Dataset actuel

Le build TAXREF v18 produit actuellement :

- **7 745 espèces**
- **180 familles**
- **1 245 genres**
- **15 487 noms vernaculaires français uniques**
- **7 177 espèces** avec au moins un nom français
- **568 espèces** sans nom français disponible dans les données TAXREF utilisées

`data/plants.json` pèse environ 1,5 Mo et contient des objets de la forme :

```json
{
  "id": 100225,
  "family": "Rosaceae",
  "genus": "Geum",
  "species": "urbanum",
  "vernacularNames": [
    "Benoîte des villes",
    "Benoîte commune",
    "Herbe de saint Benoît"
  ]
}
```

- `id` : identifiant TAXREF (`CD_NOM`)
- `family` : famille botanique
- `genus` : genre
- `species` : épithète spécifique
- `vernacularNames` : noms français disponibles, dédupliqués

## Source et sélection

Le générateur utilise l'archive officielle **TAXREF v18** diffusée par PatriNat/MNHN :

- `TAXREFv18.txt` pour la taxonomie et le statut en France métropolitaine ;
- `TAXVERNv18.txt` pour enrichir les noms vernaculaires.

Filtres actuels :

- règne `Plantae` ;
- rang espèce `ES` ;
- nom accepté uniquement (`CD_NOM = CD_REF`) ;
- groupe TAXREF `Trachéophytes` (plantes vasculaires) ;
- présence en France métropolitaine ;
- statuts `P N E S C I J`.

Les noms français de `TAXVERNv18` sont également rattachés au nom accepté lorsqu'ils sont portés par un synonyme TAXREF. Cela permet de conserver davantage de noms vernaculaires utiles à la recherche.

Le résultat de 7 745 espèces est volontairement plus large qu'un référentiel limité aux seules indigènes : il inclut aussi les espèces introduites établies retenues par les statuts ci-dessus.

## Génération locale

Node.js 20+ :

```bash
mkdir -p .cache/taxref
curl -L "https://assets.patrinat.fr/files/referentiel/TAXREF_v18_2025.zip" -o .cache/taxref.zip
unzip .cache/taxref.zip -d .cache/taxref
node scripts/build-plants.mjs
```

La GitHub Action `Build flora dataset` télécharge la source officielle, génère, valide puis versionne automatiquement :

- `data/plants.json`
- `data/meta.json`

## Utilisation GeoFlora

Le fichier est volontairement compact afin d'être importé une seule fois dans IndexedDB puis interrogé totalement hors ligne.

Structure IndexedDB recommandée :

```text
plants
 ├─ id
 ├─ family
 ├─ genus
 ├─ species
 └─ vernacularNames[]

indexes
 ├─ by_family
 ├─ by_genus
 └─ by_taxon [genus, species]
```

Une seconde passe avec BDTFX/Tela Botanica pourra être utilisée pour enrichir encore les noms vernaculaires, notamment pour les espèces actuellement sans nom français dans TAXREF.
