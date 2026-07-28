//! Coordinate validation shared by every command that sends a location to a
//! device. Latitude is a hard range check (a value outside it is simply
//! wrong, never a legitimate point on Earth); longitude is cyclic, so it is
//! wrapped into its canonical range instead of rejected.

/// Rejects non-finite or out-of-range latitude. `-90`/`90` (the poles) are
/// valid.
pub fn validate_latitude(latitude: f64) -> Result<f64, String> {
    if !latitude.is_finite() {
        return Err("Latitude must be a finite number".to_string());
    }
    if !(-90.0..=90.0).contains(&latitude) {
        return Err(format!(
            "Latitude {latitude:.6} is out of range; must be between -90 and 90"
        ));
    }
    Ok(latitude)
}

/// Wraps any finite longitude into the canonical `(-180, 180]` range, e.g.
/// `181 -> -179` and `-181 -> 179`, so crossing the antimeridian during
/// movement "just works" instead of producing an invalid coordinate.
pub fn normalize_longitude(longitude: f64) -> Result<f64, String> {
    if !longitude.is_finite() {
        return Err("Longitude must be a finite number".to_string());
    }
    let mut wrapped = longitude % 360.0;
    if wrapped <= -180.0 {
        wrapped += 360.0;
    } else if wrapped > 180.0 {
        wrapped -= 360.0;
    }
    Ok(wrapped)
}

pub fn validate_coordinates(latitude: f64, longitude: f64) -> Result<(f64, f64), String> {
    let lat = validate_latitude(latitude)?;
    let lon = normalize_longitude(longitude)?;
    Ok((lat, lon))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_in_range_latitude() {
        assert_eq!(validate_latitude(45.0), Ok(45.0));
        assert_eq!(validate_latitude(-90.0), Ok(-90.0));
        assert_eq!(validate_latitude(90.0), Ok(90.0));
        assert_eq!(validate_latitude(0.0), Ok(0.0));
    }

    #[test]
    fn rejects_out_of_range_latitude() {
        assert!(validate_latitude(90.000001).is_err());
        assert!(validate_latitude(-90.1).is_err());
        assert!(validate_latitude(180.0).is_err());
    }

    #[test]
    fn rejects_non_finite_latitude() {
        assert!(validate_latitude(f64::NAN).is_err());
        assert!(validate_latitude(f64::INFINITY).is_err());
        assert!(validate_latitude(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn leaves_in_range_longitude_untouched() {
        assert_eq!(normalize_longitude(0.0), Ok(0.0));
        assert_eq!(normalize_longitude(179.9), Ok(179.9));
        assert_eq!(normalize_longitude(-179.9), Ok(-179.9));
        assert_eq!(normalize_longitude(180.0), Ok(180.0));
    }

    #[test]
    fn wraps_longitude_past_the_antimeridian() {
        assert_eq!(normalize_longitude(181.0), Ok(-179.0));
        assert_eq!(normalize_longitude(-181.0), Ok(179.0));
        assert_eq!(normalize_longitude(-180.0), Ok(180.0));
        assert_eq!(normalize_longitude(360.0), Ok(0.0));
        assert_eq!(normalize_longitude(-360.0), Ok(0.0));
        assert_eq!(normalize_longitude(900.0), Ok(180.0));
    }

    #[test]
    fn rejects_non_finite_longitude() {
        assert!(normalize_longitude(f64::NAN).is_err());
        assert!(normalize_longitude(f64::INFINITY).is_err());
    }

    #[test]
    fn validate_coordinates_combines_both_checks() {
        assert_eq!(validate_coordinates(45.0, 200.0), Ok((45.0, -160.0)));
        assert!(validate_coordinates(200.0, 0.0).is_err());
    }
}
