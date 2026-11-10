// ESLint (npm run lint; CI « lint » job): the recommended rules, plus what this app has been bitten by or must not
// regress on (audit, chantier « Analyse statique en CI »):
//  - no-unsanitized: no innerHTML / insertAdjacentHTML / document.write with a value that is not a literal (Lit
//    templates escape what they interpolate; a string set as HTML does not);
//  - lit: the template rules of eslint-plugin-lit (bindings, attributes, no `this` in a template's own string…);
//  - import-x/named: every name imported from a module of the repository exists there ('lit' and 'leaflet' come
//    from the import map of index.html: tools/check-imports.mjs checks those against vendor/);
//  - no-restricted-syntax (RESTRICTED below): what goes through one module only; a name exported once, where it is
//    declared (no relay, no alias);
//  - import-x/no-restricted-paths: core/ is the bottom layer, importing nothing of the screens above it;
//  - no-restricted-globals, no-restricted-properties (NATIVE_DIALOGS below): never the browser's own dialogs in app/.
// The app has no build step and nothing here is deployed: the tools are dev dependencies (package.json).

import js from '@eslint/js';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import lit from 'eslint-plugin-lit';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

/**
 * Members of HTMLElement (and Element, Node) that a reactive property must not be named after: Lit puts an accessor
 * on the prototype that hides the native one, and `el.focus()` then throws « el.focus is not a function » (audit
 * QUA-4 / ARC-10: a `focus` property on four components, now `mapFocus` and `focusEntry`).
 */
const NATIVE_MEMBERS = ['focus', 'blur', 'click', 'title', 'hidden', 'dir', 'lang', 'id', 'slot', 'part', 'role',
  'style', 'dataset', 'inert', 'popover', 'nonce', 'translate', 'draggable', 'tabIndex', 'autofocus', 'remove',
  'scroll', 'animate', 'matches', 'closest', 'append', 'prepend', 'before', 'after', 'children', 'attributes'];

/** One rule each, so the message says what to use instead. */
const RESTRICTED = {
  nativeMember: {
    selector: `PropertyDefinition[static=true][key.name='properties'] > ObjectExpression > Property[key.name=/^(${NATIVE_MEMBERS.join('|')})$/]`,
    message: 'A reactive property named after an HTMLElement member hides it (el.focus() would throw): rename it.'
  },
  tooltip: {
    // Leaflet sets a string given to a tooltip or a popup as HTML: give it an element built with textContent
    // (elem() in gf-map.js), never a string made from data (audit SEC-2: a GBIF field reached a map label).
    selector: "CallExpression[callee.property.name=/^(bindTooltip|setTooltipContent|bindPopup|setPopupContent)$/][arguments.0.type!='Literal']:not([arguments.0.callee.name='elem'])",
    message: 'Leaflet renders a string tooltip or popup as HTML: pass an element built with textContent (elem()).'
  },
  hash: {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='hash']:matches([left.object.name='location'], [left.object.property.name='location'])",
    message: 'Navigate with openView() (core/history.js), not location.hash =.'
  },
  replace: {
    selector: "CallExpression[callee.property.name=/^(replace|assign)$/]:matches([callee.object.name='location'], [callee.object.property.name='location'])",
    message: 'Navigate with replaceView() or openView() (core/history.js), not location.replace() / location.assign().'
  },
  storage: {
    selector: "Identifier[name='localStorage']",
    message: 'Read and write localStorage through core/prefs.js (readJSON, writeJSON, definePref…), its keys in config.storageKeys.'
  },
  geolocation: {
    selector: "MemberExpression[property.name='geolocation']",
    message: 'Ask for the position through core/geo.js (oneFix, takeFix, watchLocation, GeoController): one shared watch, its failures in the app’s words.'
  },
  // One name per thing: `export { x } from …`, `export { x }`, `export *`, `export default x` and `export const y = x`
  // give a second way to import a name, or a second name to one thing (5.7: 13 relays and 9 aliases gone).
  relay: {
    selector: "ExportNamedDeclaration[declaration=null], ExportAllDeclaration, ExportDefaultDeclaration > Identifier.declaration, ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.type='Identifier'][init.type='Identifier']:not([init.name=/^(undefined|NaN|Infinity)$/])",
    message: 'Export a name where it is declared, under its own name, and import it from the module that owns it: no relay, no alias (one name per thing).'
  }
};
const restricted = (/** @type {(keyof typeof RESTRICTED)[]} */ ...keys) => ['error', ...keys.map(k => RESTRICTED[k])];

