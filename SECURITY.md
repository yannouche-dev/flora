# Sécurité

## Version suivie

Seule la version publiée sur GitHub Pages, construite depuis la branche `main`, est maintenue. Une installation
(PWA) se met à jour d'elle-même au chargement suivant : il n'y a pas d'ancienne version à corriger.

## Signaler une vulnérabilité

Merci de **ne pas** décrire une faille dans une issue publique.

1. Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**
   (« Signaler une vulnérabilité »). Seuls les mainteneurs voient le rapport.
2. Si ce bouton n'apparaît pas, ouvrez une issue qui dit seulement « Signalement de sécurité : merci de me
   contacter », sans détail : un mainteneur vous proposera un canal privé.

Indiquez si possible : la page ou le fichier concerné, les étapes pour reproduire, l'impact (ce qu'un attaquant
obtient) et le navigateur utilisé.

Nous accusons réception dès que possible, puis nous vous tenons informé de la correction. Le projet est maintenu
bénévolement : aucun délai ni récompense n'est garanti. Une fois la correction publiée, le signalement peut être
rendu public, avec votre nom si vous le souhaitez.

## Ce qui entre dans le périmètre

- l'application web (`index.html`, `app/`, `lib/`, `sw.js`, `manifest.webmanifest`) : injection de contenu, contournement
  de la politique de sécurité du contenu (CSP), fuite de données locales (lieux, collections, position) vers un tiers ;
- les workflows GitHub Actions et les scripts du jeu de données (`.github/workflows/`, `scripts/`) : exécution de code,
  fuite de jeton, données publiées sans contrôle ;
- les données de sécurité publiées (`data/safety.json`, `data/lookalikes.json`, statuts de protection de
  `data/plants.json`) quand elles peuvent être altérées par un tiers.

## Erreurs de données (toxicité, confusions, protection)

Une erreur dans les données elles-mêmes (une plante toxique sans alerte, une confusion manquante, un statut de
protection faux) n'est pas une vulnérabilité : signalez-la **sans attendre** dans une issue publique, en citant la
plante et, si possible, la source qui la contredit. Ces données viennent de sources officielles (ANSM, Agroscope,
Anses et Centres antipoison, INPN) ; voir [data/LICENSE](data/LICENSE).

GeoFlora ne remplace ni un botaniste, ni un médecin : en cas d'ingestion d'une plante suspecte, appelez un
[Centre antipoison](https://centres-antipoison.net/), ou le 15 ou le 112 en cas de détresse vitale.
