import { destinationPoint, type Coordinates } from "../lib/geo";
import { HEADING_DEGREES, type CompassDirection } from "./directions";

export type MovementTickHandler = (
  position: Coordinates,
  headingDeg: number,
  speedKmh: number,
  deltaKm: number,
) => void;

const TICK_MS = 200;

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
 */
export class MovementEngine {
  private timerId: ReturnType<typeof setInterval> | null = null;
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
    return this.timerId !== null;
  }

  start(direction: CompassDirection) {
    this.direction = direction;
    if (this.timerId !== null) return;
    this.timerId = setInterval(() => this.tick(), TICK_MS);
    // Fire the first tick immediately so a tap registers movement without
    // waiting a full interval.
    this.tick();
  }

  stop() {
    this.direction = null;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick() {
    if (!this.direction) return;
    const bearing = HEADING_DEGREES[this.direction];
    const distanceKm = this.speedKmh * (TICK_MS / 3_600_000);
    const next = destinationPoint(this.getPosition(), bearing, distanceKm);
    this.onTick(next, bearing, this.speedKmh, distanceKm);
  }
}
