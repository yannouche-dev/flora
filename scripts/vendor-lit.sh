#!/usr/bin/env bash
# Regenerates vendor/lit.js: a single self-contained ES module bundle of Lit.
# Only needed when upgrading Lit — the app itself has no build step.
set -euo pipefail

LIT_VERSION="${LIT_VERSION:-3.3.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "lit@$LIT_VERSION" esbuild
cat > entry.js <<'JS'
export * from 'lit';
export { repeat } from 'lit/directives/repeat.js';
export { classMap } from 'lit/directives/class-map.js';
JS
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=inline --outfile=lit.min.js

{
  echo "/* Lit $LIT_VERSION (lit, lit/directives/repeat.js, lit/directives/class-map.js) — BSD-3-Clause. Regenerate with scripts/vendor-lit.sh */"
  cat lit.min.js
} > "$ROOT/vendor/lit.js"

echo "Wrote vendor/lit.js (Lit $LIT_VERSION)"
