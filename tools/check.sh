#!/usr/bin/env bash
# The checks a change must pass before it ships: run on every pull request and push to main (ci.yml), before each
# deploy (deploy-pages.yml), and locally:
#   tools/check.sh           against the repository (the files deploy-pages copies)
#   tools/check.sh _site     against an assembled site (deploy-pages, after « Assemble site »)
#  - every module parses, as an ES module (catches import/declaration clashes a script parse misses);
#  - every import finds its file and the names it asks for, and the import map of index.html its files
#    (tools/check-imports.mjs): no build step links the modules, so a broken one only shows in the browser, as a
#    blank screen the service worker then caches;
#  - the service worker precaches every app and vendor script and stylesheet (or offline mode breaks), and every
#    path it precaches is deployed (a single missing file and it never installs);
#  - the safety data: look-alike pairs, toxicity sources, protection statuses (scripts/check-data.mjs);
#  - the CSP of index.html allows its inline scripts by hash (tools/csp-hash.mjs, when present).
# Every check runs, so one run lists every problem; the script exits 1 when any failed.
set -uo pipefail

SITE=''
if [ $# -gt 0 ]; then SITE="$(cd "$1" && pwd)" || { echo "::error::no site folder $1"; exit 1; }; fi
cd "$(dirname "$0")/.." || exit 1

# What deploy-pages copies into the site: keep in step with its « Assemble site » step.
DEPLOYED='index.html manifest.webmanifest sw.js .nojekyll app assets vendor lib
  data/plants.json data/meta.json data/territories.json data/lookalikes.json data/safety.json'

failed=0
fail() { echo "$1"; failed=1; }
step() { echo; echo "── $1"; }

step 'Modules parse (ES modules)'
count=0
for file in sw.js vendor/*.js lib/*.mjs scripts/*.mjs tools/*.mjs $(find app -name '*.js' | sort); do
  count=$((count + 1))
  node --experimental-default-type=module --check "$file" || fail "::error file=$file::$file does not parse"
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
  # Every app file must be precached by the service worker, or offline mode breaks.
  files=0
  for file in $(find app vendor \( -name '*.js' -o -name '*.css' \) | sort); do
    files=$((files + 1))
    grep -qxF "$file" <<<"$shell" || fail "::error file=sw.js::$file missing from SHELL"
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
  echo "$paths precached paths; $files app and vendor scripts and stylesheets"
fi

step 'Safety data (scripts/check-data.mjs)'
node scripts/check-data.mjs || failed=1

step 'Content-Security-Policy hashes (tools/csp-hash.mjs)'
if [ -f tools/csp-hash.mjs ]; then
  node tools/csp-hash.mjs || failed=1
else
  echo 'tools/csp-hash.mjs absent: skipped'
fi

echo
if [ "$failed" -ne 0 ]; then echo 'check.sh: FAILED'; exit 1; fi
echo 'check.sh: all checks passed'
