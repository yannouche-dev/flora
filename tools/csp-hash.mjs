// The Content-Security-Policy of index.html (a <meta>) against the page's inline scripts. The policy allows scripts
// from the site only, plus each inline <script> by the sha256 of its text: today the import map. Edit the import map
// without updating its hash and the browser refuses it, so the app does not start: this check is meant for CI.
//   node tools/csp-hash.mjs [index.html]         exits 1 when the policy and the inline scripts disagree
//   node tools/csp-hash.mjs --fix [index.html]   writes the hashes of the inline scripts into script-src
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const file = args.find(a => !a.startsWith('--')) || fileURLToPath(new URL('../index.html', import.meta.url));
const source = readFileSync(file, 'utf8');
// The browser hashes the script text as parsed: line breaks normalised to LF.
const lf = source.replace(/\r\n?/g, '\n');
// The markup, comments left out (a comment may well name a <script>).
const html = lf.replace(/<!--[\s\S]*?-->/g, '');

/** @param {string} why */
const fail = why => { console.error(`csp-hash: ${file}: ${why}`); process.exitCode = 1; };

const inline = [...lf.matchAll(/<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([all, attrs]) => !all.startsWith('<!--') && !/\bsrc\s*=/i.test(attrs))
  .map(([, , text]) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`);

const meta = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?Content-Security-Policy\b[^>]*>/i.exec(html);
const policy = meta && /\bcontent\s*=\s*"([^"]*)"/i.exec(meta[0])?.[1];
if (!meta || !policy) {
  fail('no <meta http-equiv="Content-Security-Policy" content="…"> found');
} else {
  // A <meta> policy only covers what the parser meets after it.
  const first = html.search(/<(script|link|style)\b/i);
  if (first !== -1 && first < meta.index) fail('the CSP <meta> must come before every <script>, <link> and <style>');
  const directives = policy.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]);
  const scriptSrc = directives.find(d => d[0].toLowerCase() === 'script-src');
  if (!scriptSrc) fail('the policy has no script-src');
  else if (fix) {
    const next = [...scriptSrc.filter(s => !/^'sha(256|384|512)-/.test(s)), ...inline].join(' ');
    const updated = policy.replace(/(^|;)\s*script-src\b[^;]*/i, (_, sep) => `${sep}${sep ? ' ' : ''}${next}`);
    if (updated !== policy) writeFileSync(file, source.replace(policy, () => updated));
    console.log(`csp-hash: script-src ${updated === policy ? 'already up to date' : 'updated'}: ${inline.join(' ') || '(no inline script)'}`);
  } else {
    const missing = inline.filter(h => !scriptSrc.includes(h));
    const stale = scriptSrc.filter(s => /^'sha(256|384|512)-/.test(s) && !inline.includes(s));
    const unsafe = scriptSrc.filter(s => /^'unsafe-(inline|eval|hashes)'$|^'strict-dynamic'$|^(data|blob|https?):?$|^\*$/i.test(s));
    if (missing.length) fail(`script-src lacks the hash of an inline script: ${missing.join(' ')} (run: node tools/csp-hash.mjs --fix)`);
    if (stale.length) fail(`script-src holds a hash matching no inline script: ${stale.join(' ')} (run: node tools/csp-hash.mjs --fix)`);
    if (unsafe.length) fail(`script-src must not allow ${unsafe.join(' ')}`);
    if (!process.exitCode) console.log(`csp-hash: ok, script-src allows the ${inline.length} inline script(s) by hash: ${inline.join(' ')}`);
  }
}
