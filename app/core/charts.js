// @ts-check
// Small SVG charts (no library), drawn from sourced data only: the network of a plant's interactions,
// the climate niche of a species, the climate diagram of a place. Sized by their viewBox; colours from
// the app's tokens where possible.

import { html, svg, nothing } from 'lit';

/** Colours of partner groups (interaction network, legends). */
export const GROUP_COLORS = {
  'Abeilles et bourdons': '#e0a106', 'Syrphes': '#f2c94c', 'Papillons': '#c2185b', 'Coléoptères': '#6d4c41', 'Punaises et pucerons': '#8e6bbf',
  'Guêpes, fourmis et tenthrèdes': '#ef6c00', 'Mouches': '#607d8b', 'Criquets et sauterelles': '#7cb342', 'Thrips': '#9e9d24',
  'Acariens': '#a1887f', 'Araignées et acariens': '#795548', 'Autres insectes': '#90a4ae', 'Escargots et limaces': '#bcaaa4', 'Nématodes': '#cfa38f',
  'Oiseaux': '#1e88e5', 'Mammifères': '#5d4037', 'Champignons': '#8d6e63', 'Oomycètes': '#b0bec5', 'Bactéries': '#26a69a', 'Virus': '#e53935',
  'Plantes': '#43a047', 'Autres animaux': '#78909c', 'Autres': '#9e9e9e'
};

/** @param {string} group */
export const groupColor = group => /** @type {Record<string, string>} */ (GROUP_COLORS)[group] || '#9e9e9e';

/**
 * The plant at the centre, its partners around it, one sector per role (pollinators, herbivores…),
 * each node sized by its number of mentions and coloured by its group. Up to `max` partners.
 * @param {string} name @param {import('./open-data.js').RoleGroup[]} roles @param {number} [max]
 */
