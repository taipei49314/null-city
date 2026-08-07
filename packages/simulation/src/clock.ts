/**
 * Discrete simulation clock.
 *
 * The engine advances in whole ticks. Real wall-clock time never enters the
 * simulation core; UI rendering speed and simulation speed are fully decoupled.
 */
export class SimulationClock {
  private current = 0;
  private total: number;

  constructor(totalTicks: number) {
    if (totalTicks <= 0) {
      throw new Error(`totalTicks must be positive, got ${totalTicks}`);
    }
    this.total = totalTicks;
  }

  tick(): number {
    return this.current;
  }

  get totalTicks(): number {
    return this.total;
  }

  isComplete(): boolean {
    return this.current >= this.total;
  }

  advance(): number {
    this.current += 1;
    return this.current;
  }

  /** restores the clock to a saved position (snapshot resume) */
  forceTick(tick: number): void {
    if (tick < 0 || tick > this.total) {
      throw new Error(`cannot force tick ${tick} outside [0, ${this.total}]`);
    }
    this.current = tick;
  }
}