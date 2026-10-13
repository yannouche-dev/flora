// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { safeUrl } from '../core/safe-url.js';
import { licenseLabel, needsAuthor, unreserved } from '../core/credit.js';

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

    // iNaturalist's attribution starts with its own « (c) ».
    const author = String(m.author || m.attribution || m.credit || '').replace(/^\s*\(c\)\s*/i, '');
    // Links from the image's record: web addresses only (safeUrl).
    const licenseUrl = safeUrl(m.licenseUrl), sourceUrl = safeUrl(m.sourceUrl || m.pageUrl);
    const label = licenseLabel(m.license);
    const license = label
      ? (licenseUrl ? html`<a href=${licenseUrl} target="_blank" rel="noopener">${label}</a>` : label)
      : nothing;
    const source = sourceUrl
      ? html`<a href=${sourceUrl} target="_blank" rel="noopener">${m.source || 'Wikimedia Commons'}</a>`
      : (m.source || nothing);
    // No « © » where nothing is reserved (CC0, public domain). A CC BY image whose author its record does not give:
    // its page names them, and is pointed to.
    const who = author ? html`${unreserved(m.license) ? '' : '© '}${author} · `
      : needsAuthor(m.license) && sourceUrl ? html`<a href=${sourceUrl} target="_blank" rel="noopener">auteur sur sa page</a> · ` : nothing;

    return html`${who}${license}${license !== nothing ? ' · ' : nothing}${source}`;
  }
}

customElements.define('gf-attribution', GfAttribution);
