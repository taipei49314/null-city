/**
 * Deterministic Seeded PRNG (mulberry32).
 *
 * The simulation may never call a non-deterministic RNG. Every random draw
 * goes through this class, whose state is part of the snapshot so that
 * resume-from-snapshot stays bit-identical to uninterrupted execution.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // normalize into a valid 32-bit unsigned state; zero maps to a non-zero constant
    let s = seed | 0;
    if (s === 0) {
      s = 0x9e3779b9;
    }
    this.state = s >>> 0;
  }

  static fromState(state: number): SeededRandom {
    const rng = new SeededRandom(1);
    rng.state = state >>> 0;
    return rng;
  }

  /** returns a float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return t / 4294967296;
  }

  /** returns an integer in [min, max] inclusive */
  int(min: number, max: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** returns true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** pick a random element */
  pick<T>(items: readonly T[]): T {
    const index = Math.floor(this.next() * items.length);
    return items[index] as T;
  }

  sampleState(): number {
    return this.state;
  }
}