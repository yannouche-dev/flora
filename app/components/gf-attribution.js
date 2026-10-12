// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { safeUrl } from '../core/safe-url.js';

/** License and author credit for a remote image (required by CC BY / BY-SA). */
export class GfAttribution extends LitElement {
  static properties = {
    media: { attribute: false }
  };

  static styles = css`
    :host {
      display: block;
      font-size: 0.75rem;
      color: var(--gf-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    a { color: inherit; }
  `;

  constructor() {
    super();
    /** @type {any} */
    this.media = null;
  }

  render() {
    const m = this.media;
    if (!m) return nothing;

    const author = m.author || m.attribution || m.credit;
    // Links from the image's record: web addresses only (safeUrl).
    const licenseUrl = safeUrl(m.licenseUrl), sourceUrl = safeUrl(m.sourceUrl || m.pageUrl);
    const license = m.license
      ? (licenseUrl ? html`<a href=${licenseUrl} target="_blank" rel="noopener">${m.license}</a>` : m.license)
      : nothing;
    const source = sourceUrl
      ? html`<a href=${sourceUrl} target="_blank" rel="noopener">${m.source || 'Wikimedia Commons'}</a>`
      : (m.source || nothing);

    return html`${author ? html`© ${author} · ` : nothing}${license}${license !== nothing ? ' · ' : nothing}${source}`;
  }
}

customElements.define('gf-attribution', GfAttribution);
