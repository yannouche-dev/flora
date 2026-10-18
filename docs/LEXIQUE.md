# Lexique de l'interface

Les mots de l'interface de GeoFlora, chacun avec sa définition et son nom dans le code. L'interface dit toujours le mot de gauche ; le code garde le sien.

| Terme | Définition | Dans le code |
| --- | --- | --- |
| **fiche** | La page d'une plante, qui défile : ses blocs, rangés par rubrique. | plant sheet, `app/components/gf-plant-detail.js` |
| **bloc** | Une partie titrée de la fiche (Wikipédia, Calendrier, Carte, Usages, une Note…), parfois faite de sous-blocs ; se range, se masque, se renomme, se place dans un panneau. | sheet block, `app/core/sheet-blocks.js` (clé `plant.<bloc>` dans une disposition libre) |
| **rubrique** | Un groupe de blocs de la fiche sous un en-tête collé (L'essentiel, Images, Alertes, Usages…), qui répond à une question sur la plante. | category, `app/core/categories.js` (classes `rub-*`) |
| **panneau** | Une région posée à côté d'une autre, redimensionnable par son séparateur ; dans le panneau Plante, chaque panneau de l'arbre tient des blocs en onglets, à côté de la fiche. | pane, `app/core/pane-tree.js` (arbre de la fiche), `app/core/panes.js` (panneaux d'un écran) |
| **disposition** | L'arrangement des panneaux d'un écran selon sa largeur (téléphone, tablette, grand écran). | layout, `app/core/panes.js`, `config.paneLayouts` |
| **disposition libre** | Un écran composé à la main, colonnes et lignes de cases, écrit dans l'adresse `#/layout/…`. | free layout, `app/layout/` (`grammar.js`, `gf-layout.js`) |
| **case** (ou **cellule**) | Une part d'une disposition libre : un composant (carte, recherche, fiche, un bloc seul…) et ses paramètres. | layout cell, `app/layout/cells.js`, `app/layout/registry.js` |
| **marque** | Une lettre ou deux sur l'icône d'une case (É pour Épuré, F pour filtres ouverts, −L sans liste…) qui distingue deux cases d'un même composant. | cell mark, `cellMark()` dans `app/layout/registry.js` |
| **carte** (géographique) | Le fond cartographique et ses couches (IGN, observations, 2D ou 3D). | map, `app/components/gf-map.js` (et `gf-map3d.js`) |
| **carte** (à swiper) | Une plante présentée comme une carte à garder (→, ♥) ou passer (←, ✕) dans Rencontres. | card / deck, `app/miniapp/kit/ma-deck.js` |
| **mini-app** | Un jeu ou un parcours ouvert seul à l'écran (`#/app/<id>`) : Rencontres, Parcours, Cueillette, Mosaïque, Faux amis. | mini-app, `app/miniapp/` (moteur), `app/miniapps/<id>.js` (manifestes) |
| **parcours** | La mini-app de marche botanique : les plantes rencontrées, notées sur la carte du chemin, puis le bilan. | walk / trail, `app/miniapps/parcours.js`, `app/core/walk.js` |
| **zone** / **rayon** | Le cercle autour d'un lieu (centre et rayon : 500 m, 2 km…) qui limite les plantes cherchées et observées. | scope / radius, `app/layout/state.js` (`at`, `r`), `app/core/nearby.js` |
| **module** | Un service en ligne (Wikipédia, GBIF, iNaturalist…) qu'on active ou coupe dans Réglages › Modules ; coupé, il n'est jamais appelé. | module, `app/core/modules.js` |
| **mode** | Une façon d'afficher la fiche et les résultats : Épuré, Standard, Scientifique, ou un mode créé à partir d'eux ; le **Mode King** les arrange. | display mode, `app/core/modes.js` |
