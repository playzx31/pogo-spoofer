import { useEffect, useRef } from "react";

import { useLocationStore } from "../state/locationStore";
import { MovementEngine } from "./MovementEngine";
import type { CompassDirection } from "./directions";

/**
 * Creates a single `MovementEngine` for the lifetime of the component tree
 * and wires its output into the location store (which forwards each tick to
 * the active `LocationProvider` and the map).
 */
export function useMovementEngine(speedKmh: number) {
  const engineRef = useRef<MovementEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new MovementEngine(
      () => useLocationStore.getState().current,
      (position, heading, speed, deltaKm) => {
        useLocationStore.getState().applyMovementTick(position, heading, speed, deltaKm);
      },
      speedKmh,
    );
  }

  useEffect(() => {
    engineRef.current?.setSpeed(speedKmh);
  }, [speedKmh]);

  useEffect(() => {
    return () => engineRef.current?.stop();
  }, []);

  const start = (direction: CompassDirection) => {
    useLocationStore.getState().setMovementActive(true);
    engineRef.current?.start(direction);
  };

  const stop = () => {
    engineRef.current?.stop();
    useLocationStore.getState().setMovementActive(false);
  };

  return { start, stop };
}
