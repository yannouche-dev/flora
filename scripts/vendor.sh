#!/usr/bin/env bash
# Regenerates the vendored browser libraries in vendor/ as self-contained ES modules.
# Only needed when upgrading them — the app itself has no build step.
#   vendor/lit.js                   Lit (+ repeat, classMap directives)
#   vendor/leaflet.js, leaflet.css  Leaflet
#   vendor/maplibre/                MapLibre GL JS (Vue 3D): its ESM files as published, byte for byte — the npm tarball
#                                   checked against the registry's integrity first. Loaded on demand only (import() when
#                                   the 3D view opens; sw.js ON_DEMAND, not precached). From 6.13 the bundle holds
#                                   everything (maplibre-gl-shared.mjs is empty, left out); its worker is a module worker
#                                   it finds next to itself (maplibre-gl-worker.mjs).
set -euo pipefail

LIT_VERSION="${LIT_VERSION:-3.3.3}"
LEAFLET_VERSION="${LEAFLET_VERSION:-1.9.4}"
# A release at least 7 days old (the repository's rule for dependencies).
MAPLIBRE_VERSION="${MAPLIBRE_VERSION:-6.14.0}"
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

# MapLibre: the tarball, its sha512 compared with the registry's `dist.integrity`, then its dist files copied as they are.
want="$(npm view "maplibre-gl@$MAPLIBRE_VERSION" dist.integrity)"
tarball="$(npm pack --silent "maplibre-gl@$MAPLIBRE_VERSION")"
got="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d '\n')"
if [ "$got" != "$want" ]; then
  echo "maplibre-gl@$MAPLIBRE_VERSION: tarball integrity $got, registry says $want" >&2
  exit 1
fi
mkdir maplibre && tar xzf "$tarball" -C maplibre
rm -rf "$ROOT/vendor/maplibre" && mkdir -p "$ROOT/vendor/maplibre"
for file in maplibre-gl.mjs maplibre-gl-worker.mjs maplibre-gl.css; do
  [ -s "maplibre/package/dist/$file" ] || { echo "maplibre-gl@$MAPLIBRE_VERSION: dist/$file missing or empty" >&2; exit 1; }
  cp "maplibre/package/dist/$file" "$ROOT/vendor/maplibre/$file"
done
# An older layout (before 6.13) splits the code into a third file the other two import.
if [ -s maplibre/package/dist/maplibre-gl-shared.mjs ]; then cp maplibre/package/dist/maplibre-gl-shared.mjs "$ROOT/vendor/maplibre/"; fi
cp maplibre/package/LICENSE.txt "$ROOT/vendor/maplibre/LICENSE.txt"

echo "Wrote vendor/lit.js (Lit $LIT_VERSION), vendor/leaflet.js + leaflet.css (Leaflet $LEAFLET_VERSION), vendor/maplibre/ (MapLibre GL JS $MAPLIBRE_VERSION, integrity $got)"
