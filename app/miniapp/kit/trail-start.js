// @ts-check
// The Parcours' first screen (the start screens' template, drawn by the box): one action, « Commencer ici » (the
// app's action `locate`); smaller, a commune, a walk to take up again (the one under way first, when Back brought
// here); the way out, the launcher. Its words, as before.

import { shortName } from './trail-store.js';
import { trailSessionOf } from './trail-session.js';

/**
 * @param {any} c @param {import('../runtime.js').MiniApp} app
 * @returns {import('../../components/start-screen.js').StartSpec}
 */
export function trailStart(c, app) {
  const s = trailSessionOf(app);
  // « 12 plantes · 3 oct. »: two walks of the same name told apart by their last day — and their hour, the same day.
  const day = (/** @type {any} */ p) => new Date(p.properties.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const all = [...(s.trail ? [s.trail] : []), ...s.past];
  const twin = (/** @type {any} */ p) => all.some(q => q !== p && shortName(q.properties.name) === shortName(p.properties.name) && day(q) === day(p));
  const plants = (/** @type {any} */ p) => { const n = p.properties.plants.length;
    const when = twin(p) ? `${day(p)}, ${new Date(p.properties.updatedAt).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(':', ' h ')}` : day(p);
    return `${n ? `${n} plante${n > 1 ? 's' : ''}` : 'aucune plante'} · ${when}`; };
  const stop = () => { app.cancel('locate'); s.startError = null; };
  return {
    id: 'trail',
    art: 'trail',
    title: 'Votre parcours botanique',
    lead: 'Marchez et nommez les plantes que vous croisez. Chacune prend sa place sur la carte de votre parcours.',
    primary: { icon: 'geo-alt-fill', label: 'Commencer ici', busyLabel: 'Localisation…', busy: app.busy('locate') || s.creating, cancel: () => { stop(); s.changed(); }, run: () => { app.do('locate'); } },
    error: s.startError,
    note: 'Votre position est envoyée à l’IGN pour nommer le lieu ; le parcours reste sur cet appareil, dans Mes plantes.',
    alternatives: [
      { kind: 'place', label: 'ou partir d’une commune', field: 'Partir d’une commune', pick: p => { stop(); s.create(p.coordinates, p.label); } },
      { kind: 'choices', label: 'Reprendre un parcours', items: all.map(p => ({ key: p.id, icon: 'flag-fill', label: shortName(p.properties.name), meta: plants(p), run: () => { stop(); s.resume(p); } })) }
    ],
    exit: { icon: 'camera-reels', label: 'Quitter le parcours : autres scénarios', run: () => { stop(); app.scenarios(); } }
  };
}
