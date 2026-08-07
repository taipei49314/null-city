import { describe, expect, it } from "vitest";
import { SimulationClock } from "../src/index.js";

describe("SimulationClock", () => {
  it("starts at tick 0", () => {
    const clock = new SimulationClock(540);
    expect(clock.tick()).toBe(0);
  });

  it("advances one tick at a time", () => {
    const clock = new SimulationClock(540);
    expect(clock.advance()).toBe(1);
    expect(clock.advance()).toBe(2);
    expect(clock.tick()).toBe(2);
  });

  it("is not complete before totalTicks and complete after", () => {
    const clock = new SimulationClock(3);
    expect(clock.isComplete()).toBe(false);
    clock.advance();
    clock.advance();
    clock.advance();
    expect(clock.tick()).toBe(3);
    expect(clock.isComplete()).toBe(true);
  });

  it("rejects invalid totalTicks", () => {
    expect(() => new SimulationClock(0)).toThrow();
    expect(() => new SimulationClock(-1)).toThrow();
  });

  it("forceTick restores a previous position for snapshot resume", () => {
    const clock = new SimulationClock(540);
    clock.forceTick(200);
    expect(clock.tick()).toBe(200);
    clock.advance();
    expect(clock.tick()).toBe(201);
  });

  it("forceTick rejects out-of-range values", () => {
    const clock = new SimulationClock(540);
    expect(() => clock.forceTick(-1)).toThrow();
    expect(() => clock.forceTick(541)).toThrow();
  });
});