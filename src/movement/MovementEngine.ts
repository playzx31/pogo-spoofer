import { destinationPoint, isValidCoordinate, type Coordinates } from "../lib/geo";
import { HEADING_DEGREES, type CompassDirection } from "./directions";

/**
 * Called once per movement tick. Return (or resolve to) `false` to stop the
 * engine - used when the tick's location update actually failed (e.g. the
 * real device rejected it), so a failure never gets silently ignored while
 * ticks keep firing on a timer regardless.
 */
export type MovementTickHandler = (
  position: Coordinates,
  headingDeg: number,
  speedKmh: number,
  deltaKm: number,
) => Promise<boolean | void> | boolean | void;

/**
 * Target pacing between the end of one tick and the start of the next -
 * purely a rate limit ("don't flood the device"), not the basis for the
 * distance math. `runTick` measures real elapsed time instead of assuming
 * this interval happened exactly, since the real `LocationProvider` does a
 * USB round trip per call that can run faster or slower than this.
 */
const TICK_INTERVAL_MS = 300;

/**
 * Absolute backstop on how far a single tick may move, independent of the
 * configured speed or how much real time elapsed. Real per-tick distances at
 * any sane walking/running/cycling/custom speed, even accounting for a slow
 * multi-second USB round trip, are a small fraction of this; it exists to
 * catch a corrupted speed value or a very long stall (e.g. the app was
 * suspended) before it turns into a teleport-sized jump sent to a real
 * device instead of a smooth step.
 */
const MAX_TICK_DISTANCE_KM = 1;

/**
 * Pure, UI-agnostic engine that turns "a direction is being held at a given
 * speed" into a stream of new coordinates:
 *
 *   Joystick / keyboard -> MovementEngine -> geo.destinationPoint -> onTick
 *
 * It never touches the DOM or React state directly; callers (the joystick
 * component, the keyboard hook) supply a position getter and a tick
 * callback, which is typically wired to `useLocationStore.applyMovementTick`
 * and, from there, to the active `LocationProvider`.
 *
 * Ticks are self-scheduled (each one waits for the previous `onTick` to
 * settle before scheduling the next), not a fixed `setInterval` - the real
 * `LocationProvider` does a USB round trip per call, which can take longer
 * than the tick interval, and firing the next request before the last one
 * finished would both flood the device and risk answers arriving out of
 * order. The distance for each tick is computed from the *real* elapsed
 * time since the previous one (not an assumed fixed interval), so a slow
 * round trip doesn't distort the effective speed - see `runTick`.
 */
export class MovementEngine {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private direction: CompassDirection | null = null;
  private speedKmh: number;
  /** Timestamp (`Date.now()`) the last tick's distance was measured from, or `null` when idle. */
  private lastTickAt: number | null = null;

  constructor(
    private readonly getPosition: () => Coordinates,
    private readonly onTick: MovementTickHandler,
    initialSpeedKmh: number,
    /**
     * Called instead of `onTick` when the engine refuses to compute a tick
     * because its inputs are unsafe to move from (an invalid current
     * position, an invalid speed, an invalid elapsed time, or a computed
     * destination/distance that doesn't check out) - i.e. "movement state
     * is unknown, so stop instead of guessing" rather than sending a real
     * device a garbage or teleport-sized coordinate. The engine always
     * stops immediately after calling this; it never retries automatically.
     */
    private readonly onSafetyStop?: (reason: string) => void,
  ) {
    this.speedKmh = initialSpeedKmh;
  }

  setSpeed(kmh: number) {
    this.speedKmh = kmh;
  }

  get isMoving(): boolean {
    return this.direction !== null;
  }

  start(direction: CompassDirection) {
    const alreadyRunning = this.direction !== null;
    this.direction = direction;
    if (alreadyRunning) return; // just changed direction mid-hold
    this.lastTickAt = Date.now();
    this.scheduleTick(0);
  }

  stop() {
    this.direction = null;
    this.lastTickAt = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private scheduleTick(delayMs: number) {
    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.runTick();
    }, delayMs);
  }

  /**
   * Stops the engine without ever calling `onTick`, reporting why via
   * `onSafetyStop`. Used when the inputs to a tick can't be trusted - an
   * unknown/invalid position, speed, elapsed time, or destination is a
   * reason to halt, not a value to send to a real device and hope for the
   * best.
   */
  private abortTick(reason: string) {
    this.direction = null;
    this.ticking = false;
    this.lastTickAt = null;
    this.onSafetyStop?.(reason);
  }

  private async runTick() {
    if (!this.direction || this.ticking) return;
    this.ticking = true;

    const now = Date.now();
    const elapsedMs = now - (this.lastTickAt ?? now);

    const position = this.getPosition();
    if (!isValidCoordinate(position)) {
      this.abortTick(`current position is invalid (${position.latitude}, ${position.longitude})`);
      return;
    }

    if (!Number.isFinite(this.speedKmh) || this.speedKmh < 0) {
      this.abortTick(`speed is invalid (${this.speedKmh} km/h)`);
      return;
    }

    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      // A negative reading means the system clock moved backward between
      // ticks (NTP correction, manual clock change) - trusting it would
      // either compute a negative distance or silently do nothing forever;
      // stopping and surfacing it is safer than guessing which.
      this.abortTick(`elapsed time since the last tick is invalid (${elapsedMs}ms)`);
      return;
    }

    const bearing = HEADING_DEGREES[this.direction];
    const distanceKm = this.speedKmh * (elapsedMs / 3_600_000);
    if (!Number.isFinite(distanceKm) || distanceKm > MAX_TICK_DISTANCE_KM) {
      this.abortTick(`computed tick distance is unsafe (${distanceKm} km over ${elapsedMs}ms at ${this.speedKmh} km/h)`);
      return;
    }

    const next = destinationPoint(position, bearing, distanceKm);
    if (!isValidCoordinate(next)) {
      this.abortTick(`computed destination is invalid (${next.latitude}, ${next.longitude})`);
      return;
    }

    // Recorded now (before the tick is sent) so the *next* tick's elapsed
    // time is measured from this coordinate's generation, not from whenever
    // the device happens to acknowledge it.
    this.lastTickAt = now;

    let shouldContinue = true;
    try {
      shouldContinue = (await this.onTick(next, bearing, this.speedKmh, distanceKm)) !== false;
    } catch {
      // The handler is responsible for logging/surfacing the failure - the
      // engine's only job on error is to stop cleanly.
      shouldContinue = false;
    }

    this.ticking = false;
    if (shouldContinue && this.direction) {
      this.scheduleTick(TICK_INTERVAL_MS);
    } else {
      this.direction = null;
      this.lastTickAt = null;
    }
  }
}
