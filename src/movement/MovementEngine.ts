import { destinationPoint, type Coordinates } from "../lib/geo";
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

const TICK_MS = 300;

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
 * order.
 */
export class MovementEngine {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private direction: CompassDirection | null = null;
  private speedKmh: number;

  constructor(
    private readonly getPosition: () => Coordinates,
    private readonly onTick: MovementTickHandler,
    initialSpeedKmh: number,
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
    this.scheduleTick(0);
  }

  stop() {
    this.direction = null;
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

  private async runTick() {
    if (!this.direction || this.ticking) return;
    this.ticking = true;

    const bearing = HEADING_DEGREES[this.direction];
    const distanceKm = this.speedKmh * (TICK_MS / 3_600_000);
    const next = destinationPoint(this.getPosition(), bearing, distanceKm);

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
      this.scheduleTick(TICK_MS);
    } else {
      this.direction = null;
    }
  }
}
