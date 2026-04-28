/**
 * Deterministic seeded RNG for tests. Mulberry32 is fast, small, and
 * suitable for test reproducibility (NOT cryptographically secure).
 *
 * Returns an object with .random() and .randrange(n) matching the API
 * the resolver uses, so the same code shape works in both Python (using
 * stdlib random.Random) and TS (using this helper) tests.
 */
export interface SeededRng {
  random(): number;
  randrange(n: number): number;
}

export function mulberry32(seed: number): SeededRng {
  let s = seed | 0;
  return {
    random(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    randrange(n: number): number {
      return Math.floor(this.random() * n);
    },
  };
}
