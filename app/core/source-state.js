// @ts-check
// « Source indisponible — Réessayer »: what a block or a pane shows when the online service it reads failed (offline,
// no answer in time, an HTTP error, an answer of another shape — core/net.js). Distinct from « module désactivé »
// (the user switched it off: nothing to retry) and from « aucune donnée » (the service answered, with nothing).

import { css, html } from 'lit';

/** For a component without the shared ui styles (styles/ui.js): « Réessayer » as a text action. */
export const sourceDownStyles = css`
  .source-down button { font: inherit; color: var(--gf-accent); background: none; border: 0; padding: 0 4px;
    min-height: 24px; text-decoration: underline; cursor: pointer; }
`;
import { unavailableReason } from './net.js';

/** The services' names, by module key or by host. */
const NAMES = /** @type {Record<string, string>} */ ({
  gbif: 'GBIF', 'api.gbif.org': 'GBIF',
  inaturalist: 'iNaturalist', 'api.inaturalist.org': 'iNaturalist',
  wikidata: 'Wikidata', 'www.wikidata.org': 'Wikidata', 'query.wikidata.org': 'Wikidata',
  wikipedia: 'Wikipédia', 'fr.wikipedia.org': 'Wikipédia',
  commons: 'Wikimedia Commons', 'commons.wikimedia.org': 'Wikimedia Commons',
  wikibooks: 'Wikibooks', 'fr.wikibooks.org': 'Wikibooks', 'en.wikibooks.org': 'Wikibooks',
  trefle: 'Trefle', 'trefle.io': 'Trefle',
  globi: 'GloBI', 'api.globalbioticinteractions.org': 'GloBI',
  openmeteo: 'Open-Meteo', 'archive-api.open-meteo.com': 'Open-Meteo', 'air-quality-api.open-meteo.com': 'Open-Meteo',
  'data.geopf.fr': 'IGN', 'apicarto.ign.fr': 'API Carto (IGN)'
});

/**
 * A failure as the user reads it: the service's name and why, when known. `error`: an Error of core/net.js, or
 * { source } (a service named by a result that gathers several, lib/plant-sources.mjs `unavailable`).
 * @param {any} error @returns {{ name: string, reason: string }}
 */
export function describeFailure(error) {
  const source = error?.source || '';
  const name = NAMES[source] || source || '';
  const known = error instanceof Error || typeof error?.kind === 'string';
  return { name, reason: known ? unavailableReason(error) : '' };
}

/**
 * « Source indisponible : GBIF (hors ligne) — Réessayer ». `errors`: one or several failures (their services
 * named once each); `retry`: asks again.
 * @param {any | any[]} errors @param {() => void} retry @returns {import('lit').TemplateResult}
 */
export function sourceDown(errors, retry) {
  const list = (Array.isArray(errors) ? errors : [errors]).map(describeFailure);
  const names = [...new Set(list.map(d => d.name).filter(Boolean))];
  const reasons = [...new Set(list.map(d => d.reason).filter(Boolean))];
  return html`<p class="muted source-down" role="status">Source indisponible${names.length ? ' : ' + names.join(', ') : ''}${reasons.length ? ` (${reasons.join(', ')})` : ''} —
    <button class="link" type="button" @click=${retry}>Réessayer</button></p>`;
}
