// @ts-check
// The texts written in the plant sheet's « Note » blocks (one per block and plant), kept in IndexedDB with the
// collections (store sheetNotes, one record per text) — in the GeoJSON export, the transfer link with personal data
// and the backup copy. Until version 6 of the database they were one localStorage key (geoflora.plantNotes):
// loadNotes() moves them over once, adding only what the database does not have, then removes the key — run again
// (another tab, an interrupted move) it changes nothing, and a text is never lost: while the move fails, the texts
// are still read from the old key.
// The sheet renders them synchronously: they are read into memory at startup, and again when another tab changes one.

import { config } from '../config.js';
import * as db from './db.js';
import { readJSON, writeText } from './prefs.js';
import { noteStorageError } from './quota.js';
import { publish, subscribe } from './sync.js';

/** @typedef {{ key: string, note: string, plantId: number, text: string, updatedAt: string }} NoteText */

const STORE = 'sheetNotes';

/** note id → plant id → its text. @type {Map<string, Map<number, NoteText>>} */
let cache = new Map();

let loaded = false;
/** Whether the texts are read (before, an export or a backup would have none). */
export const notesLoaded = () => loaded;

/** Fires `change` when a text changes (here or in another tab), and once the texts are read. */
export const notesEvents = new EventTarget();
const changed = () => notesEvents.dispatchEvent(new Event('change'));

/** @param {string} note @param {number} plantId */
const keyOf = (note, plantId) => `${note}|${plantId}`;

/** @param {Map<string, Map<number, NoteText>>} map @param {string} note @param {number} plantId @param {NoteText | null} record */
function setIn(map, note, plantId, record) {
  let byPlant = map.get(note);
  if (!byPlant) map.set(note, byPlant = new Map());
  if (record) byPlant.set(plantId, record); else byPlant.delete(plantId);
  if (!byPlant.size) map.delete(note);
}

/** @param {any} r @returns {r is NoteText} */
const isRecord = r => r && typeof r.note === 'string' && Number.isInteger(r.plantId) && typeof r.text === 'string' && r.text.trim() !== '';

/** The texts of the earlier versions (localStorage), as records. @param {string} at @returns {NoteText[]} */
function legacyTexts(at) {
  const data = readJSON(config.storageKeys.plantNotes, null);
  if (!data || typeof data !== 'object') return [];
  /** @type {NoteText[]} */
  const out = [];
  for (const [note, byPlant] of Object.entries(data)) {
    if (!byPlant || typeof byPlant !== 'object') continue;
    for (const [plant, text] of Object.entries(byPlant)) {
      const plantId = Number(plant);
      if (typeof text === 'string' && text.trim() && Number.isInteger(plantId)) out.push({ key: keyOf(note, plantId), note, plantId, text, updatedAt: at });
    }
  }
  return out;
}

/** Reads every text (after moving the old ones over). Resolves once they are in memory. */
export async function loadNotes() {
  const legacy = legacyTexts(new Date().toISOString());
  let moved = !legacy.length;
  if (legacy.length) {
    try {
      // Only what the database does not have: a text already moved (and maybe edited since) is left as it is.
      await db.addMissing(STORE, legacy);
      writeText(config.storageKeys.plantNotes, null); // not removed: moved all the same
      moved = true;
    } catch (error) {
      noteStorageError(error);
      console.error('Notes de fiche : pas encore déplacées dans IndexedDB', error);
    }
  }
  /** @type {NoteText[]} */
  let stored = [];
  try { stored = await db.getAll(STORE); } catch (error) { console.error(error); }
  /** @type {Map<string, Map<number, NoteText>>} */
  const next = new Map();
  for (const r of stored) if (isRecord(r)) setIn(next, r.note, r.plantId, r);
  // Not moved yet: shown from where they still are.
  if (!moved) for (const r of legacy) if (!next.get(r.note)?.has(r.plantId)) setIn(next, r.note, r.plantId, r);
  cache = next;
  loaded = true;
  changed();
}

// Another tab wrote a text: read them all again.
subscribe('notes', () => { loadNotes().catch(error => console.error(error)); });

