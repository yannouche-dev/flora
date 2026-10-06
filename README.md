# GeoFlora — flore française

Référentiel léger destiné à une application hors-ligne de recherche dans la flore vasculaire de France métropolitaine.

## Données générées

`data/plants.json` contient des objets de la forme :

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

## Source

Le générateur interroge l'API officielle TAXREF du Muséum national d'Histoire naturelle.

Version actuellement ciblée : **TAXREF v18.0**.

Filtres :
- rang espèce (`ES`)
- France métropolitaine (`fr`)
- milieu continental
- noms de référence uniquement
- plantes vasculaires
- espèces établies retenues lorsque le statut biogéographique est exposé par l'API : `P N E S C I J`

Les noms vernaculaires sont enrichis via l'endpoint TAXREF `/taxa/{CD_NOM}/vernacularNames`.

## Génération

Node.js 20+ :

```bash
node scripts/build-plants.mjs
```

Pour un build rapide sans requêter le détail des noms vernaculaires :

```bash
node scripts/build-plants.mjs --skip-detail-names
```

La GitHub Action `Build flora dataset` génère et valide automatiquement :
- `data/plants.json`
- `data/meta.json`

## Objectif

Obtenir un fichier d'environ 6 000 espèces suffisamment compact pour être importé une seule fois dans IndexedDB et interrogé totalement hors ligne dans GeoFlora.
