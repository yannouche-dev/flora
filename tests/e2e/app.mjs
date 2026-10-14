// A thin driver of the app for the specs: open a screen, wait for the flora, call a module of the page. The app's
// components render in open shadow roots, which Playwright's CSS locators pierce: specs mostly use page.locator.
import { expect } from '@playwright/test';

export class App {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  /** A phone (the 390 px project): one column, the tab bar at the bottom. */
  get phone() {
    return (this.page.viewportSize()?.width ?? 1280) < 700;
  }

  /** Opens the app on a route (#/…) and waits for the flora to be ready. @param {string} [hash] */
  async open(hash = '#/') {
    await this.page.goto(hash);
    await this.ready();
  }

  /** Goes to a route of the running app (no reload). @param {string} hash */
  async go(hash) {
    await this.page.evaluate(h => { location.hash = h; }, hash);
  }

  /**
   * The flora indexed (store.state.status 'ready') and stored in IndexedDB: a first launch searches before its
   * records are stored (floraStoring), and the specs reload, go offline or read the store right after.
   */
  async ready() {
    await this.page.waitForFunction(() => customElements.get('gf-app') && document.querySelector('gf-app')?.shadowRoot?.childElementCount);
    await expect.poll(() => this.state('status'), { timeout: 30_000 }).toBe('ready');
    await expect.poll(() => this.state('floraStoring'), { timeout: 30_000 }).toBeFalsy();
    // The screen of the address drawn: those other than Flore and Découvrir load their module the first time (gf-app).
    await expect(this.page.locator('gf-app .loading-screen')).toHaveCount(0);
  }

  /**
   * A value of the store's state, read in the page, by its path ('status', 'query.q'). The page's CSP forbids
   * eval: functions cannot be sent as text, so specs call page.evaluate themselves for anything else.
   * @param {string} path
   */
  state(path) {
    return this.page.evaluate(async p => {
      const { store } = await import('/app/core/store.js');
      return p.split('.').reduce((/** @type {any} */ v, k) => v?.[k], store.state);
    }, path);
  }

  /** The labels of the main tabs (tab bar on a phone, header on a desktop). */
  async tabs() {
    const links = this.phone ? this.page.locator('gf-tabbar nav a') : this.page.locator('gf-app nav.tabs a');
    return (await links.allTextContents()).map(t => t.trim()).filter(Boolean);
  }
}
