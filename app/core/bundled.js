// @ts-check
// The JSON files bundled with the app (data/*.json, precached by sw.js): read once, then kept while the app runs.
// A file that cannot be read, or whose content is wrong, is an error and is forgotten at once: the next call reads
// it again (« Réessayer » after a failure, a mini-app asking again). Used by core/lookalikes.js (lookalikeData),
// core/uses.js (safetyData) and core/territory.js (territories). No imports.

/** @type {Map<string, Promise<any>>} file → its reading, kept until it fails */
const reading = new Map();

/**
 * A file of data/, read once (fetch is looked up at each call: the tests replace it). Rejects, and is read again next
 * time, on an HTTP error (« lookalikes 404 »), a file that is not JSON, or when `check` names a problem with its
 * content (« lookalikes: no pairs »).
 * @param {string} file          its name in data/ (« lookalikes.json »); the errors name it without « .json »
 * @param {{ check?: (data: any) => string | null }} [options]   check: the problem with the content, null for none
 * @returns {Promise<any>}
 */
export function bundledJSON(file, { check } = {}) {
  const name = file.replace(/\.json$/, '');
  let pending = reading.get(file);
  if (!pending) {
    pending = fetch(new URL('../../data/' + file, import.meta.url)).then(async r => {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      const data = await r.json();
      const problem = check?.(data);
      if (problem) throw new Error(name + ': ' + problem);
      return data;
    }).catch(error => { reading.delete(file); throw error; });
    reading.set(file, pending);
  }
  return pending;
}
