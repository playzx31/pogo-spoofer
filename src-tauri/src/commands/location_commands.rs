use serde::Serialize;
use tauri::State;

use crate::database::AppState;
use crate::location;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationEventRow {
    pub id: i64,
    pub old_latitude: Option<f64>,
    pub old_longitude: Option<f64>,
    pub new_latitude: f64,
    pub new_longitude: f64,
    pub distance_km: Option<f64>,
    pub source: String,
    pub created_at: String,
}

/// Records a location change (map click "Set Test Location", manual
/// coordinate entry, or a movement-engine tick) and returns the computed
/// distance in kilometers so the frontend doesn't need to duplicate the
/// haversine math for the persisted record.
#[tauri::command]
pub fn record_location_event(
    state: State<AppState>,
    old_latitude: Option<f64>,
    old_longitude: Option<f64>,
    new_latitude: f64,
    new_longitude: f64,
    source: String,
) -> Result<f64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let old = match (old_latitude, old_longitude) {
        (Some(lat), Some(lon)) => Some((lat, lon)),
        _ => None,
    };
    location::record_event(&conn, old, (new_latitude, new_longitude), &source).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_location_events(state: State<AppState>, limit: i64) -> Result<Vec<LocationEventRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, old_latitude, old_longitude, new_latitude, new_longitude, distance_km, source, created_at
             FROM location_events ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([limit], |row| {
            Ok(LocationEventRow {
                id: row.get(0)?,
                old_latitude: row.get(1)?,
                old_longitude: row.get(2)?,
                new_latitude: row.get(3)?,
                new_longitude: row.get(4)?,
                distance_km: row.get(5)?,
                source: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
