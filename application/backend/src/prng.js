/**
 * Deterministic PRNG (mulberry32).
 *
 * Given the same integer seed, produces the exact same sequence of pseudo-
 * random numbers every time, on any machine. This is what lets CloudPort
 * guarantee that the SAME workload (same seed) runs under Infrastructure A
 * and Infrastructure B -- any observed difference is not due to randomness.
 */
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { mulberry32 };
