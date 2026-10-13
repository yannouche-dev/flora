// The dataset as last committed: what an enrichment keeps when its source fails, and what check-data.mjs compares
// a new build with. build-plants.mjs rewrites data/plants.json and data/meta.json from TAXREF alone, so the previous
// files are read from git, not from the working tree:
//   PREVIOUS_DATA_DIR   a folder holding the previous files by name (plants.json, meta.json…), e.g. fixtures;
//   DATA_BASELINE       the git revision to read them from (default HEAD; « none »: no previous data).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Where the previous files come from, for the logs. */
export const baselineName = () => process.env.PREVIOUS_DATA_DIR || (process.env.DATA_BASELINE || 'HEAD') + ' (git)';

/**
 * The previous version of a data file, parsed, or null when there is none (no git, a new file, baseline « none »).
 * @param {string} path the file's path in the repository, e.g. data/plants.json
 */
export function previousJson(path) {
  try {
    if (process.env.PREVIOUS_DATA_DIR) return JSON.parse(readFileSync(join(process.env.PREVIOUS_DATA_DIR, basename(path)), 'utf8'));
    const rev = process.env.DATA_BASELINE || 'HEAD';
    if (rev === 'none') return null;
    return JSON.parse(execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; }
}

/**
 * Copies one enrichment field (statuses, flowering) from the previous plants onto the new ones, by TAXREF id, when
 * its source could not be read: a passing outage keeps the last good data instead of shipping the flora without it.
 * Returns how many plants got it back, or -1 when there is no previous file.
 * @param {any[]} plants the new plants, changed in place
 * @param {string} field
 * @param {string} plantsPath the plants file's path in the repository
 */
export function keepPrevious(plants, field, plantsPath) {
  const previous = previousJson(plantsPath);
  if (!Array.isArray(previous)) return -1;
  const byId = new Map(previous.filter(p => p?.[field] != null).map(p => [p.id, p[field]]));
  let kept = 0;
  for (const plant of plants) {
    if (byId.has(plant.id)) { plant[field] = byId.get(plant.id); kept++; }
    else delete plant[field];
  }
  return kept;
}
