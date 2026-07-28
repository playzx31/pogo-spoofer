import { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicePage } from "./pages/DevicePage";
import { PokemonPage } from "./pages/PokemonPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useLocationStore } from "./state/locationStore";

function App() {
  useEffect(() => {
    void useLocationStore.getState().initialize();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="device" element={<DevicePage />} />
          <Route path="pokemon" element={<PokemonPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
