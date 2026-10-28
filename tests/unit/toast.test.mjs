// The app's one toast place (app/core/toast.js takeToastSlot): a weightier toast keeps it, an equal or lighter one is
// let go for the newcomer; `free` is said once when the place is given back — never while it changes hands — for the
// announcement of the tabs that came (gf-app), which waits for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeToastSlot, toastEvents, toastSlotFree } from '../../app/core/toast.js';

/** How many times the place is said free while `work` runs. @param {() => void} work */
function frees(work) {
  let n = 0;
  const on = () => n++;
  toastEvents.addEventListener('free', on);
  try { work(); } finally { toastEvents.removeEventListener('free', on); }
  return n;
}

test('la place libre, prise, rendue : dite libre une fois', () => {
  assert.equal(toastSlotFree(), true);
  const give = /** @type {() => void} */ (takeToastSlot(() => {}, 1));
  assert.equal(toastSlotFree(), false);
  assert.equal(frees(give), 1);
  assert.equal(toastSlotFree(), true);
  // Given back already: nothing more.
  assert.equal(frees(give), 0);
});

test('un message plus lourd garde la place ; un autre la prend sans qu’elle soit libre entre-temps', () => {
  /** @type {string[]} */ const hidden = [];
  /** @type {(() => void) | null} */ let giveWord = null;
  /** @type {(() => void) | null} */ let giveWarning = null;
  // A word shown: its hide gives the place back, as a brief toast's does.
  const word = () => { hidden.push('word'); giveWord?.(); };
  giveWord = takeToastSlot(word, 1);
  // A safety warning takes it: the word let go, the place never free meanwhile.
  assert.equal(frees(() => { giveWarning = takeToastSlot(() => hidden.push('warning'), 3); }), 0);
  assert.deepEqual(hidden, ['word']);
  assert.equal(toastSlotFree(), false);
  // A word does not take a warning's place.
  assert.equal(takeToastSlot(() => hidden.push('other'), 1), null);
  assert.deepEqual(hidden, ['word']);
  // The warning gone: free.
  assert.equal(frees(/** @type {() => void} */ (giveWarning)), 1);
  assert.equal(toastSlotFree(), true);
});
