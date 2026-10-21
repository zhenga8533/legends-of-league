/**
 * Seeded pseudo-random numbers (xoshiro128**). Every simulation takes an Rng instead of using
 * Math.random, so the same seed always reproduces the same tournament.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Returns a shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

function hashSeed(seed: string | number): number {
  // FNV-1a over the seed's string form, so "2024" and 2024 seed identically.
  let hash = 0x811c9dc5;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitmix32(state: number): () => number {
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: string | number): Rng {
  const init = splitmix32(hashSeed(seed));
  let a = init();
  let b = init();
  let c = init();
  let d = init();

  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result;
  };

  const rng: Rng = {
    next: () => nextUint32() / 2 ** 32,
    int: (n) => Math.floor(rng.next() * n),
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [copy[i], copy[j]] = [copy[j] as (typeof copy)[number], copy[i] as (typeof copy)[number]];
      }
      return copy;
    },
  };
  return rng;
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
