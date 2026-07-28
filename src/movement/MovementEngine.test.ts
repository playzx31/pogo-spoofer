import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MovementEngine } from "./MovementEngine";

describe("MovementEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires an immediate tick on start, then paces subsequent ticks 300ms apart", async () => {
    let position = { latitude: 0, longitude: 0 };
    const ticks: number[] = [];
    const engine = new MovementEngine(
      () => position,
      (next) => {
        position = next;
        ticks.push(ticks.length);
        return true;
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks.length).toBe(1); // immediate first tick, no delay

    await vi.advanceTimersByTimeAsync(300);
    expect(ticks.length).toBe(2);

    await vi.advanceTimersByTimeAsync(300);
    expect(ticks.length).toBe(3);

    engine.stop();
  });

  it("never overlaps ticks: the next tick waits for the previous handler to resolve, however long it takes", async () => {
    const tickControl: { resolve: (() => void) | null } = { resolve: null };
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    const engine = new MovementEngine(
      () => ({ latitude: 0, longitude: 0 }),
      async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise<void>((resolve) => {
          tickControl.resolve = resolve;
        });
        concurrentCalls--;
        return true;
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0); // first tick starts and is now awaiting

    // Even if a lot of "wall clock" time passes while the handler is still
    // pending, no second tick should be scheduled/fired yet.
    await vi.advanceTimersByTimeAsync(5000);
    expect(concurrentCalls).toBe(1);
    expect(maxConcurrent).toBe(1);

    tickControl.resolve?.();
    await vi.advanceTimersByTimeAsync(0);

    engine.stop();
  });

  it("stops itself when a tick handler returns false, without scheduling another tick", async () => {
    let callCount = 0;
    const engine = new MovementEngine(
      () => ({ latitude: 0, longitude: 0 }),
      () => {
        callCount++;
        return false; // simulates a real device rejecting the location update
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);
    expect(engine.isMoving).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callCount).toBe(1); // no further ticks after the failure
  });

  it("stops itself when a tick handler throws", async () => {
    let callCount = 0;
    const engine = new MovementEngine(
      () => ({ latitude: 0, longitude: 0 }),
      () => {
        callCount++;
        throw new Error("device rejected location");
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);
    expect(engine.isMoving).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callCount).toBe(1);
  });

  it("stop() halts future ticks immediately", async () => {
    let callCount = 0;
    const engine = new MovementEngine(
      () => ({ latitude: 0, longitude: 0 }),
      () => {
        callCount++;
        return true;
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    engine.stop();
    expect(engine.isMoving).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callCount).toBe(1);
  });
});
