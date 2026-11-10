// End-to-end tests (@playwright/test): the app served as static files, in Chromium, on a desktop (1280 px) — and, on a
// phone (390 px, touch), the tests about the phone only: those whose title (or describe) says it (PHONE), or the
// file of the touch gestures. A test written for both widths runs once, on the desktop. Every outside request is answered by the tests (fixtures.mjs): no test reaches a real service,
// and the flora is the reduced one of tests/fixtures (300 plants), unless a spec asks for the real one.
//   npm run test:e2e                      starts its own server (python3 -m http.server, 127.0.0.1, port E2E_PORT or 8907)
//   E2E_BASE_URL=http://127.0.0.1:8000/ npm run test:e2e     against a server already running (an assembled _site)
//   E2E_PART=webgl npm run test:e2e       the specs that draw in 3D alone (WEBGL below); E2E_PART=rest, all the others
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 8907);
const BASE = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}/`;
const ROOT = new URL('../../', import.meta.url).pathname;
// Matched against the project's name, the file and the titles: never « phone » (the project's own name).
const PHONE = /téléphone|mobile|tactile|doigt|étroit|au toucher|touch\.spec/i;
/**
 * The specs that draw in 3D: those whose Chromium is launched with software WebGL (SwiftShader: test.use's launch
 * option '--enable-unsafe-swiftshader'), by far the slowest. CI runs them on a runner of their own (E2E_PART=webgl) and
 * the others in two halves (E2E_PART=rest, --shard): read here from the specs themselves, so every spec, a new one too,
 * is in one part and one only.
 */
const WEBGL = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.spec.mjs')
  && readFileSync(new URL(f, import.meta.url), 'utf8').includes("'--enable-unsafe-swiftshader'"));
const PART = process.env.E2E_PART;
if (PART && PART !== 'webgl' && PART !== 'rest') throw new Error(`E2E_PART=${PART}: webgl or rest`);

export default defineConfig({
  testDir: '.',
  testMatch: PART === 'webgl' ? WEBGL : '*.spec.mjs',
  testIgnore: PART === 'rest' ? WEBGL : undefined,
  outputDir: '../../test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE,
    // The service worker would answer from its cache, past the routes of the tests.
    serviceWorkers: 'block',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    geolocation: { latitude: 48.85, longitude: 2.35, accuracy: 8 },
    permissions: ['geolocation'],
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'phone-390', grep: PHONE, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 900 } } }
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory "${ROOT}"`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
    timeout: 30_000
  }
});
