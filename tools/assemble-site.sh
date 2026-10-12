#!/usr/bin/env bash
# The site as GitHub Pages serves it: what deploy-pages publishes, copied into one folder — for the deploy itself and
# for the smoke test (ci.yml), which opens the app as deployed, not the repository (a file left out shows there).
#   tools/assemble-site.sh _site
# Keep tools/check.sh's DEPLOYED list in step with it.
set -euo pipefail
[ $# -eq 1 ] || { echo 'usage: tools/assemble-site.sh <folder>' >&2; exit 2; }
out="$1"
cd "$(dirname "$0")/.."
mkdir -p "$out/data"
cp -r index.html manifest.webmanifest sw.js .nojekyll app assets vendor lib "$out/"
cp data/plants.json data/meta.json data/territories.json data/lookalikes.json data/safety.json "$out/data/"
