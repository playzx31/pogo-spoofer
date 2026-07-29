// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompassDirection } from "./directions";
import { useMovementInput } from "./useMovementInput";

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function releaseKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key }));
}

function pressKeyRepeat(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat: true }));
}

describe("useMovementInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with nothing held", () => {
    const { result } = renderHook(() => useMovementInput({ start: vi.fn(), stop: vi.fn(), enabled: true }));
    expect(result.current.heldDirections.size).toBe(0);
    expect(result.current.pointerDirection).toBeNull();
  });

  it("holding W highlights W and starts north", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => pressKey("w"));

    expect([...result.current.heldDirections]).toEqual(["N"]);
    expect(start).toHaveBeenCalledWith("N");
  });

  it("holding W+D highlights both and moves northeast", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
    });

    expect(new Set(result.current.heldDirections)).toEqual(new Set(["N", "E"]));
    expect(start).toHaveBeenLastCalledWith("NE");
  });

  it("releasing D clears D while W stays highlighted and movement continues north", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
      releaseKey("d");
    });

    expect([...result.current.heldDirections]).toEqual(["N"]);
    expect(start).toHaveBeenLastCalledWith("N");
  });

  it("releasing W returns all movement keys to idle and stops", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      releaseKey("w");
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(stop).toHaveBeenCalled();
  });

  it("ignores repeated keydown events from OS key-repeat", () => {
    const start = vi.fn();
    const stop = vi.fn();
    renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKeyRepeat("w");
      pressKeyRepeat("w");
      pressKeyRepeat("w");
    });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("ignores movement keys while typing into a text input", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(start).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("losing window focus clears held keys, pointer state, and stops", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
      result.current.pointerStart("E");
    });
    expect(result.current.heldDirections.size).toBe(2);
    expect(result.current.pointerDirection).toBe("E");

    act(() => {
      window.dispatchEvent(new FocusEvent("blur"));
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(result.current.pointerDirection).toBeNull();
    expect(stop).toHaveBeenCalled();

    // A stale keyup arriving after blur must not resurrect a highlight for
    // a key the hook already considers released.
    act(() => releaseKey("w"));
    expect(result.current.heldDirections.size).toBe(0);
  });

  it("losing document visibility (Alt-Tab) clears held state the same as blur", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => pressKey("w"));
    expect(result.current.heldDirections.size).toBe(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(result.current.heldDirections.size).toBe(0);
    expect(stop).toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("does nothing when disabled", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: false }));

    act(() => pressKey("w"));

    expect(result.current.heldDirections.size).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });

  it("pointerStart moves in that direction and highlights it", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => result.current.pointerStart("SW"));

    expect(result.current.pointerDirection).toBe("SW");
    expect(start).toHaveBeenCalledWith("SW");
  });

  it("pointerStop falls back to a still-held keyboard direction instead of always stopping", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => pressKey("w"));
    act(() => result.current.pointerStart("E"));
    expect(start).toHaveBeenLastCalledWith("E");

    act(() => result.current.pointerStop());

    expect(result.current.pointerDirection).toBeNull();
    expect(start).toHaveBeenLastCalledWith("N"); // resumed the still-held W
    expect(result.current.heldDirections.has("N")).toBe(true);
  });

  it("pointerStop with no keyboard key held actually stops", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => result.current.pointerStart("E"));
    act(() => result.current.pointerStop());

    expect(stop).toHaveBeenCalled();
    expect(result.current.pointerDirection).toBeNull();
  });

  it("stopAll clears held keys and pointer direction, and a later keyup for an already-cleared key does not resume movement", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useMovementInput({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
      result.current.pointerStart("S");
    });

    act(() => result.current.stopAll());

    expect(result.current.heldDirections.size).toBe(0);
    expect(result.current.pointerDirection).toBeNull();
    expect(stop).toHaveBeenCalled();

    start.mockClear();
    // Physically releasing D (one of the two keys that were down at STOP
    // time) must not resurrect movement - STOP means STOP, not "resume on
    // the next unrelated key event".
    act(() => releaseKey("d"));
    expect(start).not.toHaveBeenCalled();
    expect(result.current.heldDirections.size).toBe(0);
  });

  it("does not reset held-key state or stop movement when the caller's start/stop identities change across a re-render", () => {
    // This is the exact regression that used to break continuous movement:
    // `MovementPanel` re-renders on every successful movement tick (it
    // reads the live position/heading from the store), creating brand-new
    // `start`/`stop` closures each time. If this hook's window-level effect
    // depended on those identities, React would tear it down and rebuild it
    // on every tick - and the old cleanup unconditionally called `stop()`
    // and wiped held-key state, killing movement after a single tick and
    // making W/A/S/D never reliably highlight while held.
    let engineDirection: CompassDirection | null = null;
    const start1 = vi.fn((d: CompassDirection) => {
      engineDirection = d;
    });
    const stop1 = vi.fn(() => {
      engineDirection = null;
    });

    const { result, rerender } = renderHook(({ start, stop }) => useMovementInput({ start, stop, enabled: true }), {
      initialProps: { start: start1, stop: stop1 },
    });

    act(() => pressKey("w"));
    expect(engineDirection).toBe("N");
    expect(result.current.heldDirections.has("N")).toBe(true);

    const start2 = vi.fn((d: CompassDirection) => {
      engineDirection = d;
    });
    const stop2 = vi.fn(() => {
      engineDirection = null;
    });
    rerender({ start: start2, stop: stop2 });

    // Re-rendering with new callback identities must not silently reset
    // input state or stop movement.
    expect(result.current.heldDirections.has("N")).toBe(true);
    expect(engineDirection).toBe("N");
    expect(stop2).not.toHaveBeenCalled();

    // Releasing the still-held key now must call the LATEST stop, not a
    // stale one captured when the listeners were first attached.
    act(() => releaseKey("w"));
    expect(stop2).toHaveBeenCalled();
    expect(stop1).not.toHaveBeenCalled();
    expect(result.current.heldDirections.size).toBe(0);
  });
});
