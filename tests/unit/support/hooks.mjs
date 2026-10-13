// Module resolution for the unit tests: what the import map of index.html gives the browser, Node gets here.
// 'leaflet' is a stub (leaflet-stub.mjs): no unit test draws a map. 'lit' is left unresolved on purpose: a module
// that renders is a component, tested in the browser (tests/e2e), not here.

const STUBS = { leaflet: new URL('./leaflet-stub.mjs', import.meta.url).href };

/** @param {string} specifier @param {any} context @param {Function} next */
export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return next(specifier, context);
}
