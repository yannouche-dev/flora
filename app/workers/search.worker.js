// @ts-check
// Search, faceted filtering and sorting over the local flora, off the main thread.
// ~7.7k species: a ranked linear scan answers in a few milliseconds, no library needed.

import { getAll } from '../core/db.js';
import { buildIndex, search } from './search-core.js';

/** The index of the plants last loaded (core/search.js asks for a load first). */
let index = buildIndex([]);

self.addEventListener('message', async ({ data }) => {
  const { requestId } = data;
  try {
    if (data.type === 'load') {
      index = buildIndex(await getAll('plants'));
      const genusFamily = Object.fromEntries(index.entries.map(e => [e.values.genus, e.values.family]));
      self.postMessage({ requestId, count: index.entries.length, genusFamily });
    } else if (data.type === 'search') {
      self.postMessage({ requestId, ...search(index, data) });
    }
  } catch (error) {
    self.postMessage({ requestId, error: /** @type {Error} */ (error).message });
  }
});
