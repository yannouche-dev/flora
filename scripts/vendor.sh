#!/usr/bin/env bash
# Regenerates the vendored browser libraries in vendor/ as self-contained ES modules.
# Only needed when upgrading them — the app itself has no build step.
#   vendor/lit.js                   Lit (+ repeat, classMap directives)
#   vendor/leaflet.js, leaflet.css  Leaflet
set -euo pipefail

LIT_VERSION="${LIT_VERSION:-3.3.3}"
LEAFLET_VERSION="${LEAFLET_VERSION:-1.9.4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "lit@$LIT_VERSION" "leaflet@$LEAFLET_VERSION" esbuild

cat > lit-entry.js <<'JS'
export * from 'lit';
export { repeat } from 'lit/directives/repeat.js';
export { classMap } from 'lit/directives/class-map.js';
JS
npx esbuild lit-entry.js --bundle --format=esm --minify --legal-comments=inline --outfile=lit.min.js
{
  echo "/* Lit $LIT_VERSION (lit, lit/directives/repeat.js, lit/directives/class-map.js) — BSD-3-Clause. Regenerate with scripts/vendor.sh */"
  cat lit.min.js
} > "$ROOT/vendor/lit.js"

npx esbuild node_modules/leaflet/dist/leaflet-src.esm.js --format=esm --minify --legal-comments=inline --outfile=leaflet.min.js
{
  echo "/* Leaflet $LEAFLET_VERSION — BSD-2-Clause, (c) Volodymyr Agafonkin, CloudMade. Regenerate with scripts/vendor.sh */"
  cat leaflet.min.js
} > "$ROOT/vendor/leaflet.js"
cp node_modules/leaflet/dist/leaflet.css "$ROOT/vendor/leaflet.css"

echo "Wrote vendor/lit.js (Lit $LIT_VERSION), vendor/leaflet.js + leaflet.css (Leaflet $LEAFLET_VERSION)"
