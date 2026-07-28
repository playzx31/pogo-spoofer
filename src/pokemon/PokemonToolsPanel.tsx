import "./PokemonToolsPanel.css";

/**
 * Placeholder for the dashboard sidebar. The Pokémon database, IV
 * calculator, and shiny-availability checker are scoped for later phases
 * (priority 9 and 10) - this keeps the dashboard layout complete now
 * without faking results that aren't computed yet.
 */
export function PokemonToolsPanel() {
  return (
    <div className="pokemon-tools panel">
      <div className="pokemon-tools__header">
        <span className="panel-title">Pokémon Tools</span>
      </div>
      <div className="pokemon-tools__body">
        <input type="text" placeholder="Search Pokémon..." disabled />
        <div className="pokemon-tools__row">
          <label>CP</label>
          <input type="text" disabled placeholder="—" />
        </div>
        <div className="pokemon-tools__row">
          <label>HP</label>
          <input type="text" disabled placeholder="—" />
        </div>
        <div className="pokemon-tools__result">
          <span className="panel-title">IV Result</span>
          <span className="mono pokemon-tools__muted">— / — / —</span>
        </div>
        <div className="pokemon-tools__result">
          <span className="panel-title">Shiny</span>
          <span className="mono pokemon-tools__muted">Unknown</span>
        </div>
        <p className="pokemon-tools__note">Coming in a later phase: local Pokédex, IV calculator, shiny availability.</p>
      </div>
    </div>
  );
}