export function networkChart(name, roles, max = 40) {
  const W = 640, H = 440, cx = W / 2, cy = H / 2, R = 170;
  // Share the nodes between the roles, at least 3 each when they have them.
  const total = roles.reduce((n, r) => n + Math.min(r.partners.length, max), 0) || 1;
  const picked = roles.map(r => r.partners.slice(0, Math.max(3, Math.round(max * Math.min(r.partners.length, max) / total))));
  const count = picked.reduce((n, l) => n + l.length, 0) || 1;
  const top = Math.max(1, ...picked.flat().map(p => p.count));
  let index = 0;
  const gap = roles.length > 1 ? 0.14 : 0;
  const nodes = [];
  const sectors = [];
  for (const [i, list] of picked.entries()) {
    const start = index / count * Math.PI * 2 + gap / 2;
    for (const p of list) {
      const a = (index + 0.5) / count * Math.PI * 2 - Math.PI / 2;
      const ring = R - (nodes.length % 2) * 34;
      nodes.push({ p, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring, a, r: 4 + 9 * Math.sqrt(p.count / top), role: roles[i].key });
      index++;
    }
    sectors.push({ role: roles[i], start, end: index / count * Math.PI * 2 - gap / 2 });
  }
  const labelled = new Set(nodes.slice().sort((a, b) => b.p.count - a.p.count).slice(0, 14).map(n => n.p.name));
  return html`<svg class="chart network" viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Réseau des interactions de ${name} : ${nodes.length} espèces`}>
    ${sectors.map(s => {
      const mid = (s.start + s.end) / 2 - Math.PI / 2;
      return svg`<text class="sector" x=${cx + Math.cos(mid) * (R + 46)} y=${cy + Math.sin(mid) * (R + 46)} text-anchor="middle">${s.role.short || s.role.label.split(' ')[0]}</text>`;
    })}
    ${nodes.map(n => svg`<line x1=${cx} y1=${cy} x2=${n.x} y2=${n.y} stroke=${groupColor(n.p.group)} stroke-opacity="0.35" stroke-width=${1 + n.r / 6}></line>`)}
    ${nodes.map(n => svg`<g class="node"><circle cx=${n.x} cy=${n.y} r=${n.r} fill=${groupColor(n.p.group)} stroke="#fff" stroke-width="1.5"><title>${n.p.name} — ${n.p.group} (${n.p.count} mention${n.p.count > 1 ? 's' : ''})</title></circle>
      ${labelled.has(n.p.name) ? svg`<text x=${n.x + (Math.cos(n.a) >= 0 ? n.r + 4 : -n.r - 4)} y=${n.y + 4} text-anchor=${Math.cos(n.a) >= 0 ? 'start' : 'end'} class="label">${n.p.name}</text>` : nothing}</g>`)}
    <circle cx=${cx} cy=${cy} r="30" class="center"></circle>
    <text x=${cx} y=${cy + 4} text-anchor="middle" class="center-label">${name.split(' ')[0]}</text>
  </svg>`;
}

/** Legend of the groups present. @param {import('./open-data.js').RoleGroup[]} roles */
export function groupLegend(roles) {
  const counts = new Map();
  for (const r of roles) for (const p of r.partners) counts.set(p.group, (counts.get(p.group) || 0) + 1);
  return html`<ul class="legend">${[...counts].sort((a, b) => b[1] - a[1]).map(([g, n]) => html`<li><i style=${`background:${groupColor(g)}`}></i>${g} (${n})</li>`)}</ul>`;
}

/**
 * Climate niche: annual mean temperature (x) against annual precipitation (y) of the species' occurrences,
 * with an optional « here » point (the user's position) and my places.
 * @param {{ temp: number, precip: number }[]} points @param {{ temp: number, precip: number, label: string } | null} here
 */
export function nicheChart(points, here) {
  const W = 560, H = 300, L = 46, B = 34, T = 12, Rm = 14;
  const all = [...points, ...(here ? [here] : [])];
  const tMin = Math.floor(Math.min(...all.map(p => p.temp)) - 1), tMax = Math.ceil(Math.max(...all.map(p => p.temp)) + 1);
  const pMin = Math.max(0, Math.floor((Math.min(...all.map(p => p.precip)) - 100) / 100) * 100), pMax = Math.ceil((Math.max(...all.map(p => p.precip)) + 100) / 100) * 100;
  const x = (/** @type {number} */ t) => L + (t - tMin) / (tMax - tMin || 1) * (W - L - Rm);
  const y = (/** @type {number} */ p) => H - B - (p - pMin) / (pMax - pMin || 1) * (H - B - T);
  const tTicks = [];
  for (let t = Math.ceil(tMin); t <= tMax; t += tMax - tMin > 12 ? 4 : 2) tTicks.push(t);
  const pTicks = [];
  const pStep = pMax - pMin > 1200 ? 400 : 200;
  for (let p = Math.ceil(pMin / pStep) * pStep; p <= pMax; p += pStep) pTicks.push(p);
  // The niche's box: from the 10th to the 90th percentile of each axis.
  const q = (/** @type {number[]} */ v, /** @type {number} */ f) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
  const box = points.length >= 5 ? { t1: q(points.map(p => p.temp), 0.1), t2: q(points.map(p => p.temp), 0.9), p1: q(points.map(p => p.precip), 0.1), p2: q(points.map(p => p.precip), 0.9) } : null;
  return html`<svg class="chart niche" viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Niche climatique : ${points.length} occurrences, de ${tMin + 1} à ${tMax - 1} °C et de ${pMin + 100} à ${pMax - 100} mm par an`}>
    ${tTicks.map(t => svg`<line class="grid" x1=${x(t)} x2=${x(t)} y1=${T} y2=${H - B}></line><text class="tick" x=${x(t)} y=${H - B + 16} text-anchor="middle">${t} °C</text>`)}
    ${pTicks.map(p => svg`<line class="grid" x1=${L} x2=${W - Rm} y1=${y(p)} y2=${y(p)}></line><text class="tick" x=${L - 6} y=${y(p) + 4} text-anchor="end">${p}</text>`)}
    <text class="axis" x=${W - Rm} y=${H - 4} text-anchor="end">température moyenne annuelle</text>
    <text class="axis" x="4" y=${T + 2} transform="rotate(0)">mm/an</text>
    ${box ? svg`<rect class="box" x=${x(box.t1)} y=${y(box.p2)} width=${Math.max(2, x(box.t2) - x(box.t1))} height=${Math.max(2, y(box.p1) - y(box.p2))} rx="6"></rect>` : nothing}
    ${points.map(p => svg`<circle class="occ" cx=${x(p.temp)} cy=${y(p.precip)} r="5"><title>${p.temp} °C · ${p.precip} mm/an</title></circle>`)}
    ${here ? svg`<g class="here"><circle cx=${x(here.temp)} cy=${y(here.precip)} r="8"></circle><text x=${x(here.temp) + 11} y=${y(here.precip) + 4}>${here.label}</text></g>` : nothing}
  </svg>`;
}

