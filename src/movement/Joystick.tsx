import { useState, type PointerEvent } from "react";

import { HEADING_ARROWS, type CompassDirection } from "./directions";
import "./Joystick.css";

const GRID: (CompassDirection | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

/**
 * `activeDirections` (from the keyboard hook) and this component's own
 * pointer-driven `pointerDirection` are independent input sources that must
 * both be able to light up a button - e.g. holding W on the keyboard while
 * also dragging the joystick's E button should show both as active. Neither
 * one clears the other.
 */
export function Joystick({
  activeDirections,
  onStart,
  onStop,
}: {
  activeDirections: ReadonlySet<CompassDirection>;
  onStart: (direction: CompassDirection) => void;
  onStop: () => void;
}) {
  const [pointerDirection, setPointerDirection] = useState<CompassDirection | null>(null);

  const handlePointerDown = (direction: CompassDirection) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPointerDirection(direction);
    onStart(direction);
  };

  const handlePointerUp = () => {
    setPointerDirection(null);
    onStop();
  };

  const handlePointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.buttons === 0) {
      setPointerDirection(null);
      onStop();
    }
  };

  return (
    <div className="joystick">
      <div className="joystick__grid">
        {GRID.map((direction) =>
          direction === null ? (
            <div key="center" className="joystick__center">
              <span className="joystick__center-dot" />
            </div>
          ) : (
            <button
              key={direction}
              type="button"
              className={`joystick__btn joystick__btn--${direction}${
                activeDirections.has(direction) || pointerDirection === direction ? " is-active" : ""
              }`}
              onPointerDown={handlePointerDown(direction)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              aria-label={`Move ${direction}`}
            >
              {HEADING_ARROWS[direction]}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
