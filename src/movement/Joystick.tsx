import type { PointerEvent } from "react";

import { HEADING_ARROWS, type CompassDirection } from "./directions";
import "./Joystick.css";

const GRID: (CompassDirection | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

/**
 * A controlled component: all "what's currently active" state
 * (`activeDirections`) lives in the parent's `useMovementInput`, not here.
 * That's what lets STOP reset the joystick's visual state too - there is no
 * internal state here that could keep a button looking pressed after STOP
 * or a lost pointer event.
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
  const handlePointerDown = (direction: CompassDirection) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onStart(direction);
  };

  const handlePointerUp = () => onStop();

  const handlePointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.buttons === 0) onStop();
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
              className={`joystick__btn joystick__btn--${direction}${activeDirections.has(direction) ? " is-active" : ""}`}
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
