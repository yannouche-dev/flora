#!/usr/bin/env bash
# The checks a change must pass before it ships: run on every pull request and push to main (ci.yml), before each
# deploy (deploy-pages.yml), and locally:
#   tools/check.sh           against the repository (the files deploy-pages copies)
#   tools/check.sh _site     against an assembled site (deploy-pages, after « Assemble site »)
#  - every module parses, as an ES module (catches import/declaration clashes a script parse misses);
#  - every import finds its file and the names it asks for, and the import map of index.html its files
#    (tools/check-imports.mjs): no build step links the modules, so a broken one only shows in the browser, as a
#    blank screen the service worker then caches;
#  - the service worker precaches every file of app/, vendor/, lib/ and assets/, index.html and the manifest (or
#    offline mode breaks), and every path it precaches is deployed (a single missing file and it never installs);
#    the one exception, its ON_DEMAND list: files of vendor/ kept once asked, not precached (MapLibre, ~1.6 MB, for
#    the « Vue 3D » only, which needs the network for its relief) — each deployed, none in SHELL too;
#  - its VERSION is written at deploy, from the files it precaches (tools/stamp-sw.mjs): 'dev' in the repository
#    (never bumped by hand), the fingerprint of the site's files in an assembled site;
#  - the safety data: look-alike pairs, toxicity sources, protection statuses (scripts/check-data.mjs);
#  - the licence rules of the images and their credits, as a table (tests/licenses.mjs);
#  - the CSP of index.html allows its inline scripts by hash (tools/csp-hash.mjs, when present).
# Every check runs, so one run lists every problem; the script exits 1 when any failed.
set -uo pipefail

