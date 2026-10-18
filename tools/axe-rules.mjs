// @ts-check
// What the accessibility checks ask of a screen, in one place: axe-core's source (the version of package-lock.json) and
// the rules it runs — WCAG 2.0, 2.1, 2.2 levels A and AA, and its best practices (one h1 per view, landmarks…). Read by
// the ratchet over the main screens (tools/axe.mjs) and by the specs that check a view of their own
// (tests/e2e/faux-amis.spec.mjs).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** axe-core's version and source, to evaluate in a page. */
export const AXE_VERSION = require('axe-core/package.json').version;
export const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
/** The rules run, by tag. */
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
