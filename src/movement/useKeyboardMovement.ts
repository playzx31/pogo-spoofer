import { useEffect, useRef, useState } from "react";

import { decomposeDirection, directionFromKeys, type CompassDirection } from "./directions";

interface KeyboardMovementHandlers {
  start: (direction: CompassDirection) => void;
  stop: () => void;
  enabled: boolean;
}

type MovementKey = "w" | "a" | "s" | "d";

const EMPTY_DIRECTIONS: ReadonlySet<CompassDirection> = new Set();

function toMovementKey(raw: string): MovementKey | null {
  return raw === "w" || raw === "a" || raw === "s" || raw === "d" ? raw : null;
}

/**
 * W / A / S / D -> 8-direction movement, including diagonals (W+D, W+A,
 * S+D, S+A). Disabled automatically while the user is typing into a text
 * input so movement keys don't fire while, say, entering coordinates.
 *
 * `heldDirections` reflects which cardinal directions are *currently
 * pressed*, updated synchronously on every keydown/keyup - it must not wait
 * on `start`/`stop` actually reaching the device, since those go through an
 * async USB round trip and gating the visual highlight on that made the
 * on-screen buttons lag or never light up while held.
 */
export function useKeyboardMovement({ start, stop, enabled }: KeyboardMovementHandlers) {
  const pressed = useRef({ w: false, a: false, s: false, d: false });
  const [heldDirections, setHeldDirections] = useState<ReadonlySet<CompassDirection>>(EMPTY_DIRECTIONS);

  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    const update = () => {
      const { w, a, s, d } = pressed.current;
      const direction = directionFromKeys(w, s, d, a);
      setHeldDirections(new Set(decomposeDirection(direction)));
      if (direction) start(direction);
      else stop();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = toMovementKey(e.key.toLowerCase());
      if (!key) return;
      e.preventDefault();
      pressed.current[key] = true;
      update();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = toMovementKey(e.key.toLowerCase());
      if (!key) return;
      pressed.current[key] = false;
      update();
    };

    const onBlur = () => {
      pressed.current = { w: false, a: false, s: false, d: false };
      setHeldDirections(EMPTY_DIRECTIONS);
      stop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      pressed.current = { w: false, a: false, s: false, d: false };
      setHeldDirections(EMPTY_DIRECTIONS);
      stop();
    };
  }, [start, stop, enabled]);

  return { heldDirections };
}
