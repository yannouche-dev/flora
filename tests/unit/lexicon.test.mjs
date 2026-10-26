// @ts-check
// One name per concept (docs/LEXIQUE.md: « L'interface dit toujours le mot de gauche ; le code garde le sien »): no
// text of app/ says a word the lexicon replaced. Every string and template of app/**/*.js is read (acorn: a comment is
// not a string), css`` templates left out; identifiers, paths and storage keys say none of these words. « King » stays
// a code name only (store.js `king`, `openKing`…): the interface says « Personnaliser la fiche ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A word or phrase alone, accented letters counted as letters (\b only knows ASCII: « déjouer » is not « jouer »). @param {string} words */
const word = words => new RegExp(`(?<![\\p{L}\\p{N}-])(?:${words})(?![\\p{L}\\p{N}])`, 'iu');

/** The words replaced, and what the interface says instead. @type {[RegExp, string][]} */
const REPLACED = [
  [word('jouer'), '« Commencer »'],
  [word('rejou(?:er|e|ez)'), '« Recommencer »'],
  [word('reprendre'), '« Continuer »'],
  [word('scénarios?'), '« Découvrir » (la liste), « activité » (l’une d’elles)'],
  [word('mini-app(?:lication)?s?'), '« activité »'],
  [word('lanceur'), '« Découvrir »'],
  [word('découverte guidée|recommencer la découverte'), '« premiers pas », « Revoir les premiers pas »'],
  [word('endroits?'), '« lieu » (« la place », hors de ce sens)'],
  [word('(?:votre|vos|mon|mes|notre|nos) herbiers?'), '« favoris » (« planche d’herbier » reste)'],
  [word('mes collections|collection courante'), '« Mes plantes », « liste ou lieu en cours »'],
  [word('sosies? dangereux'), '« sosie toxique »'],
  [word('quitter le plein écran'), '« Sortir du plein écran »'],
  [word('mode (?:de )?modification|mode d[’\']édition'), '« la modification » (« Terminé » la termine)'],
  [word('mode king'), '« Personnaliser la fiche » (« King » : un nom de code)']
];
/** The console's prefix, never shown: `mini-app ${id}: …` (define.js, gf-miniapp.js, runtime.js). */
const DEVELOPER = new Set(['mini-app ']);

/** @param {string} dir @returns {string[]} */
const sources = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);

/** The strings of a module, with their line — but those of css`` templates. @param {string} file */
function strings(file) {
  /** @type {{ line: number, text: string }[]} */
  const out = [];
  /** @param {any} node */
  const visit = node => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'TaggedTemplateExpression' && node.tag.type === 'Identifier' && node.tag.name === 'css') return;
    if (node.type === 'Literal' && typeof node.value === 'string') out.push({ line: node.loc.start.line, text: node.value });
    if (node.type === 'TemplateElement') out.push({ line: node.loc.start.line, text: node.value.cooked ?? node.value.raw });
    for (const [key, value] of Object.entries(node)) if (key !== 'loc') for (const child of [value].flat()) if (child && typeof child === 'object') visit(child);
  };
  visit(parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true }));
  return out;
}

test('l’interface ne dit aucun des mots que le lexique a remplacés', () => {
  const files = sources(join(ROOT, 'app'));
  /** @type {string[]} */
  const found = [];
  let read = 0;
  for (const file of files) for (const { line, text } of strings(file)) {
    read++;
    if (DEVELOPER.has(text)) continue;
    for (const [said, say] of REPLACED) if (said.test(text)) found.push(`${relative(ROOT, file)}:${line} « ${text.replace(/\s+/g, ' ').trim().slice(0, 80)} » → ${say}`);
  }
  assert.ok(files.length > 150 && read > 10000, `app/ lu en entier (${files.length} fichiers, ${read} textes)`);
  assert.deepEqual(found, []);
});

test('le lexique reconnaît les mots qu’il remplace, pas leurs voisins', () => {
  const caught = (/** @type {string} */ text) => REPLACED.filter(([said]) => said.test(text)).map(([, say]) => say);
  for (const text of ['Jouer : Rencontres', 'Rejouer', 'Reprendre la partie', 'Scénarios', 'Pour cette mini-application seulement',
    'Recommencer la découverte', 'Créer un endroit ici', 'Direction votre herbier', 'Dans mes collections', 'J’ai des sosies dangereux (2)',
    'Quitter le plein écran', 'En mode modification', 'Quitter le mode King', 'Entrer en mode King', 'Titre caché hors mode King']) assert.equal(caught(text).length, 1, text);
  for (const text of ['Commencer : Rencontres', 'déjouer le piège', 'il reprend sa place', 'Planche d’herbier', 'Spécimens d’herbier',
    'Créer un lieu ici', 'J’ai des sosies toxiques (2)', 'Sortir du plein écran', 'Personnaliser la fiche', 'Mise en page de la fiche',
    'geoflora.app.rencontres.state', 'gf-scenarios', 'open-scenarios', 'openKing']) assert.deepEqual(caught(text), [], text);
});
