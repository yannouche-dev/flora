// The version of the service worker, from what it precaches: no one bumps it by hand.
//   node tools/stamp-sw.mjs <site>            writes the version into <site>/sw.js (tools/assemble-site.sh)
//   node tools/stamp-sw.mjs <site> --check    exits 1 unless <site>/sw.js carries the version of its files (tools/check.sh)
// The version is the start of a sha256 over every file of the SHELL list of sw.js, as found in <site> (the path, then
// the bytes), and over sw.js itself with its VERSION line left out: any change to a precached file, to the list or to
// the worker gives a new version, so a new cache, installed whole while the previous one keeps serving; an unchanged
// site keeps its version (a redeploy of the same files downloads nothing again). In the repository, sw.js carries
// VERSION = 'dev' (the worker then serves the shell from the network first: edits show on a reload).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION_LINE = /^const VERSION = '([^']*)';$/m;

/** The paths of `const SHELL = [ … ];` in sw.js. @param {string} source */
export function shellPaths(source) {
  const list = /^const SHELL = \[\n([\s\S]*?)\n\];$/m.exec(source);
  if (!list) throw new Error('sw.js: no « const SHELL = [ … ]; » list');
  return [...list[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
}

/** The version of the site in `dir`, from its sw.js and the files it precaches. @param {string} dir */
export function siteVersion(dir) {
  const source = readFileSync(join(dir, 'sw.js'), 'utf8');
  if (!VERSION_LINE.test(source)) throw new Error("sw.js: no « const VERSION = '…'; » line");
  const hash = createHash('sha256');
  hash.update(source.replace(VERSION_LINE, ''));
  for (const path of shellPaths(source)) {
    if (path === './') continue; // index.html, listed too
    hash.update('\0' + path + '\0');
    hash.update(readFileSync(join(dir, path)));
  }
  return hash.digest('hex').slice(0, 12);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, flag] = process.argv.slice(2);
  if (!dir || (flag && flag !== '--check')) {
    console.error('usage: node tools/stamp-sw.mjs <site> [--check]');
    process.exit(2);
  }
  try {
    const file = join(dir, 'sw.js');
    const source = readFileSync(file, 'utf8');
    const version = siteVersion(dir);
    const current = VERSION_LINE.exec(source)?.[1];
    if (flag) {
      if (current !== version) {
        console.error(`::error file=sw.js::the service worker of ${dir} carries VERSION '${current}', its files give '${version}' (tools/assemble-site.sh writes it)`);
        process.exit(1);
      }
      console.log(`sw.js VERSION '${version}' matches its files`);
    } else {
      writeFileSync(file, source.replace(VERSION_LINE, `const VERSION = '${version}';`));
      console.log(`sw.js VERSION '${version}'`);
    }
  } catch (error) {
    console.error(`::error file=sw.js::${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
