import { Outlet } from "react-router-dom";

import { HeaderBar } from "./HeaderBar";
import { BottomTabBar } from "./BottomTabBar";
import "./AppShell.css";

export function AppShell() {
  return (
    <div className="app-shell">
      <HeaderBar />
      <main className="app-shell__content">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}
