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

  it("refuses to tick from an invalid (NaN) current position, without calling onTick", async () => {
    const onTick = vi.fn().mockReturnValue(true);
    const onSafetyStop = vi.fn();
    const engine = new MovementEngine(() => ({ latitude: NaN, longitude: 0 }), onTick, 5, onSafetyStop);

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);

    expect(onTick).not.toHaveBeenCalled();
    expect(onSafetyStop).toHaveBeenCalledWith(expect.stringContaining("position"));
    expect(engine.isMoving).toBe(false);

    // And it does not keep retrying on its own.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("refuses to tick from an out-of-range latitude", async () => {
    const onTick = vi.fn().mockReturnValue(true);
    const onSafetyStop = vi.fn();
    const engine = new MovementEngine(() => ({ latitude: 123, longitude: 0 }), onTick, 5, onSafetyStop);

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);

    expect(onTick).not.toHaveBeenCalled();
    expect(onSafetyStop).toHaveBeenCalled();
    expect(engine.isMoving).toBe(false);
  });

  it("refuses to tick with a negative or non-finite speed", async () => {
    const onTick = vi.fn().mockReturnValue(true);
    const onSafetyStop = vi.fn();
    const engine = new MovementEngine(() => ({ latitude: 0, longitude: 0 }), onTick, NaN, onSafetyStop);

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);

    expect(onTick).not.toHaveBeenCalled();
    expect(onSafetyStop).toHaveBeenCalledWith(expect.stringContaining("speed"));
    expect(engine.isMoving).toBe(false);
  });

  it("refuses to tick when the configured speed would produce a giant, teleport-sized jump", async () => {
    const onTick = vi.fn().mockReturnValue(true);
    const onSafetyStop = vi.fn();
    // An absurd/corrupted speed value (e.g. bad persisted settings). The
    // first tick has ~0 elapsed time (fires immediately on start) so it's
    // harmless; the second tick, ~300ms of real elapsed time later, is
    // where an absurd speed turns into an unsafe distance.
    const engine = new MovementEngine(() => ({ latitude: 0, longitude: 0 }), onTick, 1_000_000_000, onSafetyStop);

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    expect(onTick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(onTick).toHaveBeenCalledTimes(1); // no second call - aborted before reaching onTick
    expect(onSafetyStop).toHaveBeenCalledWith(expect.stringContaining("unsafe"));
    expect(engine.isMoving).toBe(false);
  });

  it("refuses to tick if the system clock moves backward between ticks", async () => {
    const onTick = vi.fn().mockReturnValue(true);
    const onSafetyStop = vi.fn();
    const engine = new MovementEngine(() => ({ latitude: 0, longitude: 0 }), onTick, 5, onSafetyStop);

    const dateNowSpy = vi.spyOn(Date, "now");
    let now = 1_000_000;
    dateNowSpy.mockImplementation(() => now);

    engine.start("N");
    now += 100;
    await vi.advanceTimersByTimeAsync(0);
    expect(onTick).toHaveBeenCalledTimes(1);

    now -= 5_000; // system clock jumped backward
    await vi.advanceTimersByTimeAsync(300);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onSafetyStop).toHaveBeenCalledWith(expect.stringContaining("elapsed"));
    expect(engine.isMoving).toBe(false);

    dateNowSpy.mockRestore();
  });

  it("always reads the live current position at tick time rather than a cached start position (no resume-from-old-position bug)", async () => {
    let position = { latitude: 0, longitude: 0 };
    const seenLatitudes: number[] = [];
    const engine = new MovementEngine(
      () => position,
      (next) => {
        seenLatitudes.push(position.latitude);
        position = next;
        return true;
      },
      5,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);

    // Something external (a teleport, a manual "Set Test Location") jumps
    // the tracked position far away, between ticks.
    position = { latitude: 50, longitude: 50 };

    await vi.advanceTimersByTimeAsync(300);
    engine.stop();

    expect(seenLatitudes[0]).toBeCloseTo(0, 6);
    // The second tick must have continued from the externally-updated
    // position, not from a value cached back when movement started.
    expect(seenLatitudes[1]).toBeCloseTo(50, 6);
  });

  it("computes each tick's distance from real elapsed time, not an assumed fixed interval", async () => {
    // A slow USB round trip (or any other delay) between when one
    // coordinate is generated and the next tick fires must not distort the
    // configured speed - the distance sent has to reflect how much time
    // actually passed, not the nominal ~300ms pacing interval.
    const dateNowSpy = vi.spyOn(Date, "now");
    let now = 0;
    dateNowSpy.mockImplementation(() => now);

    const destinations: { latitude: number; longitude: number }[] = [];
    let position = { latitude: 0, longitude: 0 };
    const engine = new MovementEngine(
      () => position,
      (next) => {
        destinations.push(next);
        position = next;
        return true;
      },
      36, // 36 km/h
    );

    engine.start("N"); // lastTickAt = 0
    await vi.advanceTimersByTimeAsync(0); // tick 1: ~0ms elapsed -> ~0 distance
    expect(destinations[0].latitude).toBeCloseTo(0, 9);

    now = 1000; // simulate a slow ~1000ms round trip before tick 2 executes
    await vi.advanceTimersByTimeAsync(300); // scheduled 300ms later regardless
    const earthRadiusKm = 6371.0088;
    const expectedDistanceKm = 36 * (1000 / 3_600_000); // 0.01 km
    const expectedDegrees = (expectedDistanceKm / earthRadiusKm) * (180 / Math.PI);
    expect(destinations[1].latitude).toBeCloseTo(expectedDegrees, 6);

    engine.stop();
    dateNowSpy.mockRestore();
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
