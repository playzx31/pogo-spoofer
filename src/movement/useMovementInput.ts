import { useEffect, useRef, useState } from "react";

import { decomposeDirection, directionFromKeys, type CompassDirection } from "./directions";

interface MovementInputHandlers {
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
 * Owns every "is a movement input currently held" source - W/A/S/D keys and
 * the on-screen joystick pointer - in one place, so STOP (and losing window
 * focus/visibility) can reset all of it together, and so the keyboard and
 * joystick share the exact same engine calls rather than two parallel
 * implementations.
 *
 * `start`/`stop` are read through refs rather than closed over directly by
 * the window-level effect below. This matters: the caller (`MovementPanel`)
 * re-renders on every successful movement tick (it reads the live
 * position/heading from the store), which recreates `start`/`stop` as new
 * function identities every time. If the effect depended on them directly,
 * React would tear down and re-run it - removing and re-adding the window
 * listeners, and running its cleanup - on every single tick. That cleanup
 * used to call `stop()` and reset the held-key state unconditionally, which
 * is exactly why movement previously died after one tick and W/A/S/D never
 * reliably highlighted while held: the very act of moving successfully once
 * caused this hook to immediately stop itself. Reading `start`/`stop`
 * through refs lets the effect mount once and never depend on their
 * identity, while still always calling whatever the latest versions are.
 */
export function useMovementInput({ start, stop, enabled }: MovementInputHandlers) {
  const pressed = useRef({ w: false, a: false, s: false, d: false });
  const pointerDirectionRef = useRef<CompassDirection | null>(null);
  const [heldDirections, setHeldDirections] = useState<ReadonlySet<CompassDirection>>(EMPTY_DIRECTIONS);
  const [pointerDirection, setPointerDirection] = useState<CompassDirection | null>(null);

  const startRef = useRef(start);
  const stopRef = useRef(stop);
  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  }, [start, stop]);

  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    /** Recomputes the keyboard-held direction, falls back to the pointer's direction if no key is held, and drives the engine accordingly. */
    const applyActiveDirection = () => {
      const { w, a, s, d } = pressed.current;
      const keyboardDirection = directionFromKeys(w, s, d, a);
      setHeldDirections(new Set(decomposeDirection(keyboardDirection)));

      const direction = keyboardDirection ?? pointerDirectionRef.current;
      if (direction) startRef.current(direction);
      else stopRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = toMovementKey(e.key.toLowerCase());
      if (!key) return;
      e.preventDefault();
      // Browser key-repeat re-fires keydown continuously while a key is
      // held; the state is already correct from the first keydown, so
      // repeats are ignored rather than uselessly recomputed on every one.
      if (e.repeat) return;
      pressed.current[key] = true;
      applyActiveDirection();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = toMovementKey(e.key.toLowerCase());
      if (!key) return;
      pressed.current[key] = false;
      applyActiveDirection();
    };

    const resetAll = () => {
      pressed.current = { w: false, a: false, s: false, d: false };
      pointerDirectionRef.current = null;
      setHeldDirections(EMPTY_DIRECTIONS);
      setPointerDirection(null);
      stopRef.current();
    };

    const onVisibilityChange = () => {
      // Covers Alt-Tab / switching virtual desktops / minimizing, which
      // don't always fire a `blur` event on every platform/browser but do
      // always flip `document.hidden`.
      if (document.hidden) resetAll();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resetAll();
    };
    // `start`/`stop` intentionally excluded - see `startRef`/`stopRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  /** Called on joystick pointerdown for `direction`. */
  const pointerStart = (direction: CompassDirection) => {
    pointerDirectionRef.current = direction;
    setPointerDirection(direction);
    startRef.current(direction);
  };

  /** Called on joystick pointerup/pointercancel/pointerleave - falls back to a still-held keyboard direction instead of always stopping. */
  const pointerStop = () => {
    pointerDirectionRef.current = null;
    setPointerDirection(null);
    const { w, a, s, d } = pressed.current;
    const keyboardDirection = directionFromKeys(w, s, d, a);
    if (keyboardDirection) startRef.current(keyboardDirection);
    else stopRef.current();
  };

  /** Clears every held input source and stops the engine - what STOP and losing focus/visibility both need. */
  const stopAll = () => {
    pressed.current = { w: false, a: false, s: false, d: false };
    pointerDirectionRef.current = null;
    setHeldDirections(EMPTY_DIRECTIONS);
    setPointerDirection(null);
    stopRef.current();
  };

  return { heldDirections, pointerDirection, pointerStart, pointerStop, stopAll };
}
