// A seeded pseudo-random generator for the property tests: the same seed, the same runs (a failure replays).
/** @param {number} seed @returns {(n: number) => number} an integer in [0, n) */
export function random(seed) {
  let s = seed >>> 0 || 1;
  return n => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s % n;
  };
}
