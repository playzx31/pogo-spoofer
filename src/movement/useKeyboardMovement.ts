import { useEffect, useRef } from "react";

import { directionFromKeys, type CompassDirection } from "./directions";

interface KeyboardMovementHandlers {
  start: (direction: CompassDirection) => void;
  stop: () => void;
  enabled: boolean;
}

type MovementKey = "w" | "a" | "s" | "d";

function toMovementKey(raw: string): MovementKey | null {
  return raw === "w" || raw === "a" || raw === "s" || raw === "d" ? raw : null;
}

/**
 * W / A / S / D -> 8-direction movement, including diagonals (W+D, W+A,
 * S+D, S+A). Disabled automatically while the user is typing into a text
 * input so movement keys don't fire while, say, entering coordinates.
 */
export function useKeyboardMovement({ start, stop, enabled }: KeyboardMovementHandlers) {
  const pressed = useRef({ w: false, a: false, s: false, d: false });

  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    const update = () => {
      const { w, a, s, d } = pressed.current;
      const direction = directionFromKeys(w, s, d, a);
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
      stop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stop();
    };
  }, [start, stop, enabled]);
}
