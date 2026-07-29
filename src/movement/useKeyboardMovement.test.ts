// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeyboardMovement } from "./useKeyboardMovement";

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function releaseKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key }));
}

describe("useKeyboardMovement held-key visual state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with nothing held", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    expect(result.current.heldDirections.size).toBe(0);
  });

  it("holding W highlights W", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    act(() => pressKey("w"));

    expect([...result.current.heldDirections]).toEqual(["N"]);
    expect(start).toHaveBeenCalledWith("N");
  });

  it("holding W+D highlights both W and D", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
    });

    expect(new Set(result.current.heldDirections)).toEqual(new Set(["N", "E"]));
    expect(start).toHaveBeenLastCalledWith("NE");
  });

  it("releasing D clears D while W stays highlighted", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
      releaseKey("d");
    });

    expect([...result.current.heldDirections]).toEqual(["N"]);
    expect(start).toHaveBeenLastCalledWith("N");
  });

  it("releasing W returns all movement keys to idle", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      releaseKey("w");
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(stop).toHaveBeenCalled();
  });

  it("losing window focus clears all held-key visual state and stops", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    act(() => {
      pressKey("w");
      pressKey("d");
    });
    expect(result.current.heldDirections.size).toBe(2);

    act(() => {
      window.dispatchEvent(new FocusEvent("blur"));
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(stop).toHaveBeenCalled();

    // A stale keyup arriving after blur (key physically released while the
    // window was unfocused) must not resurrect a highlight for a key the
    // hook already considers released.
    act(() => releaseKey("w"));
    expect(result.current.heldDirections.size).toBe(0);
  });

  it("ignores movement keys while typing into a text input", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: true }));

    // Dispatched on the input (not `window` directly) so it bubbles up with
    // `e.target` set to the input element, matching a real keystroke while
    // focused in a text field.
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });

    expect(result.current.heldDirections.size).toBe(0);
    expect(start).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("does nothing when disabled", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useKeyboardMovement({ start, stop, enabled: false }));

    act(() => pressKey("w"));

    expect(result.current.heldDirections.size).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });
});