/**
 * Climate diagram of a place: precipitation per month (bars) and mean temperature (line), January to December.
 * @param {number[]} temp @param {number[]} precip
 */
export function climateChart(temp, precip) {
  const W = 560, H = 230, L = 36, Rr = 40, B = 26, T = 12;
  const tMin = Math.min(0, Math.floor(Math.min(...temp) / 5) * 5), tMax = Math.max(20, Math.ceil(Math.max(...temp) / 5) * 5);
  const pMax = Math.max(100, Math.ceil(Math.max(...precip) / 50) * 50);
  const bw = (W - L - Rr) / 12;
  const xm = (/** @type {number} */ m) => L + bw * m + bw / 2;
  const yt = (/** @type {number} */ t) => H - B - (t - tMin) / (tMax - tMin) * (H - B - T);
  const yp = (/** @type {number} */ p) => H - B - p / pMax * (H - B - T);
  const tTicks = [];
  for (let t = tMin; t <= tMax; t += 5) tTicks.push(t);
  const names = 'JFMAMJJASOND';
  return html`<svg class="chart climate" viewBox="0 0 ${W} ${H}" role="img"
    aria-label=${'Climat par mois : ' + temp.map((t, m) => `${names[m]} ${t} °C ${precip[m]} mm`).join(', ')}>
    ${tTicks.map(t => svg`<line class="grid" x1=${L} x2=${W - Rr} y1=${yt(t)} y2=${yt(t)}></line><text class="tick" x=${L - 6} y=${yt(t) + 4} text-anchor="end">${t}°</text>`)}
    ${[0, pMax / 2, pMax].map(p => svg`<text class="tick rain" x=${W - Rr + 6} y=${yp(p) + 4}>${p}</text>`)}
    ${precip.map((p, m) => svg`<rect class="rain" x=${xm(m) - bw * 0.32} y=${yp(p)} width=${bw * 0.64} height=${H - B - yp(p)} rx="2"><title>${p} mm</title></rect>`)}
    <polyline class="temp" points=${temp.map((t, m) => `${xm(m)},${yt(t)}`).join(' ')}></polyline>
    ${temp.map((t, m) => svg`<circle class="temp" cx=${xm(m)} cy=${yt(t)} r="3"><title>${t} °C</title></circle><text class="tick" x=${xm(m)} y=${H - 8} text-anchor="middle">${names[m]}</text>`)}
  </svg>`;
}

/** Styles of these charts, for the components that show them. */
export const chartStyles = `
  svg.chart { display: block; width: 100%; height: auto; max-width: 640px; overflow: visible; font-family: inherit; }
  svg.chart .grid { stroke: var(--gf-border); stroke-width: 1; }
  svg.chart .tick { fill: var(--gf-text-muted); font-size: 11px; }
  svg.chart .axis { fill: var(--gf-text-muted); font-size: 11px; font-weight: 600; }
  svg.chart .label { fill: var(--gf-text); font-size: 11px; font-style: italic; }
  svg.chart .sector { fill: var(--gf-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  svg.chart .center { fill: var(--gf-accent); }
  svg.chart .center-label { fill: #fff; font-size: 11px; font-weight: 700; font-style: italic; }
  svg.chart .node circle { cursor: default; }
  svg.chart .occ { fill: var(--gf-accent); fill-opacity: 0.6; stroke: #fff; stroke-width: 1; }
  svg.chart .box { fill: var(--gf-accent); fill-opacity: 0.1; stroke: var(--gf-accent); stroke-dasharray: 4 4; }
  svg.chart .here circle { fill: #e11d48; stroke: #fff; stroke-width: 2; }
  svg.chart .here text { fill: #e11d48; font-size: 12px; font-weight: 700; }
  svg.chart rect.rain { fill: #4e7b9f; fill-opacity: 0.75; }
  svg.chart .tick.rain { fill: #4e7b9f; }
  svg.chart polyline.temp { fill: none; stroke: #e65100; stroke-width: 2.5; }
  svg.chart circle.temp { fill: #e65100; }
  ul.legend { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.78rem; color: var(--gf-text-muted); }
  ul.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
`;