/** @param {string} note a note block's id @param {number} plantId */
export const noteText = (note, plantId) => cache.get(note)?.get(plantId)?.text || '';

/**
 * Writes (or, empty, deletes) a text. Shown at once; resolves with whether it is stored — false when the
 * database refused it (storage full: said once, on screen).
 * @param {string} note @param {number} plantId @param {string} text @returns {Promise<boolean>}
 */
export async function setNoteText(note, plantId, text) {
  const key = keyOf(note, plantId);
  const record = text.trim() ? { key, note, plantId, text, updatedAt: new Date().toISOString() } : null;
  setIn(cache, note, plantId, record);
  changed();
  try {
    if (record) await db.put(STORE, record); else await db.remove(STORE, key);
    publish('notes');
    return true;
  } catch (error) {
    noteStorageError(error);
    console.error(error);
    return false;
  }
}

/** Every text of a note block deleted (the block is). @param {string} note */
export async function deleteNoteTexts(note) {
  cache.delete(note);
  changed();
  const keys = (await db.getAll(STORE)).filter(r => r?.note === note).map(r => r.key);
  if (keys.length) await db.updateMany(STORE, keys, () => db.DELETE);
  publish('notes');
}

/** The note blocks that hold a text. */
export const notesWithText = () => [...cache.keys()];

/**
 * The texts in their portable form (GeoJSON export, backup copy, transfer link): one item per note block, its
 * title with it (so the block can be made again where it is missing).
 * @param {{ id: string, title: string }[]} blocks the note blocks of the layout
 * @returns {{ id: string, title: string, texts: Record<string, { text: string, updatedAt: string }> }[]}
 */
export function portableNotes(blocks) {
  return [...cache].map(([id, byPlant]) => ({
    id,
    title: blocks.find(b => b.id === id)?.title || 'Note',
    texts: Object.fromEntries([...byPlant].map(([plantId, r]) => [plantId, { text: r.text, updatedAt: r.updatedAt }]))
  }));
}

/**
 * Texts from elsewhere merged into these, each one atomically: a text this device does not have is added; one it
 * has is replaced only by a newer one (`updatedAt`; `keepMine`: never). Nothing is deleted.
 * @param {NoteText[]} incoming @param {{ keepMine?: boolean }} [options] @returns {Promise<number>} how many were written
 */
export async function mergeNoteTexts(incoming, { keepMine = false } = {}) {
  const valid = incoming.filter(isRecord).map(r => ({ ...r, key: keyOf(r.note, r.plantId) }));
  if (!valid.length) return 0;
  const byKey = new Map(valid.map(r => [r.key, r]));
  const results = await db.updateMany(STORE, [...byKey.keys()], (current, key) => {
    const r = /** @type {NoteText} */ (byKey.get(/** @type {string} */ (key)));
    if (current?.text === r.text) return undefined;
    if (current && isRecord(current) && (keepMine || current.updatedAt >= r.updatedAt)) return undefined;
    return r;
  });
  const written = results.filter(Boolean).length;
  if (written) {
    await loadNotes();
    publish('notes');
  }
  return written;
}

/**
 * Portable notes (see portableNotes) as records, the ones that make sense only.
 * @param {any} list @returns {NoteText[]}
 */
export function fromPortable(list) {
  if (!Array.isArray(list)) return [];
  /** @type {NoteText[]} */
  const out = [];
  for (const block of list) {
    if (typeof block?.id !== 'string' || !/^[a-z0-9]{1,24}$/.test(block.id) || !block.texts || typeof block.texts !== 'object') continue;
    for (const [plant, t] of Object.entries(block.texts)) {
      const plantId = Number(plant);
      const text = typeof t === 'string' ? t : t?.text;
      if (!Number.isInteger(plantId) || typeof text !== 'string' || !text.trim()) continue;
      const updatedAt = typeof t?.updatedAt === 'string' ? t.updatedAt : '';
      out.push({ key: keyOf(block.id, plantId), note: block.id, plantId, text: text.slice(0, 20000), updatedAt });
    }
  }
  return out;
}
