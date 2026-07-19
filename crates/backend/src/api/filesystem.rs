use actix_web::{HttpResponse, Responder, get, web};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io;

use crate::api::error::internal_server_error;

const MAX_DIRECTORY_PATH_BYTES: usize = 4096;
const MAX_DIRECTORY_ENTRIES: usize = 10_000;

#[derive(Debug, Serialize)]
pub struct Directory {
    name: String,
    path: String,
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub path: String,
}

pub async fn list_path(directory_path: &str) -> io::Result<Vec<Directory>> {
    if directory_path.is_empty() || directory_path.len() > MAX_DIRECTORY_PATH_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "directory path is empty or too long",
        ));
    }
    let mut directories = Vec::new();
    let mut dir_entries = fs::read_dir(directory_path).await?;

    while let Some(entry) = dir_entries.next_entry().await? {
        let path = entry.path();
        if path.is_dir() {
            if directories.len() >= MAX_DIRECTORY_ENTRIES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "directory contains too many entries",
                ));
            }
            let name = entry.file_name().into_string().unwrap_or_default();
            directories.push(Directory {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    directories.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(directories)
}

#[get("")]
pub async fn list_directory(query: web::Query<ListQuery>) -> impl Responder {
    match list_path(&query.path).await {
        Ok(directories) => HttpResponse::Ok().json(directories),
        Err(_) => internal_server_error("Failed to list directory.", "list_directory_failed"),
    }
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(list_directory);
}

#[cfg(test)]
mod tests {
    use super::{MAX_DIRECTORY_PATH_BYTES, list_path};

    #[actix_web::test]
    async fn directory_paths_are_bounded_before_filesystem_access() {
        assert_eq!(
            list_path("")
                .await
                .expect_err("empty paths should fail")
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
        let error = list_path(&"x".repeat(MAX_DIRECTORY_PATH_BYTES + 1))
            .await
            .expect_err("oversized directory path should fail");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[actix_web::test]
    async fn directory_listing_returns_only_directories_in_sorted_order() {
        let root = std::env::temp_dir().join(format!("music-fs-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("z-last")).unwrap();
        std::fs::create_dir_all(root.join("a-first")).unwrap();
        std::fs::write(root.join("ignored.mp3"), b"fixture").unwrap();

        let directories = list_path(root.to_str().unwrap()).await.unwrap();
        let names = directories
            .into_iter()
            .map(|entry| entry.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["a-first", "z-last"]);

        std::fs::remove_dir_all(root).unwrap();
    }
}
