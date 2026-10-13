// What vendor/lit.js exports (scripts/vendor.sh bundles lit with two of its directives), for tsc only: jsconfig.json
// maps 'lit' here. The types are lit's own, from node_modules (a dev dependency, the release of vendor/lit.js).
export * from '../node_modules/lit/index.js';
export { repeat } from 'lit/directives/repeat.js';
export { classMap } from 'lit/directives/class-map.js';
