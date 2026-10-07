// @ts-check
// Sharing without a server: links carry everything. Collections travel inside the URL itself,
// as compact JSON → deflate-raw → base64url. Notes and harvest logs are never included.

/**
 * Shares a link with the system share sheet, or copies it to the clipboard.
 * @param {{ title: string, text?: string, url: string }} data
 * @returns {Promise<'shared' | 'copied' | 'cancelled' | 'failed'>}
 */
export async function share({ title, text, url }) {
  const absolute = new URL(url, location.href).href;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, text, url: absolute });
      return 'shared';
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(absolute);
    return 'copied';
  } catch {
    // Last resort (insecure context, denied clipboard): let the user copy it by hand.
    prompt('Copiez ce lien :', absolute);
    return 'failed';
  }
}

/** @param {Uint8Array} bytes */
const toBase64Url = bytes => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** @param {string} text */
const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/** @param {Uint8Array} bytes @param {'compress' | 'decompress'} mode */
async function deflate(bytes, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'compress'
    ? new CompressionStream('deflate-raw')
    : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/**
 * @typedef {object} SharedCollection
 * @property {string} name
 * @property {'list' | 'place'} kind
 * @property {[number, number] | null} coordinates
 * @property {{ plantId: number, abundance?: string, coordinates?: [number, number] }[]} plants
 */

/**
 * Encodes a collection for a link. Prefix "z" = compressed, "j" = plain JSON.
 * @param {import('./collections.js').Collection} collection
 * @returns {Promise<string>}
 */
export async function encodeCollection(collection) {
  const p = collection.properties;
  const isPlace = p.kind === 'place' && collection.geometry;
  const compact = {
    v: 1,
    n: p.kind === 'favorites' ? 'Favoris partagés' : p.name,
    k: isPlace ? 'place' : 'list',
    ...(isPlace ? { c: collection.geometry?.coordinates } : {}),
    p: p.plants.filter(e => e.plantId !== null).map(e => {
      if (!isPlace) return [e.plantId];
      // Plant position as an offset from the place, in 1e-6 degrees (≈ 0.1 m): short integers.
      const origin = /** @type {[number, number]} */ (collection.geometry?.coordinates);
      const dx = e.coordinates ? Math.round((e.coordinates[0] - origin[0]) * 1e6) : 0;
      const dy = e.coordinates ? Math.round((e.coordinates[1] - origin[1]) * 1e6) : 0;
      const code = e.abundance !== 'moyen' ? e.abundance[0] : 0;
      return dx || dy ? [e.plantId, code, dx, dy] : code ? [e.plantId, code] : [e.plantId];
    })
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  return canCompress() ? 'z' + toBase64Url(await deflate(bytes, 'compress')) : 'j' + toBase64Url(bytes);
}

const ABUNDANCE_CODES = { r: 'rare', m: 'moyen', a: 'abondant' };
const isNumber = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Decodes and validates a shared collection; throws a French message on invalid data.
 * @param {string} data
 * @returns {Promise<SharedCollection>}
 */
export async function decodeCollection(data) {
  let json;
  try {
    const bytes = fromBase64Url(data.slice(1));
    if (data[0] === 'z') {
      if (!canCompress()) throw new Error('unsupported');
      json = JSON.parse(new TextDecoder().decode(await deflate(bytes, 'decompress')));
    } else if (data[0] === 'j') {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      throw new Error('format');
    }
  } catch (error) {
    throw new Error(/** @type {Error} */ (error).message === 'unsupported'
      ? 'Ce navigateur ne sait pas ouvrir ce lien compressé.'
      : 'Ce lien de partage est incomplet ou abîmé.');
  }
  if (json?.v !== 1 || !Array.isArray(json.p)) throw new Error('Ce lien de partage n’est pas reconnu.');

  const c = Array.isArray(json.c) && isNumber(json.c[0]) && isNumber(json.c[1]) &&
    Math.abs(json.c[0]) <= 180 && Math.abs(json.c[1]) <= 90 ? /** @type {[number, number]} */ ([json.c[0], json.c[1]]) : null;
  const seen = new Set();
  const plants = json.p
    .filter(row => Array.isArray(row) && Number.isInteger(row[0]) && !seen.has(row[0]) && seen.add(row[0]))
    .slice(0, 2000)
    .map(row => {
      /** @type {{ plantId: number, abundance?: string, coordinates?: [number, number] }} */
      const plant = { plantId: row[0] };
      if (ABUNDANCE_CODES[row[1]]) plant.abundance = ABUNDANCE_CODES[row[1]];
      // Offsets from the place (1e-6°), bounded to ~10 km; older links have none.
      if (c && Number.isInteger(row[2]) && Number.isInteger(row[3]) && Math.abs(row[2]) <= 1e5 && Math.abs(row[3]) <= 1e5) {
        plant.coordinates = [Math.round((c[0] + row[2] / 1e6) * 1e7) / 1e7, Math.round((c[1] + row[3] / 1e6) * 1e7) / 1e7];
      }
      return plant;
    });

  return {
    name: typeof json.n === 'string' ? json.n.slice(0, 300) : '',
    kind: json.k === 'place' && c ? 'place' : 'list',
    coordinates: json.k === 'place' ? c : null,
    plants
  };
}
