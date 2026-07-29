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
    // An absurd/corrupted speed value (e.g. bad persisted settings) - at any
    // sane walking/running/cycling speed a single 300ms tick moves a few
    // meters at most, nowhere near the MAX_TICK_DISTANCE_KM backstop.
    const engine = new MovementEngine(() => ({ latitude: 0, longitude: 0 }), onTick, 1_000_000_000, onSafetyStop);

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);

    expect(onTick).not.toHaveBeenCalled();
    expect(onSafetyStop).toHaveBeenCalledWith(expect.stringContaining("unsafe"));
    expect(engine.isMoving).toBe(false);
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

  it("moves the same distance per tick even if the system clock jumps between ticks (no delta-time-based jump)", async () => {
    // The engine must derive each tick's distance purely from the
    // configured speed and its fixed tick interval - never from measuring
    // real elapsed time - so a system clock jump (sleep/resume, NTP
    // correction) can never turn into an oversized or negative step. This
    // is a regression guard: it mocks Date.now() to jump wildly between
    // calls and asserts the tick distance is completely unaffected, which
    // would only fail if delta-time-based math were introduced later.
    const dateNowSpy = vi.spyOn(Date, "now");
    let call = 0;
    dateNowSpy.mockImplementation(() => {
      call += 1;
      // Wildly different "elapsed time" on every read.
      return call % 2 === 0 ? 0 : 10_000_000;
    });

    const destinations: { latitude: number; longitude: number }[] = [];
    let position = { latitude: 0, longitude: 0 };
    const engine = new MovementEngine(
      () => position,
      (next) => {
        destinations.push(next);
        position = next;
        return true;
      },
      36,
    );

    engine.start("N");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    engine.stop();
    dateNowSpy.mockRestore();

    const firstStep = destinations[1].latitude - destinations[0].latitude;
    const secondStep = destinations[2].latitude - destinations[0].latitude - firstStep;
    expect(firstStep).toBeCloseTo(secondStep, 12);
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
