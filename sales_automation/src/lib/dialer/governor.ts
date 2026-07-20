/**
 * Concurrency governor (spec §2 + abandonment constraint).
 *
 * Enforces the hard rule: never have more live-human connections pending than
 * free reps. Concurrent dials are capped at `freeReps * OVERDIAL_RATIO`. Starts
 * at ratio 1.0 (no overdial) and can be auto-tightened by the abandonment
 * tracker.
 *
 * This in-memory implementation is correct for a single orchestrator process.
 * Production swaps in BullMQ + Redis (shared counters across workers) behind the
 * same interface — the decision logic is identical.
 */

export interface Governor {
  /** How many *new* dials may be released right now. */
  releasableSlots(): number;
  /** Mark a dial as started (occupies a slot until it ends). */
  onDialStarted(): void;
  /** Mark a dial as finished (frees its slot). */
  onDialEnded(): void;
  /** Update the current free-rep count. */
  setFreeReps(n: number): void;
  /** Update the overdial ratio (abandonment tracker tightens this). */
  setOverdialRatio(r: number): void;
  snapshot(): {
    freeReps: number;
    overdialRatio: number;
    activeDials: number;
    cap: number;
  };
}

export class InMemoryGovernor implements Governor {
  private freeReps = 0;
  private overdialRatio: number;
  private activeDials = 0;

  constructor(overdialRatio = 1.0) {
    this.overdialRatio = overdialRatio;
  }

  private cap(): number {
    return Math.floor(this.freeReps * this.overdialRatio);
  }

  releasableSlots(): number {
    // Backpressure: if reps are full, cap is 0 and nothing releases.
    return Math.max(0, this.cap() - this.activeDials);
  }

  onDialStarted(): void {
    this.activeDials++;
  }

  onDialEnded(): void {
    this.activeDials = Math.max(0, this.activeDials - 1);
  }

  setFreeReps(n: number): void {
    this.freeReps = Math.max(0, n);
  }

  setOverdialRatio(r: number): void {
    this.overdialRatio = Math.max(0, r);
  }

  snapshot() {
    return {
      freeReps: this.freeReps,
      overdialRatio: this.overdialRatio,
      activeDials: this.activeDials,
      cap: this.cap(),
    };
  }
}
