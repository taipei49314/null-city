import {
  playerEventHash,
  type PlayerEventEnvelope,
  type PlayerEventKind,
} from "@null-city/contracts";

/** Append-only public player event store with its own hash chain. */
export class PlayerEventStore {
  private events: PlayerEventEnvelope[] = [];
  private sequence = 0;

  get log(): readonly PlayerEventEnvelope[] {
    return this.events;
  }

  get length(): number {
    return this.events.length;
  }

  get tipHash(): string {
    if (this.events.length === 0) {
      return "";
    }
    return this.events[this.events.length - 1]!.hash;
  }

  since(sequence: number): PlayerEventEnvelope[] {
    return this.events.filter((event) => event.sequence >= sequence).map((event) => structuredClone(event));
  }

  append(sessionId: string, tick: number, kind: PlayerEventKind, payload: unknown): PlayerEventEnvelope {
    const previousHash = this.tipHash;
    const envelope: PlayerEventEnvelope = {
      stream: "player",
      sessionId,
      sequence: this.sequence,
      tick,
      kind,
      payload: structuredClone(payload),
      previousHash,
      hash: "",
    };
    envelope.hash = playerEventHash(envelope);
    this.sequence += 1;
    this.events.push(envelope);
    return envelope;
  }

  /** Replace store from a detached clone (tests / resume of public projection). */
  replace(events: readonly PlayerEventEnvelope[]): void {
    this.events = structuredClone(events) as PlayerEventEnvelope[];
    this.sequence = this.events.length;
  }
}
