use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

/// Shared application state. `Connection` is not `Sync`, so it is guarded by a
/// `Mutex` and accessed from Tauri commands one at a time.
pub struct AppState {
    pub db: Mutex<Connection>,
}

/// Opens (creating if necessary) the SQLite database in the app's data
/// directory and runs schema migrations. Called once at startup.
pub fn init(app: &AppHandle) -> rusqlite::Result<Connection> {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("app data directory should be resolvable");

    std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");

    let db_path = data_dir.join("pogo_control_hub.sqlite3");
    log::info!("opening database at {}", db_path.display());

    let conn = Connection::open(&db_path)?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    create_tables(conn)?;
    add_column_if_missing(conn, "device_events", "udid", "TEXT")?;
    Ok(())
}

/// Adds `column` to `table` if it isn't already there. `CREATE TABLE IF NOT
/// EXISTS` only handles brand-new databases, so a column added to the schema
/// after devices already have a database on disk needs this instead.
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    sql_type: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|existing| existing == column);

    if !has_column {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {sql_type}"),
            [],
        )?;
    }
    Ok(())
}

fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS location_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            old_latitude    REAL,
            old_longitude   REAL,
            new_latitude    REAL NOT NULL,
            new_longitude   REAL NOT NULL,
            distance_km     REAL,
            source          TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS movement_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            start_latitude  REAL NOT NULL,
            start_longitude REAL NOT NULL,
            end_latitude    REAL NOT NULL,
            end_longitude   REAL NOT NULL,
            distance_km     REAL NOT NULL,
            duration_secs   REAL NOT NULL,
            speed_kmh       REAL NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS device_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            event           TEXT NOT NULL,
            udid            TEXT,
            device_name     TEXT,
            device_model    TEXT,
            os_version      TEXT,
            trusted         INTEGER,
            message         TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS iv_calculations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            pokemon_name    TEXT NOT NULL,
            cp              INTEGER,
            hp              INTEGER,
            level_estimate  REAL,
            attack_iv_min   INTEGER,
            attack_iv_max   INTEGER,
            defense_iv_min  INTEGER,
            defense_iv_max  INTEGER,
            stamina_iv_min  INTEGER,
            stamina_iv_max  INTEGER,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key             TEXT PRIMARY KEY,
            value           TEXT NOT NULL
        );
        "#,
    )
}
