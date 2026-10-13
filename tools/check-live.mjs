// After a deploy: the live site is the one just assembled (post-deploy.yml, audit TEST-14). Against the site
// assembled from the commit deployed (tools/assemble-site.sh), it checks on the live URL:
//  - the service worker carries the same VERSION (tools/stamp-sw.mjs: the fingerprint of every file it precaches),
//    and data/meta.json the same flora fingerprint (sha256 of plants.json, scripts/fingerprint-dataset.mjs). GitHub
//    Pages takes a moment to publish and its CDN keeps files up to 10 minutes: both are asked again, with a query
//    string the CDN has not seen, every 15 s until they match or the wait is over;
//  - then every file the service worker precaches, and the data files, answer 200 (one missing file and the new
//    version never installs: the app stays on the previous one, silently).
//   bash tools/assemble-site.sh _site && node tools/check-live.mjs _site https://yannouche-dev.github.io/flora/ [--wait 600]
// Exits 0 when the live site is this one, 3 when it still serves another version at the end of the wait (a deploy
// that did not land, or a newer one already there: post-deploy.yml tells them apart), 1 on a missing file or an
// error, 2 on a usage error.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { shellPaths, VERSION_LINE } from './stamp-sw.mjs';

const DATA = ['data/plants.json', 'data/meta.json', 'data/territories.json', 'data/lookalikes.json', 'data/safety.json'];
const AGENT = 'GeoFlora post-deploy check (https://github.com/yannouche-dev/flora)';

const args = process.argv.slice(2);
const waitAt = args.indexOf('--wait');
const WAIT_S = waitAt >= 0 ? Number(args.splice(waitAt, 2)[1]) : 600;
const [site, url] = args;
if (!site || !url || !/^https?:\/\//.test(url) || !Number.isFinite(WAIT_S)) {
  console.error('usage: node tools/check-live.mjs <site> <https://…/> [--wait seconds]');
  process.exit(2);
}
const BASE = new URL(url.endsWith('/') ? url : url + '/');

/** @param {string} path @param {RequestInit} [init] */
const get = (path, init = {}) => fetch(new URL(path, BASE), {
  ...init, cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(30000),
  headers: { 'user-agent': AGENT, 'cache-control': 'no-cache' }
});

/** What the live site serves now: its sw.js VERSION and its flora fingerprint, past the CDN's copies. */
async function live() {
  const fresh = `?deploy-check=${Date.now()}`;
  const [sw, meta] = await Promise.all([get('sw.js' + fresh), get('data/meta.json' + fresh)]);
  return {
    version: sw.ok ? VERSION_LINE.exec(await sw.text())?.[1] ?? '(no VERSION line)' : `(sw.js: HTTP ${sw.status})`,
    sha256: meta.ok ? (await meta.json())?.sha256 ?? '(no sha256)' : `(meta.json: HTTP ${meta.status})`
  };
}

try {
  const source = readFileSync(join(site, 'sw.js'), 'utf8');
  const expected = {
    version: VERSION_LINE.exec(source)?.[1],
    sha256: JSON.parse(readFileSync(join(site, 'data/meta.json'), 'utf8')).sha256
  };
  if (!expected.version || expected.version === 'dev') throw new Error(`${site}/sw.js is not stamped (tools/assemble-site.sh stamps it)`);
  console.log(`expected: sw.js VERSION '${expected.version}', flora ${expected.sha256}`);

  const deadline = Date.now() + WAIT_S * 1000;
  let now = await live().catch(e => ({ version: `(${e})`, sha256: '' }));
  while ((now.version !== expected.version || now.sha256 !== expected.sha256) && Date.now() < deadline) {
    console.log(`live:     sw.js VERSION '${now.version}', flora ${now.sha256} — asked again in 15 s`);
    await sleep(15000);
    now = await live().catch(e => ({ version: `(${e})`, sha256: '' }));
  }
  if (now.version !== expected.version || now.sha256 !== expected.sha256) {
    console.log(`::error::after ${WAIT_S} s, ${BASE.href} serves sw.js VERSION '${now.version}' and flora ${now.sha256}, not '${expected.version}' and ${expected.sha256}`);
    process.exit(3);
  }
  console.log(`live:     the same, at ${BASE.href}`);

  // Every precached file and the data files, a few at a time (HEAD: the bytes are not needed).
  const paths = [...new Set([...shellPaths(source), ...DATA])];
  const missing = [];
  for (let i = 0; i < paths.length; i += 8) {
    const answers = await Promise.all(paths.slice(i, i + 8).map(p => get(p, { method: 'HEAD' }).then(r => [p, r.status], e => [p, String(e)])));
    for (const [p, status] of answers) if (status !== 200) missing.push(`${p}: ${status}`);
  }
  for (const m of missing) console.log(`::error::${new URL(m.split(':')[0], BASE).href} does not load (${m})`);
  if (missing.length) process.exit(1);
  console.log(`${paths.length} files of the site load (every precached file, and the data)`);
} catch (error) {
  console.log(`::error::the live check failed: ${/** @type {Error} */ (error).message}`);
  process.exit(1);
}
