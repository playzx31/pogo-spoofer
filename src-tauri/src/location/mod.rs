/// Shared location-event persistence.
///
/// The actual `LocationProvider` implementations (mock + any future
/// supported device-testing provider) live on the frontend today, per
/// `src/location/LocationProvider.ts`. This module just records the events
/// they produce so History/Logs have real data to show, and haversine
/// distance is computed identically to the frontend copy for storage.
pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const EARTH_RADIUS_KM: f64 = 6371.0088;
    let (phi1, phi2) = (lat1.to_radians(), lat2.to_radians());
    let d_phi = (lat2 - lat1).to_radians();
    let d_lambda = (lon2 - lon1).to_radians();

    let a = (d_phi / 2.0).sin().powi(2) + phi1.cos() * phi2.cos() * (d_lambda / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    EARTH_RADIUS_KM * c
}

pub fn record_event(
    conn: &rusqlite::Connection,
    old: Option<(f64, f64)>,
    new: (f64, f64),
    source: &str,
) -> rusqlite::Result<f64> {
    let distance_km = old.map(|(olat, olon)| haversine_km(olat, olon, new.0, new.1));

    conn.execute(
        "INSERT INTO location_events (old_latitude, old_longitude, new_latitude, new_longitude, distance_km, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            old.map(|o| o.0),
            old.map(|o| o.1),
            new.0,
            new.1,
            distance_km,
            source,
        ],
    )?;

    Ok(distance_km.unwrap_or(0.0))
}
