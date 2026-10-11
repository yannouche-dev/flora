// @ts-check
// What the data says about a plant, as the questions one asks in front of it. Services (Réglages › Modules)
// and the plant sheet's blocks (Mode King) are grouped by these categories, whoever provides the data:
// GBIF, for one, feeds names, images, distribution and ecology.

/**
 * @typedef {'names' | 'images' | 'safety' | 'uses' | 'seasons' | 'knowledge' | 'ecology' | 'distribution' | 'territory' | 'tools'} CategoryKey
 * @typedef {{ key: CategoryKey, label: string, question: string, icon: import('./icons.js').IconName }} Category
 */

/**
 * In the order of the questions one asks in front of a plant: what is it, what does it look like, is it a danger,
 * what is it good for, when to see it; then what is known of it (the encyclopedia), its life, where it grows.
 * @type {Category[]}
 */
export const CATEGORIES = [
  { key: 'names', label: 'L’essentiel', question: 'Qui est-elle, en quelques mots ?', icon: 'card-text' },
  { key: 'images', label: 'Images', question: 'À quoi ressemble-t-elle ?', icon: 'images' },
  { key: 'safety', label: 'Alertes', question: 'Puis-je la cueillir sans danger ?', icon: 'shield-check' },
  { key: 'uses', label: 'Usages', question: 'À quoi sert-elle, se mange-t-elle ?', icon: 'basket' },
  { key: 'seasons', label: 'Saisons', question: 'Quand la voir ?', icon: 'flower1' },
  { key: 'knowledge', label: 'Encyclopédie', question: 'Que sait-on d’elle ?', icon: 'wikipedia' },
  { key: 'ecology', label: 'Écologie et climat', question: 'Avec qui et dans quel milieu vit-elle ?', icon: 'diagram-3' },
  { key: 'distribution', label: 'Répartition', question: 'Où pousse-t-elle ?', icon: 'map' },
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
  media: 'images', photos: 'images', gbifMedia: 'images',
  uses: 'uses',
  wikipedia: 'knowledge', descriptions: 'knowledge', literature: 'knowledge', trefle: 'knowledge', resources: 'knowledge',
  status: 'safety', lookalikes: 'safety',
  occurrences: 'distribution', map: 'distribution', mine: 'distribution',
  calendar: 'seasons',
  interactions: 'ecology', climate: 'ecology', gbifProfile: 'ecology',
  actions: 'tools'
};

/** @param {string} key @returns {CategoryKey} */
export const blockCategory = key => key.startsWith('map:') ? 'distribution' : key.startsWith('note:') ? 'tools' : BLOCK_CATEGORIES[key] || 'tools';
