// @ts-check
// Main-thread client for workers/search.worker.js (latest request wins).

import { store } from './store.js';

const worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' });

let lastRequest = 0;
/** @type {Map<number, (value: any) => void>} */
const waiting = new Map();

worker.addEventListener('message', ({ data }) => {
  const resolve = waiting.get(data.requestId);
  if (!resolve) return;
  waiting.delete(data.requestId);
  resolve(data);
});

/** @param {Record<string, any>} message */
function call(message) {
  const requestId = ++lastRequest;
  return new Promise((resolve, reject) => {
    waiting.set(requestId, data => data.error ? reject(new Error(data.error)) : resolve(data));
    worker.postMessage({ ...message, requestId });
  });
}

/** (Re)builds the search index from IndexedDB. */
export async function loadIndex() {
  const { families } = await call({ type: 'load' });
  store.set({ families });
}

/** Runs the search for the current store query/filters and publishes the results. */
export async function runSearch() {
  const { query, family, statuses } = store.state;
  const requestId = lastRequest + 1;
  const { total, items } = await call({ type: 'search', query, family, statuses });
  // Drop answers that a newer keystroke already superseded.
  if (requestId === lastRequest) store.set({ results: { total, items } });
}
