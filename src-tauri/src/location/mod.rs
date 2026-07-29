pub(crate) mod modern;
mod real;
mod validate;

pub use real::*;

/// Shared location-event persistence.
///
/// `haversine_km`/`record_event` back the History/Logs pages regardless of
/// which `LocationProvider` produced the change (mock or the real
/// `set_location` command below).
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

#[cfg(test)]
mod haversine_tests {
    use super::haversine_km;

    #[test]
    fn zero_distance_for_identical_points() {
        assert!(haversine_km(42.0, -83.0, 42.0, -83.0) < 1e-9);
    }

    #[test]
    fn known_distance_windsor_to_nyc_is_roughly_774km() {
        // Matches the distance surfaced in the travel-timer UI for this pair
        // (42.6073, -82.983) -> (40.758, -73.9855), verified end-to-end
        // against the frontend's identical haversine implementation.
        let km = haversine_km(42.6073, -82.983, 40.758, -73.9855);
        assert!((km - 774.5).abs() < 2.0, "expected ~774.5 km, got {km}");
    }

    #[test]
    fn antipodal_points_are_roughly_half_earth_circumference() {
        let km = haversine_km(0.0, 0.0, 0.0, 180.0);
        assert!((km - 20015.0).abs() < 5.0, "expected ~20015 km, got {km}");
    }
}
