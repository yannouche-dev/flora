// @ts-check
// Classic dangerous confusions for foragers in France. Keyed by TAXREF id (data/plants.json);
// symmetric: a warning shows on both the edible plant and the toxic one.
// Not exhaustive — a reminder to check, never a guarantee.

/** @typedef {{ id: number, name: string, danger: 'mortel' | 'toxique' | 'irritant' }} Lookalike */

/** [edible id, edible name, toxic id, toxic name, danger, how to tell them apart] */
const PAIRS = /** @type {const} */ ([
  [81541, 'Ail des ours', 92282, 'Muguet de mai', 'mortel', 'L’ail des ours sent l’ail quand on froisse la feuille ; le muguet n’a pas d’odeur.'],
  [81541, 'Ail des ours', 92127, 'Colchique d’automne', 'mortel', 'Feuilles du colchique plus épaisses, sans odeur d’ail, sans pétiole distinct.'],
  [81541, 'Ail des ours', 84112, 'Gouet tacheté', 'toxique', 'Feuilles du gouet en flèche, nervures en réseau ; sans odeur d’ail.'],
  [94503, 'Carotte sauvage', 92237, 'Ciguë maculée', 'mortel', 'Tige de la ciguë lisse, tachée de pourpre, odeur de souris.'],
  [94503, 'Carotte sauvage', 109864, 'Œnanthe safranée', 'mortel', 'Racines de l’œnanthe en fuseaux, suc jaunissant ; milieux humides.'],
  [94503, 'Carotte sauvage', 80358, 'Petite ciguë', 'mortel', 'Petite ciguë sans poils, longues bractéoles pendantes sous les ombellules.'],
  [82952, 'Anthrisque sylvestre', 92237, 'Ciguë maculée', 'mortel', 'Ombellifères blanches : ne jamais récolter sans identification certaine.'],
  [82952, 'Anthrisque sylvestre', 80358, 'Petite ciguë', 'mortel', 'Ombellifères blanches : ne jamais récolter sans identification certaine.'],
  [101300, 'Berce sphondyle', 101286, 'Berce du Caucase', 'irritant', 'Berce du Caucase géante (2–4 m), sève photosensibilisante : brûlures.'],
  [101300, 'Berce sphondyle', 92237, 'Ciguë maculée', 'mortel', 'Tige de la ciguë lisse et tachée de pourpre ; berce velue.'],
  [120717, 'Sureau noir', 120712, 'Sureau yèble', 'toxique', 'Le yèble est herbacé, à ombelles dressées ; le sureau noir est un arbuste aux grappes pendantes.'],
  [84264, 'Asperge à feuilles aiguës', 611652, 'Dioscorée commune (tamier)', 'toxique', 'Le tamier a des feuilles en cœur et des tiges volubiles sans aiguilles.'],
  [119418, 'Patience oseille', 84112, 'Gouet tacheté', 'toxique', 'Jeunes feuilles : celles du gouet sont luisantes, en fer de flèche net.'],
  [99903, 'Gentiane jaune', 128520, 'Vératre blanc', 'mortel', 'Feuilles opposées chez la gentiane, alternes chez le vératre.']
]);

/**
 * @typedef {object} Warning
 * @property {number} id        the other plant's TAXREF id
 * @property {string} name
 * @property {'mortel' | 'toxique' | 'irritant'} danger
 * @property {boolean} otherIsToxic  true when the other plant is the dangerous one
 * @property {string} tip
 */

/** @type {Map<number, Warning[]>} */
const index = new Map();
for (const [edible, edibleName, toxic, toxicName, danger, tip] of PAIRS) {
  const add = (/** @type {number} */ id, /** @type {Warning} */ w) => index.set(id, [...(index.get(id) || []), w]);
  add(edible, { id: toxic, name: toxicName, danger, otherIsToxic: true, tip });
  add(toxic, { id: edible, name: edibleName, danger, otherIsToxic: false, tip });
}

/** @param {number | null | undefined} plantId @returns {Warning[]} */
export const lookalikes = plantId => (plantId ? index.get(plantId) : null) || [];