SITE=''
if [ $# -gt 0 ]; then SITE="$(cd "$1" && pwd)" || { echo "::error::no site folder $1"; exit 1; }; fi
cd "$(dirname "$0")/.." || exit 1

# What deploy-pages copies into the site: keep in step with tools/assemble-site.sh.
DEPLOYED='index.html manifest.webmanifest sw.js .nojekyll app assets vendor lib
  data/plants.json data/meta.json data/territories.json data/lookalikes.json data/safety.json'

failed=0
fail() { echo "$1"; failed=1; }
step() { echo; echo "── $1"; }

step 'Modules parse (ES modules)'
# Each file parsed as a module, whatever its extension and the Node release: a script parse misses what only a module
# rejects (an import clashing with a declaration), and Node's guess from the syntax lets such a file through.
count=0
for file in sw.js vendor/*.js lib/*.mjs scripts/*.mjs tools/*.mjs $(find tests -name '*.mjs' | sort) $(find app -name '*.js' | sort); do
  count=$((count + 1))
  node --input-type=module --check < "$file" || fail "::error file=$file::$file does not parse"
done
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest', 'utf8'))" \
  || fail '::error file=manifest.webmanifest::manifest.webmanifest is not valid JSON'
echo "$count modules parsed, manifest read"

step "Imports resolve (tools/check-imports.mjs, against ${SITE:-the files deploy-pages copies})"
if [ -n "$SITE" ]; then
  node tools/check-imports.mjs "$SITE" || failed=1
else
  # Against what deploy-pages publishes, not the whole repository: a module, or an import-map target, outside it
  # is a 404 once deployed. The data files are linked, not copied (no module reads them).
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  for path in $DEPLOYED; do
    [ -e "$path" ] || continue
    mkdir -p "$tmp/$(dirname "$path")"
    case "$path" in data/*) ln -s "$PWD/$path" "$tmp/$path" ;; *) cp -R "$path" "$tmp/$path" ;; esac
  done
  node tools/check-imports.mjs "$tmp" || failed=1
fi

step "Service worker precache (sw.js SHELL${SITE:+, against $SITE})"
shell="$(sed -n "/^const SHELL = \[/,/^\];/p" sw.js | grep -o "'[^']*'" | tr -d "'")"
if [ -z "$shell" ]; then
  fail '::error file=sw.js::no « const SHELL = [ … ]; » list found in sw.js'
else
  ondemand="$(sed -n "/^const ON_DEMAND = \[/,/^\];/p" sw.js | grep -o "'[^']*'" | tr -d "'")"
  # Every file of the app must be precached by the service worker, or offline mode breaks.
  files=0
  for file in index.html manifest.webmanifest $(find app vendor lib assets -type f | sort); do
    files=$((files + 1))
    grep -qxF "$file" <<<"$shell" || grep -qxF "$file" <<<"$ondemand" || fail "::error file=sw.js::$file missing from SHELL (or ON_DEMAND)"
  done
  # The service worker precaches its SHELL in one go: a single missing file and it never installs.
  deployed() {
    if [ -n "$SITE" ]; then [ -f "$SITE/$1" ]; return; fi
    local d
    for d in $DEPLOYED; do
      case "$1" in "$d" | "$d"/*) [ -f "$1" ]; return ;; esac
    done
    return 1
  }
  paths=0
  for path in $shell; do
    paths=$((paths + 1))
    [ "$path" = ./ ] || deployed "$path" || fail "::error file=sw.js::$path is precached but not deployed"
  done
  # Files of vendor/ kept on demand (sw.js ON_DEMAND), not precached: documented there; never app/ (the app's own code
  # must work offline), never in both lists.
  for path in $ondemand; do
    case "$path" in vendor/*) ;; *) fail "::error file=sw.js::$path is ON_DEMAND: only files of vendor/ may be (the rest is precached)" ;; esac
    grep -qxF "$path" <<<"$shell" && fail "::error file=sw.js::$path is both in SHELL and ON_DEMAND"
    deployed "$path" || fail "::error file=sw.js::$path is kept on demand but not deployed"
  done
  echo "$paths precached paths, $(wc -w <<<"$ondemand") kept on demand; $files files of the app"
fi

step "Service worker version (tools/stamp-sw.mjs${SITE:+, against $SITE})"
if [ -n "$SITE" ]; then
  node tools/stamp-sw.mjs "$SITE" --check || failed=1
elif ! grep -qxF "const VERSION = 'dev';" sw.js; then
  fail "::error file=sw.js::sw.js must keep « const VERSION = 'dev'; »: the version is written at deploy (tools/assemble-site.sh), never by hand"
else
  # The copy of the deployed files above: stamped, its version is the fingerprint of its files, and changes with them.
  if node tools/stamp-sw.mjs "$tmp" >/dev/null && node tools/stamp-sw.mjs "$tmp" --check; then
    before="$(sed -n "s/^const VERSION = '\([0-9a-f]\{12\}\)';$/\1/p" "$tmp/sw.js")"
    echo '// changed' >> "$tmp/app/config.js"
    node tools/stamp-sw.mjs "$tmp" >/dev/null
    after="$(sed -n "s/^const VERSION = '\([0-9a-f]\{12\}\)';$/\1/p" "$tmp/sw.js")"
    if [ -z "$before" ] || [ "$before" = "$after" ]; then
      fail '::error file=tools/stamp-sw.mjs::the version written into sw.js does not follow the files it precaches'
    else
      echo "a changed file gives a new version ($before → $after)"
    fi
  else
    failed=1
  fi
fi

step 'Safety data (scripts/check-data.mjs)'
node scripts/check-data.mjs || failed=1

step 'Image licences and credits (tests/licenses.mjs)'
# app/core/credit.js is a plain .js module: Node reads it as one, and says so (the warning only).
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/licenses.mjs || failed=1

step 'Content-Security-Policy hashes (tools/csp-hash.mjs)'
if [ -f tools/csp-hash.mjs ]; then
  node tools/csp-hash.mjs || failed=1
else
  echo 'tools/csp-hash.mjs absent: skipped'
fi

echo
if [ "$failed" -ne 0 ]; then echo 'check.sh: FAILED'; exit 1; fi
echo 'check.sh: all checks passed'
