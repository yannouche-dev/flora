#!/usr/bin/env bash
# The site as GitHub Pages serves it: what deploy-pages publishes, copied into one folder — for the deploy itself and
# for the smoke test (ci.yml), which opens the app as deployed, not the repository (a file left out shows there).
#   tools/assemble-site.sh _site
# The service worker gets its VERSION here (tools/stamp-sw.mjs): a fingerprint of the files it precaches, never
# bumped by hand. data/ign-catalog.json is copied as it is in the checkout: deploy-pages.yml writes a fresh one there
# first (scripts/build-ign-catalog.mjs), so the version follows it too.
# The flora is also packed for a first launch (tools/pack-flora.mjs: data/flora/, described in data/meta.json), and
# index.html gets a modulepreload for each module of the app's start (tools/preload-modules.mjs).
# Keep tools/check.sh's DEPLOYED list in step with it.
set -euo pipefail
[ $# -eq 1 ] || { echo 'usage: tools/assemble-site.sh <folder>' >&2; exit 2; }
out="$1"
cd "$(dirname "$0")/.."
mkdir -p "$out/data"
cp -r index.html manifest.webmanifest sw.js .nojekyll app assets vendor lib "$out/"
cp data/plants.json data/meta.json data/territories.json data/lookalikes.json data/safety.json data/ign-catalog.json "$out/data/"
# The flora packed for a fast first launch (data/flora/, listed in data/meta.json); then the critical modules
# preloaded by index.html (before the version: index.html is precached).
node tools/pack-flora.mjs "$out"
node tools/preload-modules.mjs "$out"
node tools/stamp-sw.mjs "$out"
