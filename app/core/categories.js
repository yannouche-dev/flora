// @ts-check
// What the data says about a plant, as the questions one asks in front of it. Services (Réglages › Modules)
// and the plant sheet's blocks (Mode King) are grouped by these categories, whoever provides the data:
// GBIF, for one, feeds names, images, distribution and ecology.

/**
 * @typedef {'names' | 'images' | 'knowledge' | 'safety' | 'distribution' | 'seasons' | 'ecology' | 'territory' | 'tools'} CategoryKey
 * @typedef {{ key: CategoryKey, label: string, question: string, icon: import('./icons.js').IconName }} Category
 */

/** @type {Category[]} */
export const CATEGORIES = [
  { key: 'names', label: 'Noms', question: 'Comment s’appelle-t-elle ?', icon: 'type-h2' },
  { key: 'images', label: 'Images', question: 'À quoi ressemble-t-elle ?', icon: 'image' },
  { key: 'safety', label: 'Protection et risques', question: 'Puis-je la cueillir sans danger ?', icon: 'shield-check' },
  { key: 'seasons', label: 'Saisons', question: 'Quand la voir ?', icon: 'flower1' },
  { key: 'distribution', label: 'Répartition', question: 'Où pousse-t-elle ?', icon: 'map' },
  { key: 'ecology', label: 'Écologie et climat', question: 'Avec qui et dans quel milieu vit-elle ?', icon: 'diagram-3' },
  { key: 'knowledge', label: 'Savoirs', question: 'Que sait-on d’elle ?', icon: 'list-ul' },
  { key: 'territory', label: 'Carte et territoire', question: 'Où suis-je, qu’y a-t-il ici ?', icon: 'geo-alt-fill' },
  { key: 'tools', label: 'Outils et notes', question: 'Vos actions et vos notes', icon: 'gear' }
];

/** @param {string} key @returns {Category} */
export const categoryOf = key => CATEGORIES.find(c => c.key === key) || CATEGORIES[CATEGORIES.length - 1];

/**
 * Category of each block of the plant sheet (note and added map blocks: by their kind).
 * @type {Record<string, CategoryKey>}
 */
const BLOCK_CATEGORIES = {
  name: 'names', names: 'names', taxonomy: 'names', ids: 'names',
  photos: 'images', gbifMedia: 'images',
  wikipedia: 'knowledge', descriptions: 'knowledge', literature: 'knowledge', trefle: 'knowledge', resources: 'knowledge',
  status: 'safety', lookalikes: 'safety',
  occurrences: 'distribution', map: 'distribution', mine: 'distribution',
  calendar: 'seasons',
  interactions: 'ecology', climate: 'ecology', gbifProfile: 'ecology',
  actions: 'tools'
};

/** @param {string} key @returns {CategoryKey} */
export const blockCategory = key => key.startsWith('map:') ? 'distribution' : key.startsWith('note:') ? 'tools' : BLOCK_CATEGORIES[key] || 'tools';
