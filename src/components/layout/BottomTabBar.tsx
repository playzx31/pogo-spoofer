import { NavLink } from "react-router-dom";

import "./BottomTabBar.css";

const TABS = [
  { to: "/", label: "Location", end: true },
  { to: "/device", label: "Device" },
  { to: "/pokemon", label: "Pokémon" },
  { to: "/logs", label: "Logs" },
  { to: "/settings", label: "Settings" },
];

export function BottomTabBar() {
  return (
    <nav className="bottom-tab-bar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `bottom-tab-bar__tab${isActive ? " is-active" : ""}`}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
