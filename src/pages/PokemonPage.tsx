import "./PokemonPage.css";

export function PokemonPage() {
  return (
    <div className="pokemon-page">
      <div className="pokemon-page__panel panel">
        <span className="panel-title">Pokémon Database, IV Checker &amp; Shiny Checker</span>
        <p>
          This page will host the local Pokédex search, the manual IV calculator (CP/HP/appraisal based), and the shiny-availability
          reference lookup, backed by a local SQLite-cached dataset built from publicly available Pokémon reference information.
        </p>
        <p className="pokemon-page__note">
          Not built yet — scoped for after device detection and the supported location-testing integration, per the project priority
          order. The sidebar on the Location tab shows where these tools will live.
        </p>
      </div>
    </div>
  );
}
