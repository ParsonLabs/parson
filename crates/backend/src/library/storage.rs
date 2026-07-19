use std::error::Error;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use tokio::sync::RwLock;

use crate::domain::Artist;
use crate::settings::data_path;

static LIBRARY: OnceLock<RwLock<Option<Arc<Vec<Artist>>>>> = OnceLock::new();

fn cache() -> &'static RwLock<Option<Arc<Vec<Artist>>>> {
    LIBRARY.get_or_init(|| RwLock::new(None))
}

pub async fn fetch_library() -> Result<Arc<Vec<Artist>>, Box<dyn Error + Send + Sync>> {
    if let Some(library) = cache().read().await.clone() {
        return Ok(library);
    }

    let mut library = tokio::task::spawn_blocking(|| {
        let pool = crate::persistence::connection::connect()?;
        crate::library::indexer::export_library_from_database(&pool)
    })
    .await
    .map_err(|error| std::io::Error::other(format!("Library load task failed: {error}")))??;
    if library.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No indexed library is available.",
        )
        .into());
    }
    crate::library::normalize::normalize_library_data(&mut library);

    let library = Arc::new(library);
    *cache().write().await = Some(library.clone());
    Ok(library)
}

pub async fn store_library(library: Vec<Artist>) -> Arc<Vec<Artist>> {
    let library = Arc::new(library);
    *cache().write().await = Some(Arc::clone(&library));
    library
}

pub async fn refresh_cache() {
    *cache().write().await = None;
}

pub fn get_libraries_config_path() -> PathBuf {
    data_path(&["Config", "libraries.json"])
}

pub fn get_icon_art_path() -> PathBuf {
    data_path(&["Artist Icons"])
}

pub fn get_cover_art_path() -> PathBuf {
    data_path(&["Album Covers"])
}

pub fn get_profile_picture_path() -> PathBuf {
    data_path(&["Profile Pictures"])
}
