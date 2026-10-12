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

### Scénarios (l'icône film)

L'icône film de l'en-tête (ordinateur et téléphone) propose des façons d'entrer dans l'application, chacune avec les outils qu'il lui faut :
- **Rencontres** : les plantes observées autour de vous, à la Tinder (ci-dessous).
- **Cueillette prudente** : autour de vous, seulement les plantes qui comptent pour la cueillette — les comestibles de la liste de l'Anses et des Centres antipoison et leurs sosies toxiques —, les confusions mortelles d'abord ; la bio de chaque carte commence par la confusion (« Ne me confondez pas avec Colchique (mortel). Partie : feuilles. ») ; un bandeau rappelle de ne jamais cueillir sans identification certaine ; le mode cueillette s'allume.
- **Mosaïque** : toutes les photos des plantes du coin en grande mosaïque, filtre « En fleur maintenant » ; une photo touchée ouvre la fiche à ses images.
- **Scientifique** : le mode Scientifique, tous les outils, la flore complète.
- **Parcours botanique** : marchez et nommez les plantes que vous croisez (ci-dessous).
- Bientôt : « La carte d'abord », « Tableau de bord scientifique ».

### Illustrations des scénarios

Chaque scénario a son image d'accueil, **composée des icônes de l'application** (Bootstrap Icons, le même sprite) : des pastilles rondes colorées façon autocollant (l'icône sur un disque cerclé, une ombre décalée), quelques icônes libres, un sol vert pâle. **Parcours botanique** : un chemin en pointillés d'un repère à un drapeau, fleurs, feuilles et arbre le long, une feuille portée par le vent, soleil et nuage — rien que des plantes ; **Rencontres** : un éventail de cartes de plantes, un cœur, des jumelles ; **Cueillette prudente** : un panier entouré de ce qui se cueille, le bouclier de la prudence et un avertissement ; **Mosaïque** : des tuiles de photos, fleurs et feuilles, légèrement de travers. Les pastilles apparaissent une à une puis flottent doucement, le chemin se trace (immobile si les animations sont réduites) ; couleurs en variables, le mode sombre suit. Le titre et le texte d'accueil sont propres à chaque scénario. (`app/core/scenes.js`.)

**Le logo GeoFlora** est au centre de l'en-tête, plus grand (38 px, le nom en vert à côté), discret : les sections à gauche, les outils à droite ; sur téléphone, le logo et son nom au centre ; entre 700 et 1 100 px, le logo seul (et « Noter ici » en icône sous 900 px), sans débordement.

### Parcours botanique

Le plus simple des modes : un parcours, c'est un lieu de « Mes plantes » où chaque plante notée garde l'endroit où vous l'avez vue.
- **Une petite application à part** : pendant le Parcours, le reste de GeoFlora est hors d'atteinte — la barre d'onglets (téléphone), les sections, « Noter ici », le mode et les réglages (ordinateur) restent visibles mais **grisés et inactifs**, le logo n'est plus un lien. On en sort par le bouton **Scénarios** (en haut à droite), aussi proposé sur l'écran d'accueil du parcours : « Quitter le parcours : autres scénarios ». La fiche d'une plante ouverte par son adresse dans le parcours (`#/discover?s=trail&p=…`) s'affiche par-dessus le parcours, sans les actions qui en feraient sortir (Carte, Noter ici), et « Retour au parcours » y ramène.
- **Démarrer** : l'écran d'accueil montre **un chemin parmi les fleurs**, fait des icônes de l'app (voir « Illustrations des scénarios ») ; « Commencer ici » (votre position) ou une commune ; les parcours déjà commencés se reprennent d'un toucher.
- **Son nom, tout seul** : « Commencer ici » nomme le parcours d'après **le lieu le plus précis que connaît l'IGN là où vous êtes** — « Mon parcours botanique en forêt de Chatel-Guyon », « au bois de Vincennes », « au jardin des Plantes », « au parc de la Tête d'Or », « au puy de Dôme (Orcines) », « au Roc Errant (Châtel-Guyon) », sinon « à Chazemais » (la commune). Dans l'ordre : un parc, un jardin, un square, un arboretum où vous êtes ; une forêt publique où vous êtes (« Forêt communale de … » devient « forêt de … ») ; un bois nommé assez proche pour sa taille (jusqu'à 1,2 km pour un grand bois) ; un sommet, un col, une vallée ; le lieu-dit ou le hameau le plus proche (250 m), avec sa commune entre parenthèses ; le quartier ; la commune. Les noms historiques, génériques ou égaux à la commune sont écartés ; la préposition suit le mot (« en forêt », « au bois », « aux gorges », « à l'arboretum », « au château »…). GPS imprécis (plus de 250 m) : la commune seule. Le temps que l'IGN réponde (8 s au plus, une requête refusée pour surcharge est reposée une fois), le parcours s'appelle « Mon parcours botanique » ; un nom changé entre-temps n'est jamais remplacé. Parti d'une commune : « Mon parcours botanique à Châtel-Guyon », « au Mont-Dore ». Source : IGN Géoplateforme (WFS BD TOPO® — `zone_d_activite_ou_d_interet`, `foret_publique`, `lieu_dit_non_habite`, `detail_orographique`, `zone_d_habitation` — et ADMIN EXPRESS pour la commune ; sept petites requêtes en parallèle, gardées un an sur l'appareil ; module « IGN – adresses et altitudes »).
- **Sur téléphone, tout tient sur un écran** (la barre d'onglets, grisée, ne sert pas) : en haut l'en-tête du parcours, puis **la carte, toujours visible**, puis la liste des plantes notées, et **la recherche en bas, sous le pouce** — les propositions s'ouvrent au-dessus d'elle. Sur grand écran, la même colonne à gauche (recherche en bas), la carte à droite.
- **L'en-tête du parcours** (petit, sobre) : **son nom en entier** (sur deux lignes au plus), toujours modifiable (✎) et **enregistré pendant la frappe** (Échap rend le nom d'avant) ; ce qui a été noté (« 12 observations · 9 plantes »), la précision du GPS ; deux icônes discrètes : **Partager** (un lien qui porte le parcours, sa carte et ses plantes : la feuille de partage du téléphone, ou copié) et **Terminer** (drapeau ; le parcours reste dans Mes plantes). Tout est enregistré au fil de l'eau, sans bouton « Enregistrer ».
- **Nommer une plante** : un grand champ, au clavier ou à la voix. **Le micro est un gros bouton rond à côté du champ, sous le pouce** : il réagit dès le toucher (vibration courte, il rougit), pulse quand la reconnaissance vocale du système (Android, iOS, via le navigateur) écoute, et le champ dit « Parlez : « ortie »… » ; les mots s'affichent pendant qu'on parle. Sans reconnaissance vocale dans le navigateur, le même bouton place le curseur dans le champ et invite à **dicter avec le micro du clavier** ; la dictée du clavier n'est jamais perturbée par l'app (le champ n'est pas réécrit pendant la saisie) ; la flore propose les plantes qui correspondent, avec photo, famille et un gros bouton « ＋ Ajouter » — toutes celles que trouve la recherche principale, 12 d'abord puis « Voir plus » ; Entrée ajoute la première, toujours pour le nom complet tapé. La plante est posée là où vous êtes ; « Annuler » la retire aussitôt.
- **La même plante, plusieurs fois** : une ortie rencontrée plus loin s'ajoute encore (« ＋ Encore », la proposition dit « Déjà une fois dans le parcours ») ; chaque **occurrence** a sa position.
- **La liste** des plantes du parcours, qui défile : **une ligne par plante**, sa vignette (photo), ses noms et, rencontrée plusieurs fois, « × 3 » ; la dernière rencontrée en haut. **Toucher une plante** (dans la liste ou sur la carte) l'allume : **ses occurrences en évidence sur la carte** (les autres plantes s'estompent), cadrées avec votre position, et **dans l'en-tête** son nom, **« Ajouter ici »** — une occurrence de plus, là où vous êtes — et ✕, qui retire l'occurrence touchée sur la carte (sinon la dernière), avec « Annuler ». La toucher à nouveau l'éteint.
- **La carte** : **un marqueur par occurrence** (pas de repère qui les regroupe), avec votre position qui suit ; elle est **toujours cadrée sur tout le parcours** (son départ et chaque plante), et se recadre à chaque ajout.

### Découvrir : les plantes autour de vous (premiers pas)

- **À la première ouverture**, une seule action : « Autour de moi » (la position n'est demandée qu'à ce moment) ou une commune. Puis **jusqu'où chercher** : un curseur de 200 m à 50 km (« Juste devant la porte », « Le quartier », « Une balade à pied », « Un tour à vélo », « Toute la région »), **par-dessus une carte** : le cercle du rayon, bien visible et qui respire doucement, cadré quelle que soit la taille de l'écran, et les observations de plantes qu'il contient (iNaturalist : leur nombre total, et **les 100 plus récentes** sur la carte), **chacune la photo de sa plante** dans un rond qui apparaît l'un après l'autre ; **au survol, une petite fiche** : sa photo, son nom, son nom scientifique, la date et le lieu de l'observation (un toucher ouvre l'observation) ; changer le rayon fait glisser la carte, sans flash. Les cartes des écrans Découvrir n'affichent pas d'alertes de zones protégées.
- **Rencontres, à la Tinder** : les plantes observées dans ce rayon (iNaturalist, observations confirmées, reliées à la flore embarquée), une carte à la fois, **les plus observées — donc les plus photographiées — d'abord**. Chaque carte dit **« On dit de moi : … »** (la première phrase de l'étymologie ou de l'histoire de son article Wikipédia, CC BY-SA ; demandé seulement pour les cartes en vue) et a sa « bio », tirée de ses vraies données : floraison, alertes (toxique, protégée, sosies dangereux pour une comestible), popularité dans le coin (en mots, sans chiffre : « Très populaire par ici », « Rare par ici »), famille. **Glisser à droite** : c'est un match (« C'est un match ! »), la plante rejoint les favoris ; **à gauche** : on passe ; **vers le haut** (ou toucher, ou ⋯) : sa fiche. Au clavier : ← →, ↑. Fin du paquet : « Chercher jusqu'à 5 km », « Revoir celles passées ». À l'arrivée des cartes, la première **penche un instant à droite puis à gauche** (ses tampons « MATCH » puis « BOF » apparaissent) pour montrer qu'elles se glissent — une fois par ouverture de l'application, pas si les animations sont réduites. Une carte est décidée à 30 % de sa largeur, ou d'un geste vif ; celle de dessous monte telle quelle (pas de clignotement). **↺** revient sur la dernière carte (un match annulé quitte aussi les favoris) ; dans Matchs, « Retirer ». Un match fait vibrer le téléphone.
- **Matchs** réunit les plantes gardées, **Toutes** les montre en grille (pastilles « En fleur », « Attention · 3 »).
- **La découverte pas à pas, du simple au complexe** (Rencontres) : **une seule mise en page, transformée à chaque étape** — chaque étape y ajoute un composant à découvrir. **Une barre d'étapes**, toujours en haut (dans la mise en page, jamais par-dessus) : Carte · Rencontres · Photos · Encyclopédie · Cueillette ou science · Voisines, celles faites cochées, celle en cours en vert, une ligne qui dit ce qu'elle montre et ce qui vient ; **‹ Précédent** et le bouton de la suivante, qui dit ce qu'elle ajoute (à la fourche, les deux chemins). Sur téléphone, les numéros seuls et le nom de l'étape en cours. **Les étapes se touchent** : une étape déjà atteinte y ramène (la mise en page de cette étape), la suivante avance comme le bouton (sauf la fourche, qui se choisit par ses deux boutons) ; les autres attendent, et chacune dit au survol ce qu'elle apporte. Pendant la découverte, pas de bulle « Nouveau : … » par-dessus : l'onglet arrive simplement dans la barre.
  1. **Carte** : la carte seule, le cercle et un **panneau d'accueil** posé dessus (en bas sur téléphone, à droite sur ordinateur — le cercle se cadre à côté) : « Jusqu'où part l'expédition ? », le lieu (changer de lieu), la distance et son curseur, ce qui a été vu (« 842 observations de plantes, 37 espèces différentes », quelques visages en vignettes) et le gros bouton **« Qui pousse par ici ? »** qui fait venir les cartes. À cette étape, toucher un point de la carte ne fait rien d'autre que montrer sa petite fiche.
  2. **Rencontres** : la même carte glisse à gauche (en haut sur téléphone), **les cartes arrivent à côté** — **rien d'autre : la carte, le bloc du lieu (distance, changer de lieu) et les cartes**, sans légende chiffrée, ni groupes chiffrés sur la carte (au plus 250 feuilles pour la plante en vue), ni « Où pousse-t-elle encore ? » (la carte reste sur le cercle autour de vous). La plante sur le dessus s'allume sur la carte (ses observations en grandes feuilles rose et or, les autres s'estompent). **Toucher une plante sur la carte la met sur le dessus du paquet** (une carte passée revient ; une plante déjà aimée s'affiche dans les volets) : les cartes, les médias et la carte la suivent ; une plante qui n'est pas parmi les rencontres est signalée.
  3. **Photos** : **dès le premier coup de cœur** (ou « Ses photos »), un troisième bloc, **Médias**, à côté des cartes, **zoomé** : la première photo s'agrandit doucement, une astuce dit comment zoomer et que le cadenas garde le zoom. **Les médias montrent la plante qu'on vient d'aimer** (après un « Bof » puis un coup de cœur, c'est bien celle-ci), puis suivent le paquet : une carte passée montre celle du dessus ; une plante touchée sur la carte ou parmi les voisines s'y affiche. Les volets prennent toute la largeur qui leur revient, même un volet seul sur grand écran.
  À partir de l'étape Photos, une légende dit la plante en vue et son nombre d'observations ; dès le premier match, **« Où pousse-t-elle encore ? »** propose, pour la plante en vue, sa portée : Autour (le cercle), **son département**, **sa région** (d'après l'adresse IGN du lieu), **la France**, **le Monde** — la carte glisse jusqu'à la zone (contour tracé pour un département ou une région), ses observations iNaturalist y sont placées et regroupées (rose et or, jusqu'aux 1 000 plus récentes), la légende dit combien (« 2 345 observations en France, 1 000 sur la carte »).
  4. **Encyclopédie** : un volet Wikipédia sous les photos.
  5. **Cueillette ou science** : la cueillette ajoute un volet *Usages · À ne pas confondre · Calendrier* ; la science, *Carte · Occurrences · Climat · Classification*.
  6. **Voisines** : la liste des plantes autour, sous la carte ; puis **La flore complète** : la fiche dans Flore, sur cette plante, tous les onglets, en mode cueillette ou Scientifique selon le chemin choisi.
  **Seuls les volets des étapes franchies** s'affichent pendant la découverte (une carte ou un autre volet déjà dans la mise en page du mode n'y apparaît pas) ; ils rejoignent la mise en page du mode, que Flore montrera ensuite. « Précédent » revient d'une étape (avant la fourche, le chemin choisi est oublié ; depuis Rencontres, retour à la carte seule).
  Les volets suivent **la carte sur le dessus du paquet** : la garder (→, ♥, glisser à droite) ou la passer (←, ✕, glisser à gauche) montre la suivante ; une plante touchée parmi les voisines s'affiche dans les volets. La découverte a sa propre adresse (`#/discover`) : l'arrivée de Flore en cours de route ne la remplace plus.
- **La fiche**, hors découverte (une fois tout montré, ou une carte touchée avant le premier match), s'ouvre en Épuré, par-dessus la liste sur téléphone, à côté sur ordinateur, avec « ‹ Préc. · 3 / 15 · Suivante › » (et ← →, le balayage) ; l'adresse `#/discover?p=<id>` la garde.
- **Les outils arrivent quand ils servent** : la barre d'onglets ne montre d'abord que Découvrir (et Réglages) ; **Mes plantes** vient avec le premier match ou favori, la **Carte** avec le premier lieu noté, **Flore** (toute la flore, recherche et filtres) après 5 plantes rencontrées — chaque fois annoncé (« Nouveau : la Carte — … », l'onglet s'éclaire). Pas de micro-astuces : les outils se présentent par les étapes.
- Quelqu'un qui utilisait déjà l'application garde tout, tout de suite. *Réglages › Premiers pas* : « Tout montrer maintenant » ou « Recommencer la découverte ».
- **Rejouer** (icône film › Rencontres, ou « Recommencer la découverte ») repart de zéro : lieu, distance, cartes passées, matchs, étapes, embranchement et onglets venus sont oubliés (les favoris restent). Rejouer Cueillette prudente ou Mosaïque (le scénario affiché) oublie le lieu, la distance et les cartes ; passer d'un scénario à un autre garde le lieu choisi.

### Onglet Flore : filtres, résultats, plante

- **Ordinateur** : trois panneaux côte à côte, **Filtres ┃ Résultats ┃ Plante**. Chacun se replie (« / ») en une fine barre verticale et se redimensionne en tirant les séparateurs (ou ←/→ au clavier, double-clic pour la largeur par défaut) ; largeurs et panneaux repliés sont mémorisés. Toucher un résultat ouvre la fiche dans le panneau Plante (l'adresse `#/plant/<id>` reste partageable) ; ⤢ la passe en pleine largeur, × la ferme.
- **Recherche** en haut des résultats (« Ex. : ortie, Urtica dioica, ger rob, Lamiaceae »). Sous elle, **« Filtrer par »** propose les familles et genres qui commencent par le texte ; en choisir un le met en filtre (le texte s'efface) **et garde les autres propositions**, celle choisie allumée — retouchée, elle s'éteint ; tout éteint, le texte revient.
- **Filtres** : chaque en-tête de filtre reste **toujours visible** — collé en haut une fois dépassé, **empilé en bas tant qu'il est à venir**. Toucher un en-tête collé dont la liste est hors de vue y défile en douceur (sans la replier) ; liste en vue, il la replie. Le champ « Filtrer famille… » reste collé sous son en-tête, sur fond plein, pendant la saisie — même quand le texte tapé réduit la liste à une seule valeur.
- **Sans saut** : ouvrir une plante depuis les résultats ne recharge rien d'autre — la liste, les filtres et leur défilement restent tels quels, rien ne bouge sous l'en-tête.
- **Grille des résultats** : Photo, Nom français, puis Famille, Genre, Espèce (l'épithète, le genre ayant sa colonne), Statut, Protection, et les actions ♥ (favori) et 📍 (noter où je la trouve ; pleine si la plante est déjà dans un de mes lieux, elle ouvre alors la carte). Trois affichages, au choix par les icônes au-dessus de la grille (lignes · photo · tableau) : **Standard** (sans statut ni protection), **Épuré** (grandes photos, nom français sur le nom scientifique complet) et **Scientifique** (toutes les colonnes, auteur compris). Cliquer un en-tête trie par cette colonne, recliquer inverse l'ordre (`sort=-family` dans l'URL) ; un en-tête dont le filtre est actif affiche son nombre de valeurs, qui ouvre ce filtre. Quand le panneau est étroit, Genre (et Statut) se masquent, puis la liste repasse en fiches.
- **Tablette** : filtres en feuille, Résultats ┃ Plante. **Téléphone** : fiches, et la plante s'ouvre en plein écran par-dessus la liste (« ← Résultats » revient au même endroit).
- **Fiche plante : des blocs** : la fiche est faite des mêmes blocs dans les trois modes, en-tête compris : Nom, Photos, Protection et statuts, Plantes à confondre, Classification, Mes collections, Calendrier, Wikipédia, Descriptions, Noms, Occurrences et répartition, Carte, Médias GBIF, Habitat et écologie (GBIF), Trefle, Publications (GBIF), Identifiants, Ressources, et les blocs Note que l'on crée. Chacun est montré à la manière du mode (compact en Épuré, complet en Scientifique ; en Épuré, Noms n'est que la liste des noms français, style réglable en mode King ; Noms (TAXREF et GBIF, en français ; les autres langues seulement si « Autres langues » est coché) ne reprend pas le nom sous lequel la plante est affichée ni les doublons, et n'apparaît pas si la plante n'a pas d'autre nom ; de même, Wikipédia n'apparaît pas sans article) ; par défaut Nom, Photos et Wikipédia se lisent sans titre (le résumé Wikipédia porte sa source : « Source : article Wikipédia »), au choix en mode King ; un bloc sans donnée pour la plante le dit. Certains ont des **sous-blocs** (les lignes de Classification, Occurrences, Noms, Protection, chaque lien de Ressources et chaque Identifiant).
- **Même affichage d'une plante à l'autre** : en parcourant les résultats, la plante suivante s'ouvre comme la précédente — **à la même rubrique**, au même bloc s'il est là (lue sur « Carte », la suivante s'ouvre sur « Carte » ; sinon au début de la rubrique), dans Wikipédia au thème lu dès que l'article arrive — avec les mêmes choix dans les Médias (type, partie de la plante, zoom verrouillé au cadenas, détails ⓘ, diaporama), les mêmes volets ouverts, les thèmes Wikipédia ouverts, « Mes lieux » déplié. **Jamais cachée, jamais de saut** : la fiche apparaît tout de suite à cet endroit (l'en-tête d'une rubrique est là sans attendre les données) et y reste pendant que ses blocs se chargent. Pour la durée de la visite (en mémoire, rien d'enregistré).
- **Wikipédia, lu comme un article** : une seule requête apporte l'article entier (texte brut découpé par section), en cache 7 jours. Le bloc Wikipédia porte **dans son en-tête le sommaire de l'article** par thème — Description, Biologie et floraison, Habitat et écologie, Répartition, Toxicité et confusions, Alimentation, Usages, Noms et étymologie, Histoire et symbolique, Taxonomie —, collé en haut pendant la lecture, le thème lu allumé. Toucher un thème l'ouvre et y mène (une ancre par thème) ; **Description est ouverte d'emblée**, les autres repliées. Les références, liens, galeries et le statut de protection (l'INPN fait foi) sont laissés de côté. Sans article en français : « Lire l'article en anglais ».
- **Wikipédia dans les autres blocs** : chaque thème s'affiche aussi sous les données du bloc qui en parle — Description dans Descriptions, Biologie dans Calendrier, Habitat dans Habitat et écologie, Répartition dans Occurrences, Toxicité / Alimentation / Usages dans Usages et cuisine sauvage, Étymologie dans Noms —, en début de texte (« Lire la suite »), avec « D'après Wikipédia · CC BY-SA 4.0 · Lire dans l'article » qui ramène à son ancre ; dans l'article, « aussi dans « Usages… » → » mène au bloc. Un bloc sans donnée propre s'affiche dès que Wikipédia en parle.
- **Wikidata** : les autres noms français de l'élément (alias, CC0) rejoignent Noms, dédoublonnés.
- **Noms** : les autres noms, en italique et plus petits, sans doublons — même écrits autrement (majuscules, accents, traits d'union, article, pluriel : « Orties », « l'ortie », « Ortie-dioïque ») ou donnés en liste (« grande ortie, ortie dioïque ») ; la forme la mieux écrite (accentuée) est gardée.
- **Les rubriques, comme les filtres** : les blocs de la fiche sont **rangés par rubrique** — dans l'ordre du mode : une rubrique vient là où vient son premier bloc, et l'ordre du Mode King vaut à l'intérieur de chaque rubrique — chaque rubrique sous **son en-tête** (icône, nom, nombre d'alertes), **collé tant qu'on la lit**. Rubriques : **L'essentiel** (classification, noms, identifiants), **Images**, **Alertes**, **Usages** (usages et cuisine sauvage, Wikibooks), **Saisons**, **Encyclopédie** (Wikipédia, descriptions, publications, Trefle, ressources), **Écologie et climat**, **Répartition**, **Carte et territoire**, **Outils et notes**. Une rubrique est là dès que le mode a un bloc pour elle, quelles que soient les données de la plante (« Rien dans les sources consultées » sinon) : la pile garde ses places d'une plante à l'autre.
  - **Quand la place le permet** (au moins 62 % de la fiche restent à lire une fois le titre du bloc collé lui aussi : grand écran, fiche haute…), **toutes les rubriques sont empilées**, comme les en-têtes des filtres : celles déjà passées en haut, celles à venir en bas (au-dessus de la barre d'actions) — toujours toutes en vue, chacune à un toucher. **Sinon** (téléphone, volet bas) : la rubrique lue seule en haut, poussée par la suivante quand on y arrive. Sous l'en-tête, **le titre du bloc lu** reste collé, puis **le thème de l'article lu** dans Wikipédia. Où l'on en est, c'est ce qui est collé : rien n'est calculé pendant le défilement, rien ne clignote, l'en-tête de l'application ne bouge pas. La disposition ne bascule pas pour quelques pixels (la barre d'adresse d'un téléphone qui apparaît) : la pile complète reste jusqu'à 52 % ; quand elle change, la place atteinte (si la main n'a pas bougé depuis) est rejointe sous la nouvelle pile. Ce qui est collé en haut et en bas compte aussi pour le clavier : « Page suivante » et Espace montrent les lignes suivantes sans en sauter, et un élément atteint par Tab n'est jamais caché sous une pile ; un contrôle collé (en-tête, titre de bloc, barre d'actions) qui reçoit le focus ne fait pas défiler la fiche.
  - **Toucher un en-tête** mène au début de la rubrique, juste sous les en-têtes collés au-dessus (son en-tête s'éclaire), dans les deux dispositions. Le **Sommaire** (☰ au bout de chaque en-tête ; touché de nouveau, il se ferme) s'ouvre par-dessus tout, sous l'en-tête — ou au-dessus quand la place manque en dessous (pile du bas), toujours entier à l'écran : ce qu'est la fiche (« Espèce », « Sous-espèce », « Variété », « Hybride », « Genre »), chaque rubrique, ses blocs, les **thèmes de l'article Wikipédia** — un toucher y mène —, **la place lue marquée**, et **le cadenas**. Au clavier, le focus y entre (↑ ↓, Début, Fin), Échap le ferme et revient au ☰ — sans fermer la plante dans Découvrir ni en changer avec ← → ; une entrée choisie y mène et le focus la suit (Tab continue de là). Il se ferme quand la main fait défiler la fiche, pas quand le contenu arrive pendant qu'il est ouvert. Une rubrique dont les blocs sont dans un volet le dit (« dans un volet ») et, touchée, déplie le volet sur le bon onglet ; un thème de l'article choisi quand Wikipédia est dans un volet fait défiler ce volet, pas la fiche.
  - **Les places tombent pile et y restent** : une rubrique, un bloc ou un thème vient exactement sous ce qui est collé au-dessus de lui — d'un coup, en glissant seulement si c'est à moins d'un écran (pas avec « animations réduites ») — puis **reste en place pendant que le contenu au-dessus arrive** (photos, article, données) — tant que les données de la plante arrivent, même lentement, et jusqu'à ce que la fiche ne grandisse plus — ou jusqu'au premier geste de la main (molette, toucher, clavier) : la main a toujours le dernier mot, la fiche ne s'aimante jamais. **Lire à la main pendant le chargement** ne fait pas sauter non plus : quand la main s'arrête et se lève, la ligne lue (ou le début du bloc lu, encore vide) reste où elle est jusqu'à la fin du chargement — jamais sous un doigt encore posé ni sous le pouce de la barre de défilement, et tout défilement qui ne vient pas de la fiche la rend à la main. Une source qui ne répond pas ne compte plus au bout de 15 s. Changer de vue (Épuré, Standard, Scientifique) ou passer en Mode King et en revenir garde le bloc lu en vue. La fin de la fiche laisse la place pour que la dernière rubrique vienne en haut, elle aussi.
  - **La mémoire** (la place où s'ouvrira la plante suivante) s'écrit quand on choisit une place — Sommaire, en-tête, menu de l'article, « Lire dans l'article », une carte de la fiche mise en avant — et quand la main arrête la fiche (même si l'on passe aussitôt à la plante suivante) — jamais pendant un défilement de l'app. **Le cadenas** (dans le Sommaire) la verrouille : chaque plante s'ouvre à l'endroit lu au moment du verrouillage, même si l'on a défilé ailleurs entre-temps (choisir une place déplace le verrou).
  - **Mode King** : la liste simple des blocs, chacun avec sa poignée (ranger, masquer, renommer), sans rubriques collées.
  - Dans Flore, Mes plantes et Découvrir, l'en-tête du panneau Plante dit simplement « Plante » (Découvrir : le nom de la plante) ; les rubriques sont dans la fiche.
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
  - **le sujet de la carte** (en tête de sa portée) : **Cette plante** (sa répartition, mes lieux où elle est, ce qui est autour, ses sosies, une zone touchée), **Les résultats** (les plantes de la recherche et de ses filtres : mes lieux où elles sont, la carte suit quand les filtres changent) ou **une collection** (un lieu : lui et ses plantes ; une liste ou les favoris : les lieux où sont ses plantes). Hors « Cette plante », les couches propres à la plante (GBIF, autour de moi, sosies) s'effacent ; le cadrage suit les lieux montrés. Gardé pour cette carte (et dans ses réglages du mode King).
  - **la portée de la carte, sous elle** : tout ce qu'elle peut montrer, proposé selon ce qui est connu. **Cadrer** : Auto (selon ce qui est affiché), **Ma région** dès que votre région est connue (votre dernière position, ou le lieu choisi dans Découvrir ; la région vient de l'adresse IGN), **Autour de moi** (vous localise si besoin), **Les points** quand il y en a, France, Monde. **Rayon** (500 m à 10 km), dès qu'on cadre autour de soi ou qu'on montre ce qui est autour : gardé comme dans la Carte, les observations sont recherchées à nouveau. **Données** : la répartition GBIF (France ou Monde), Mes lieux, les observations **iNaturalist** et **GBIF autour de moi** (avec leur nombre), et **les sosies** de la plante (« Sosie : Colchique » pour l'ail des ours : leur répartition GBIF en violet, à côté). **Couches IGN** : parcelles, courbes de niveau, forêts publiques, parcs nationaux, réserves naturelles, protection de biotope. Chaque choix est gardé pour cette carte, comme dans ses réglages du mode King.
  - **une zone touchée dans la fiche** (une région, un département, dans Occurrences et répartition) : la carte **attend d'avoir la zone** — son contour et ses occurrences, demandés ensemble — puis **glisse en douceur** jusqu'à elle, sans repasser par la vue par défaut ; d'une région à une autre, elle va directement de l'une à l'autre. **Le contour** de la zone est tracé (pointillés ambrés, IGN ADMIN EXPRESS, pour les régions et départements français) et **ses occurrences** placées en points (jusqu'à 300), **regroupés** quand ils sont proches : un disque avec leur nombre, plus grand quand ils sont plus nombreux ; **le toucher déploie ses points** en éventail autour de lui, chacun relié à sa place (sa fiche au survol, son enregistrement au clic) — un très gros groupe (plus de 24) zoome d'abord sur sa zone ; un toucher ailleurs ou un zoom les regroupe. Les observations autour de moi sont regroupées de même, chaque source dans sa couleur (iNaturalist vert, GBIF bleu). La légende dit combien d'occurrences, combien placées, et les limites tracées. ✕ sur la pastille de la zone : retour en douceur.
    - ce qu'elle montre, à cumuler : répartition GBIF (France ou monde), mes lieux de cette plante (et chaque plant à sa position), observations proches (iNaturalist, GBIF ou les deux, dans le rayon d'« Autour » ; la position n'est demandée qu'au premier toucher de « Observations autour de moi ») ;
    - son fond (plan IGN ou photos aériennes) et ses couches IGN (cadastre, courbes, forêts publiques, espaces protégés), propres à cette carte : le bouton « couches » de la carte les change aussi, sans toucher au choix de l'onglet Carte ;
    - son cadrage (France entière, ajusté à ce qui est affiché, autour de moi) et sa hauteur ;
    - ses actions : « Ouvrir dans la Carte » (l'onglet Carte filtré sur la plante, avec sa répartition GBIF), créer un endroit ici (appui long : le nouvel endroit contient déjà la plante), déplacer mes plants (✎), « Noter ici », « Me localiser » (les boutons ronds de la carte — couches, me localiser, ✎ — sont petits et translucides, la carte d'abord ; ils s'affirment au survol). **Les petites fiches des plantes** (au survol d'un point, au toucher sur téléphone) **passent par-dessus tout** : boutons et panneaux de la carte, bandeaux de la page autour ; elles se posent au-dessus du point (en dessous s'il n'y a pas la place) et disparaissent dès que la carte bouge. Toucher un de mes lieux l'ouvre ; toucher une observation ouvre sa page ;
  - **Modeler la mise en page : un arbre de volets.** Le panneau Plante est, pour chaque mode, un arbre de volets comme dans un éditeur : la **fiche** (qui défile) et, à côté, au-dessus ou en dessous, des **volets** qui tiennent des blocs en **onglets**, découpés en lignes et en colonnes. En mode King, on **glisse** un bloc — par son titre, par son onglet, ou depuis la palette **« Ajouter »** (les blocs masqués, et « Nouvelle carte ») :
    - **près d'un bord** d'un volet ou de la fiche : un **nouveau volet** de ce côté (la moitié qu'il prendra s'ombre) ;
    - **au milieu d'un volet** : un de ses **onglets** ; sur sa barre d'onglets : entre deux onglets ;
    - **dans la fiche** : il y revient, à la place marquée d'un trait entre deux blocs (c'est aussi le geste pour réordonner la fiche) ;
    - **sur le bord extérieur** du panneau : une bande ou une colonne sur toute sa largeur ou sa hauteur.
    Échap annule ; un volet vidé disparaît. Exemple : à côté de la fiche, la répartition, puis le calendrier dessous, puis une carte en onglet. Au clavier ou au doigt, **« Déplacer vers… »** sur un bloc fait de même (dans la fiche, nouveau volet à droite / gauche / en haut / en bas, onglet d'un volet). Les **poignées** entre volets se tirent (aussi hors mode King ; ← → ou ↑ ↓ au clavier, double-clic : parts égales ; le volet des Médias garde au moins 400 px de haut et 280 px de large — sa photo, sa barre de zoom et ses vignettes ne se chevauchent jamais, et sa bande sur une fiche étroite aussi ; en volet, le choix du type de média — photos, herbiers… —, les parties de la plante et le compteur « 1 / 4 » sont **dans l'en-tête du volet**, une ligne de gagnée pour l'image) ; la disposition est gardée **par mode**, partout où la fiche s'affiche (Flore, Mes plantes, Découvrir) et d'une plante à l'autre. Sur une fiche étroite (téléphone), les volets deviennent des bandes au-dessus et au-dessous de la fiche, dans l'ordre de l'arbre (l'arbre lui-même ne change pas). Le panneau Plante de Flore et de Mes plantes s'élargit quand des volets sont à côté de la fiche. Les mises en page des versions précédentes (blocs collés aux bords, « à côté ») sont converties en arbre. **Page web** : un bloc à placer dans un volet (puce de la palette du mode King, ou « Déplacer vers… »). Une fois dans la mise en page, **les liens de l'application vers d'autres sites s'y ouvrent** au lieu d'un nouvel onglet — un lien Wikipédia (ouvert dans sa version mobile, faite pour une colonne), une fiche INPN, une page GBIF, une ressource… — et l'onglet « Page web » passe devant s'il était derrière un autre. Le volet a sa barre : ← → parmi les pages ouvertes, l'adresse, « ouvrir dans un nouvel onglet », fermer la page ; la page reste d'une plante à l'autre. Certains sites refusent d'être affichés dans un autre (la page reste vide) : une ligne propose de l'ouvrir dans un onglet. Ctrl, ⌘ ou Maj + clic, ou le clic du milieu, gardent le comportement du navigateur ; sans volet Page web, rien ne change.
  - **options d'un volet** (sa barre) : ⚙ **Sans titre ni cadre** (le bloc remplit le volet, ses onglets et « agrandir » flottent dessus), **Replié** (la barre seule, le volet s'ouvre au toucher) ; **Agrandir** (⤢ : le volet couvre tout le panneau, Échap ou ⤡ le remet) ; replier / déplier.
  - **tableau ou liste** : les données en lignes (Occurrences : régions et départements, types de relevés, sources ; Habitat et écologie ; Publications ; Identifiants) se lisent en **tableau** par défaut (valeur, nombre, part avec une petite barre), ou en **liste** compacte, au choix pour chaque mode.
  - **Réglages › Mode King** : pour chaque mode, le **panneau Plante en miniature** (la fiche et ses blocs, les volets et leurs onglets) où l'on glisse les blocs comme sur la fiche — la fiche suit en direct —, puis les mêmes listes (glisser : toute la ligne à la souris, la poignée au doigt ; « Position » : dans la fiche ou un nouveau volet d'un côté), avec leurs sous-blocs, « Par défaut », « Nouveau bloc Note », **Exporter / Importer la mise en page** (un fichier JSON, version 2 : ordre, blocs et sous-blocs masqués, titres, arbre de volets, blocs Note et leurs textes ; un fichier de version 1 est converti) et « Tout réinitialiser » — ces trois boutons sont toujours visibles dans *Réglages › Mode King*, même sans entrer dans le mode.
- **Médias : la visionneuse** : le bloc **Médias** de la fiche (par défaut en Standard et Scientifique, à la place de Photos et Médias GBIF, qui restent disponibles en mode King ; en Épuré, la grande photo l'ouvre) réunit les images de la plante, de toutes les sources : photo du jeu de données, Wikimedia Commons, photos choisies du taxon sur iNaturalist, photos d'observation et planches d'herbier GBIF (licences libres seulement, auteur et licence sur chaque image).
  - **Dans la fiche** (compact) : l'image dans un cadre de forme fixe (4:3, 3:2 quand la fiche est large : rien ne saute d'une plante à l'autre ; pendant le chargement, la visionneuse a déjà sa taille), son crédit en une ligne, la pellicule des autres ; le type de média (Photos, Observations, Herbier) se choisit dans un menu quand il y en a plusieurs ; ⤢ l'ouvre **en volet**, sur l'image montrée. Dans le flux de la fiche, la molette fait défiler la fiche (Ctrl + molette zoome) ; collée à un bord de la fiche ou en volet, la molette zoome sur l'image.
  - **En volet** : l'image en grand. L'adresse `#/plant/<id>?pane=media&i=<n>` ouvre directement la n-ième image (les liens `?media=<n>` aussi).
  - **Plein cadre** : une image plus haute que le cadre le remplit en largeur, et la **carte de l'image entière** se pose sur son bord droit, de toute la hauteur (fond sombre presque opaque, la zone vue cernée d'un trait fin) — quand elle tient (au plus 45 % de la largeur, 35 % sur téléphone ; sinon l'image entière). **Chaque image s'ouvre à la largeur du cadre** (plein cadre, sauf si sa définition est trop faible : plus de deux fois agrandie, elle s'ouvre entière) — jamais trop zoomée. Le bouton du milieu passe de « Ajusté » à « Plein cadre » puis « 100 % », sur l'image montrée. Le **cadenas** de la barre de zoom garde le zoom affiché (son pourcentage) pour les images et les plantes suivantes ; déverrouillé (par défaut), chaque image repart à la largeur du cadre.
  - **Le plus détaillé d'abord** : dans chaque type, les images les plus grandes (en pixels, quand la source le dit) passent devant, puis les plus récentes.
  - **Parties de la plante (Trefle)** : avec un jeton Trefle (*Réglages › Modules*), les photos Pl@ntNet par partie s'ajoutent — seulement celles dont le crédit porte une licence libre (« (cc-by-sa) »…), la plupart (Photoflora) n'en ayant pas. Un menu d'icônes — Toutes, Fleur, Feuille, Fruit, Écorce, Port — filtre la scène, la pellicule, la mosaïque et le diaporama.
  - **Hauteur réglable** : dans la fiche, une poignée sous l'image en règle la hauteur (glisser, ↑ ↓, double-clic : taille par défaut) ; gardée comme une proportion de la largeur (elle suit l'écran), pour toutes les plantes et d'une visite à l'autre.
  - **Détails ⓘ** : sur écran étroit sous l'image, sur écran large à côté — jamais par-dessus, entiers quel que soit le zoom.
  - **Rien ne saute au chargement** : l'image montrée est choisie une fois, quand toutes les sources ont répondu ou 0,9 s après les premières (avant, le squelette de la visionneuse, à sa taille) ; la pellicule garde sa place ; quand la vraie forme de l'image arrive, l'image glisse en place ; la carte de l'image apparaît en fondu ; le bouton de vue a une largeur fixe.
  - **Fond flouté** : là où l'image ne couvre pas le cadre, la même image, agrandie et floutée, le remplit.
  - **La carte de l'image** : saisir le cadre de la zone vue le déplace depuis l'endroit saisi (sans sauter) ; toucher ailleurs sur la carte y fait glisser la vue en douceur.
  - **Un seul zoom, comme dans une appli Photos** : double-clic ou double-tap pour zoomer à l'endroit pointé (encore une fois : l'image entière), la molette pour un zoom progressif quand la visionneuse est collée à un bord ou en volet (Ctrl + molette dans le flux de la fiche), ou pincer, les boutons − / vue / + en bas à droite (« 100 % » : un pixel de l'original par pixel d'écran), et glisser pour se déplacer. Dès que l'image dépasse le cadre, la **carte** de l'image entière montre la zone vue ; la toucher ou y glisser déplace la vue. La carte couvrant le haut droit du cadre, l'image zoomée peut être poussée au-delà de ce côté — vers la gauche jusqu'à dégager son bord droit, vers le bas (carte moins haute que le cadre) jusqu'à passer sous la carte — : aucune partie n'en reste cachée ; ailleurs, pas de bande vide. Le cadre de la zone vue reste toujours entier dans la carte. Les flèches ‹ › sont **en bas du cadre, une dans chaque coin**, à la même place d'une image à l'autre, zoomé ou non (par-dessus la carte quand elle descend jusque-là) ; la barre de zoom se tient à côté de la flèche suivante. Clavier (quand la visionneuse a le focus) : ← → (image précédente / suivante, ou se déplacer quand on est zoomé), + − 0, Échap (l'image entière, puis fermer).
  - **La bonne image au bon moment, toute seule** : la vignette s'affiche aussitôt (floutée), l'image d'affichage (iNaturalist « large », Commons 1 280 px) apparaît en fondu, **sans effet de zoom** (l'image prend sa place d'un coup), et dès que le zoom dépasse ce qu'elle contient, **l'original** se charge (un point discret dans la ligne de crédit, qui pulse pendant le chargement). Rien n'est posé sur l'image hormis les boutons et la carte ; le crédit tient en une ligne discrète dessous. Une image qui ne se charge à aucune taille **disparaît** de la scène, du bandeau, de la mosaïque et des comptes, et la suivante s'affiche ; ailleurs dans l'application, une image en échec se cache sans icône cassée, et toutes les images hors écran se chargent à la demande. Les images voisines sont préchargées.
  - **Calme** : le crédit (type, source, auteur, licence) tient en une ligne sous l'image ; ⓘ ouvre le détail (taille de l'original, collection, année, lieu, « Voir à la source », « Ouvrir l'original »). Sur ordinateur, les commandes s'effacent quand la souris reste immobile. Au doigt : balayer change d'image quand on n'est pas zoomé ; zoomé, glisser déplace la vue.
  - Les tailles se déduisent des adresses des images (iNaturalist `…/photos/<id>/square|small|medium|large|original`, Commons `…/thumb/…/<N>px-<fichier>` et le fichier), dans `app/core/media-items.js` ; une taille qui n'existe pas (Commons n'agrandit pas) bascule sur l'image donnée par la source. Les originaux, lourds, ne sont pas gardés par le service worker.
  - **Présentations** (style du bloc, en mode King) : **Scène** (la photo, ses détails et la pellicule), **Mosaïque** (toutes les images en grille ; une image touchée s'ouvre dans la scène, « ← Mosaïque » y revient) ou **Diaporama** (une image à la fois, ▶ pour défiler toutes les 5 s). Le zoom marche partout.
- **Les blocs en volet** : tout bloc de la fiche (sauf Nom et la barre d'actions) peut s'ouvrir **en grand dans un volet à côté de la fiche** : ⤢ sur son titre (au survol sur ordinateur). Le volet prend la place des résultats (les filtres se replient ; les déplier ferme le volet), avec le nom du bloc et de la plante, « plein écran » (toute la largeur) et ✕ ; dans la fiche, le bloc laisse une ligne « affiché dans le volet ». Une carte y remplit toute la hauteur, les tableaux s'y lisent en entier, la visionneuse y a sa loupe à côté. L'adresse `#/plant/<id>?pane=<bloc>` est partageable ; Retour ferme le volet ; plante précédente / suivante garde le volet ouvert, sur la nouvelle plante. Téléphone : le volet couvre la fiche (« ← Fiche ») ; hors de Flore (Mes plantes, Carte) : par-dessus la page.
- **Plante précédente / suivante** : une barre en bas du volet de la fiche (juste au-dessus du menu sur téléphone) parcourt les résultats dans leur ordre — ou, dans *Mes plantes*, les plantes de la collection ou de l'endroit ouvert. Sur téléphone, simple : « ‹ Préc. · 3 / 17 · Résultats « ortie » · Suiv. › ». Sur ordinateur, complète : première, précédente, les positions autour (1 … 4 5 **6** 7 8 … 17), un champ pour aller directement à un numéro, d'où vient la liste, suivante, dernière ; un trait en haut de la barre montre où l'on en est. Les touches ← → font de même ; sur téléphone, la fiche se balaie comme une carte (à la Tinder, en CSS) : elle suit le doigt en s'inclinant, et la fiche de la plante vers laquelle on va attend déjà dessous, grandissant à mesure ; lâchée assez loin (ou d'un geste vif), elle poursuit sa course hors de l'écran et la fiche de dessous, déjà chargée, devient la fiche ouverte, sinon elle revient en place ; pas sur une carte ni une galerie. Sur ordinateur et tablette, pas de balayage : ‹ › et les touches ← → font disparaître la fiche en fondu, puis apparaître la suivante (déjà chargée). La ligne de la plante reste visible dans la liste, « Résultats » ramène à la liste et le retour à la plante précédente.

### Modules : les services en ligne, un par un

L'app fonctionne hors ligne avec la flore locale ; chaque service en ligne est un **module** qu'on active **mode par mode** dans **Réglages › Modules** : trois cases, Épuré · Standard · Scientifique (toutes cochées par défaut ; Trefle demande un jeton). La fiche plante suit son affichage, la grille des résultats le sien, la carte et le reste le mode de l'application. Dans un mode où il est décoché, un module n'est jamais appelé et ses données ne s'affichent pas, copies en cache comprises :

**Catégories.** Les services, comme les blocs de la fiche, sont rangés par ce que la donnée dit de la plante, quel qu'en soit le fournisseur (GBIF, par exemple, sert à plusieurs) :

| Catégorie | Question | Services |
|---|---|---|
| L'essentiel | Qui est-elle, en quelques mots ? | Wikidata (TAXREF en local ; aussi GBIF) |
| Images | À quoi ressemble-t-elle ? | Wikimedia Commons, Photos en ligne (aussi GBIF, iNaturalist) |
| Alertes | Puis-je la cueillir sans danger ? | statuts INPN et plantes à confondre en local (aussi GBIF, Wikidata, IGN espaces protégés) |
| Usages | À quoi sert-elle, se mange-t-elle ? | Wikibooks (recettes) |
| Saisons | Quand la voir ? | Baseflor en local (aussi iNaturalist, Open-Meteo pollens) |
| Encyclopédie | Que sait-on d'elle ? | Wikipédia, Trefle (aussi GBIF, Wikidata) |
| Écologie et climat | Avec qui et dans quel milieu vit-elle ? | GloBI, Open-Meteo (aussi GBIF, IGN zones naturelles) |
| Répartition | Où pousse-t-elle ? | iNaturalist, GBIF |
| Carte et territoire | Où suis-je, qu'y a-t-il ici ? | IGN : fonds de carte, adresses et altitudes, espaces protégés, zones naturelles au point |
| Outils et notes | Vos actions et vos notes | Dictée vocale ; blocs Note, barre d'actions |

*Réglages › Modules* présente les services sous ces catégories (« Sert aussi : … » pour les autres). En mode King, chaque bloc porte sa catégorie (dans la fiche et dans *Réglages › Mode King*) et **« Ranger par catégorie »** regroupe les blocs d'un mode dans cet ordre, chacun gardant sa place parmi les siens.

| Module | Service | Apporte |
|---|---|---|
| IGN – fonds de carte | data.geopf.fr (WMTS) | photos aériennes, plan, cadastre, courbes de niveau, forêts, espaces protégés ; désactivé, seules les zones déjà vues restent affichées (tuiles du cache, sans réseau) |
| IGN – adresses et altitudes | data.geopf.fr (géocodage, altimétrie, toponymes BD TOPO) | recherche d'adresse, adresse et altitude d'un point ou d'un lieu, nom du lieu où commence un parcours botanique |
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
- **Filtres à longue liste** (Famille, Genre) : leur champ « Filtrer… » reste sous le titre du filtre pendant que sa liste défile ; il ne s'en va qu'avec la fin du filtre, ou quand on le replie.
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
- **Usages et cuisine sauvage** (bloc de la fiche, rubrique Usages) — la prudence d'abord, chaque ligne avec sa source et la partie de la plante concernée ; l'app ne dit jamais qu'une plante est « comestible » :
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
- une liste ou un lieu : le lien contient la collection elle-même (`#/shared?d=…`, JSON compressé deflate + base64url, ~200 caractères pour 30 plantes). Notes et journaux de récolte ne sont **jamais** inclus ; pour un lieu, la position exacte l'est (confirmation demandée), ainsi que celle de chaque plante — **chaque occurrence** d'une plante notée plusieurs fois, jusqu'à ~100 km du point du lieu. Le destinataire voit un aperçu — **la carte cadrée sur tout le lieu ou le parcours**, chaque plante à sa place, la liste avec « × 2 » pour une plante notée deux fois — et peut l'enregistrer comme nouvelle collection, avec toutes ses occurrences.

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

L'onglet **Carte** enregistre les endroits où vous récoltez, sur les **photos aériennes IGN** (Géoplateforme, sans clé ; aussi Plan IGN et parcelles cadastrales). Un **lieu** (endroit) est une **collection de plantes qui a des coordonnées GPS** : une lisière peut réunir l'ail des ours, l'ortie et la benoîte. **Chaque plante du lieu a aussi sa propre position GPS.** **Une même plante peut y être notée plusieurs fois** (des orties tout le long d'un chemin) : chaque **occurrence** a sa position, son abondance, ses notes et son journal de récolte, numérotée dans la fiche du lieu (« n° 2 ») ; « Ajouter une plante » propose toutes les plantes, même déjà présentes, et « Retirer cette occurrence » n'enlève que celle-là. « Noter ici » d'une plante déjà notée dans le lieu, à moins de 15 m d'une de ses occurrences, enrichit celle-ci (récolte du jour) ; plus loin, c'est une nouvelle occurrence. **La carte d'un lieu est toujours cadrée sur lui et toutes ses plantes**, et se recadre quand une plante est ajoutée, retirée ou déplacée. Les anciennes données reçoivent un identifiant d'occurrence stable (aucune migration de base) ; l'export, le transfert et les liens de partage gardent chaque occurrence.

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
