use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use diesel::connection::SimpleConnection;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Text};

use crate::{LibraryId, LibraryRegistration, ProductCapability};

type RegistryError = Box<dyn Error + Send + Sync + 'static>;

/// Persistent Core-owned library registry.
#[derive(Debug, Clone)]
pub struct CoreRegistry {
    path: PathBuf,
}

#[derive(QueryableByName)]
struct LibraryRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    path: String,
    #[diesel(sql_type = Text)]
    capability: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    display_name: Option<String>,
    #[diesel(sql_type = BigInt)]
    enabled: i64,
}

impl CoreRegistry {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, RegistryError> {
        let registry = Self { path: path.into() };
        if let Some(parent) = registry.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut connection = registry.connect()?;
        connection.batch_execute(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS core_migration (
                 version INTEGER NOT NULL PRIMARY KEY,
                 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS library (
                 id TEXT NOT NULL PRIMARY KEY,
                 path TEXT NOT NULL,
                 capability TEXT NOT NULL,
                 display_name TEXT,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 UNIQUE(path, capability)
             );
             INSERT OR IGNORE INTO core_migration(version) VALUES (1);",
        )?;
        Ok(registry)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn register(&self, library: &LibraryRegistration) -> Result<(), RegistryError> {
        let mut connection = self.connect()?;
        diesel::sql_query(
            "INSERT INTO library(id, path, capability, display_name, enabled)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(path, capability) DO UPDATE SET
                 id = excluded.id,
                 display_name = excluded.display_name,
                 enabled = excluded.enabled,
                 updated_at = CURRENT_TIMESTAMP",
        )
        .bind::<Text, _>(library.id.as_str())
        .bind::<Text, _>(library.path.to_string_lossy().as_ref())
        .bind::<Text, _>(library.capability.as_str())
        .bind::<diesel::sql_types::Nullable<Text>, _>(library.display_name.as_deref())
        .bind::<BigInt, _>(i64::from(library.enabled))
        .execute(&mut connection)?;
        Ok(())
    }

    pub fn libraries(&self) -> Result<Vec<LibraryRegistration>, RegistryError> {
        let mut connection = self.connect()?;
        let rows = diesel::sql_query(
            "SELECT id, path, capability, display_name, enabled
             FROM library ORDER BY capability, path",
        )
        .load::<LibraryRow>(&mut connection)?;
        rows.into_iter()
            .map(|row| {
                Ok(LibraryRegistration {
                    id: LibraryId::parse(row.id)?,
                    path: PathBuf::from(row.path),
                    capability: ProductCapability::new(row.capability)?,
                    display_name: row.display_name,
                    enabled: row.enabled != 0,
                })
            })
            .collect()
    }

    fn connect(&self) -> Result<SqliteConnection, RegistryError> {
        let url = self
            .path
            .to_str()
            .ok_or("Core database path is not valid UTF-8")?;
        Ok(SqliteConnection::establish(url)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_registry_is_independent_and_product_scoped() {
        let path =
            std::env::temp_dir().join(format!("parson-core-registry-{}.db", std::process::id()));
        let _ = fs::remove_file(&path);
        let registry = CoreRegistry::open(&path).expect("registry");
        let music = LibraryRegistration::new(
            "/media/music",
            ProductCapability::new("music").expect("capability"),
        );
        registry.register(&music).expect("register");
        assert_eq!(registry.libraries().expect("libraries"), vec![music]);
        fs::remove_file(path).expect("remove registry");
    }
}
