import { MapView } from "../map/MapView";
import { PokemonToolsPanel } from "../pokemon/PokemonToolsPanel";
import { MovementPanel } from "../movement/MovementPanel";
import "./DashboardPage.css";

export function DashboardPage() {
  return (
    <div className="dashboard-page">
      <div className="dashboard-page__map panel">
        <MapView />
      </div>
      <div className="dashboard-page__pokemon">
        <PokemonToolsPanel />
      </div>
      <div className="dashboard-page__movement">
        <MovementPanel />
      </div>
    </div>
  );
}
