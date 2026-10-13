// End-to-end tests (@playwright/test): the app served as static files, in Chromium, on a phone (390 px, touch) and a
// desktop (1280 px). Every outside request is answered by the tests (fixtures.mjs): no test reaches a real service,
// and the flora is the reduced one of tests/fixtures (300 plants), unless a spec asks for the real one.
//   npm run test:e2e                      starts its own server (python3 -m http.server, 127.0.0.1, port E2E_PORT or 8907)
//   E2E_BASE_URL=http://127.0.0.1:8000/ npm run test:e2e     against a server already running (an assembled _site)
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 8907);
const BASE = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}/`;
const ROOT = new URL('../../', import.meta.url).pathname;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
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
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
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
