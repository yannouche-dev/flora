// ESLint (npm run lint; CI « lint » job): the recommended rules, plus what this app has been bitten by or must not
// regress on (audit, chantier « Analyse statique en CI »):
//  - no-unsanitized: no innerHTML / insertAdjacentHTML / document.write with a value that is not a literal (Lit
//    templates escape what they interpolate; a string set as HTML does not);
//  - lit: the template rules of eslint-plugin-lit (bindings, attributes, no `this` in a template's own string…);
//  - import-x/named: every name imported from a module of the repository exists there ('lit' and 'leaflet' come
//    from the import map of index.html: tools/check-imports.mjs checks those against vendor/);
//  - no-restricted-syntax (RESTRICTED below): what goes through one module only.
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
    message: 'Components keep their settings through a core module (store.js and the other app/core services), not localStorage.'
  }
};
const restricted = (/** @type {(keyof typeof RESTRICTED)[]} */ ...keys) => ['error', ...keys.map(k => RESTRICTED[k])];

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
      'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'hash', 'replace')
    }
  },
  // Every import of the app finds its file. Not in tests/ (their page.evaluate imports resolve in the page, from the
  // site's root) nor in scripts/ (SheetJS is installed by scripts/package.json, for the data workflows only).
  { files: ['app/**/*.js', 'lib/**/*.mjs', 'sw.js'], rules: { 'import-x/no-unresolved': 'error' } },
  { files: ['app/components/**/*.js'], rules: { 'no-restricted-syntax': restricted('nativeMember', 'tooltip', 'hash', 'replace', 'storage') } },
  // The navigation helpers themselves.
  { files: ['app/core/history.js'], rules: { 'no-restricted-syntax': restricted('nativeMember', 'tooltip') } },
  { files: ['app/workers/**/*.js'], languageOptions: { globals: globals.worker } },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Playwright: the functions given to page.evaluate run in the page.
  { files: ['tests/**/*.mjs', 'tools/axe.mjs', 'tools/measure-launch.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
];