/**
 * The browser's own dialogs, never in app/: a question is the app's (app/components/gf-ask.js ask, confirmAsk) — its
 * look and theme, « Annuler » first with the focus, Échap and Back say no —; a phone shows confirm() bare, an installed
 * app or a frame may block it, a test answers it by itself (5.13: the last 8 confirm() gone). The one left is written
 * where it is, with its reason (app/core/share.js: the link to copy by hand).
 */
const NATIVE_DIALOGS = ['alert', 'confirm', 'prompt'];
const NATIVE_DIALOG = 'Ask through app/components/gf-ask.js (ask, confirmAsk), never the browser’s alert(), confirm() or prompt().';

export default [
  {
    ignores: ['vendor/**', 'node_modules/**', 'scripts/node_modules/**', '_site/**', 'data/**', 'assets/**',
      'test-results/**', 'playwright-report/**']
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createNodeResolver()],
      // The import map's (index.html): checked against vendor/ by tools/check-imports.mjs.
      'import-x/core-modules': ['lit', 'leaflet']
    },
    rules: {
      'import-x/named': 'error',
      // `catch { }` and `_unused` are deliberate; an unused argument is often the documented signature (events).
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['app/**/*.js'],
    languageOptions: { globals: globals.browser },
    ...lit.configs['flat/recommended'],
    rules: {
      ...lit.configs['flat/recommended'].rules,
      'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'hash', 'replace', 'storage', 'geolocation', 'relay'),
      'no-restricted-globals': ['error', ...NATIVE_DIALOGS.map(name => ({ name, message: NATIVE_DIALOG }))],
      'no-restricted-properties': ['error', ...['window', 'globalThis', 'self'].flatMap(object => NATIVE_DIALOGS.map(property => ({ object, property, message: NATIVE_DIALOG })))]
    }
  },
  // Every import of the app finds its file. Not in tests/ (their page.evaluate imports resolve in the page, from the
  // site's root) nor in scripts/ (SheetJS is installed by scripts/package.json, for the data workflows only).
  { files: ['app/**/*.js', 'lib/**/*.mjs', 'sw.js'], rules: { 'import-x/no-unresolved': 'error' } },
  // The navigation helpers themselves.
  { files: ['app/core/history.js'], rules: { 'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'storage', 'geolocation', 'relay') } },
  // localStorage itself: the storage layer, and the channel between tabs it listens to.
  { files: ['app/core/prefs.js', 'app/core/sync.js'], rules: { 'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'hash', 'replace', 'geolocation', 'relay') } },
  // The device's position itself: the shared watch.
  { files: ['app/core/geo.js'], rules: { 'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'hash', 'replace', 'storage', 'relay') } },
  // core/ is the bottom layer: it imports nothing from the screens above it (what both need goes down into core/).
  {
    files: ['app/core/**/*.js'],
    rules: {
      'import-x/no-restricted-paths': ['error', { basePath: import.meta.dirname, zones: [{ target: './app/core', from: ['./app/components', './app/layout', './app/miniapp', './app/miniapps'],
        message: 'core/ is the bottom layer: move what it needs down into core/ (or let the caller pass it).' }] }]
    }
  },
  { files: ['app/workers/**/*.js'], languageOptions: { globals: globals.worker } },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Playwright: the functions given to page.evaluate run in the page.
  { files: ['tests/**/*.mjs', 'tools/axe.mjs', 'tools/measure-launch.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
];
