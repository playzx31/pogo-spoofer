import { useEffect, useRef } from "react";

import { useLocationStore } from "../state/locationStore";
import { useLogStore } from "../state/logStore";
import { toFriendlyError } from "../lib/errors";
import { MovementEngine } from "./MovementEngine";
import type { CompassDirection } from "./directions";

/**
 * Creates a single `MovementEngine` for the lifetime of the component tree
 * and wires its output into the location store (which forwards each tick to
 * the active `LocationProvider` and the map). If a tick's location update
 * actually fails (e.g. the real device rejects it), movement stops and the
 * failure is logged instead of continuing to retry on a timer.
 */
export function useMovementEngine(speedKmh: number) {
  const engineRef = useRef<MovementEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new MovementEngine(
      () => useLocationStore.getState().current,
      async (position, heading, speed, deltaKm) => {
        try {
          await useLocationStore.getState().applyMovementTick(position, heading, speed, deltaKm);
          return true;
        } catch (error) {
          const friendly = toFriendlyError(error);
          useLogStore.getState().log("error", "Movement stopped: location update failed", friendly.message);
          useLocationStore.getState().setMovementActive(false);
          return false;
        }
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
