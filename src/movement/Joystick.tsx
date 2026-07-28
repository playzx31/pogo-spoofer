import type { PointerEvent } from "react";

import { HEADING_ARROWS, type CompassDirection } from "./directions";
import "./Joystick.css";

const GRID: (CompassDirection | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

export function Joystick({
  activeDirection,
  onStart,
  onStop,
}: {
  activeDirection: CompassDirection | null;
  onStart: (direction: CompassDirection) => void;
  onStop: () => void;
}) {
  const handlePointerDown = (direction: CompassDirection) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onStart(direction);
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
              className={`joystick__btn joystick__btn--${direction}${activeDirection === direction ? " is-active" : ""}`}
              onPointerDown={handlePointerDown(direction)}
              onPointerUp={onStop}
              onPointerCancel={onStop}
              onPointerLeave={(e) => e.buttons === 0 && onStop()}
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
