// @ts-check
// IGN's WMTS catalogue read off the main thread (app/core/ign-catalog.js): the service's description is megabytes of
// XML, too much to parse on a phone's main thread. One message in ({ xml }), one out ({ layers } or { error }).

import { parseCapabilities } from '../../lib/ign-catalog.mjs';

self.addEventListener('message', ({ data }) => {
  try {
    self.postMessage({ layers: parseCapabilities(String(data?.xml ?? '')) });
  } catch (error) {
    self.postMessage({ error: /** @type {Error} */ (error)?.message || String(error) });
  }
});
