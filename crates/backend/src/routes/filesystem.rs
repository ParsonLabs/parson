use actix_web::{get, web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io;

#[derive(Serialize)]
pub struct Directory {
    name: String,
    path: String,
}

#[derive(Deserialize)]
struct ListQuery {
    path: String,
}

#[get("/list_directory")]
async fn list_directory(query: web::Query<ListQuery>) -> impl Responder {
    async fn list(directory_path: &str) -> io::Result<Vec<Directory>> {
        let mut directories = Vec::new();
        let mut dir_entries = fs::read_dir(directory_path).await?;

        while let Some(entry) = dir_entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().into_string().unwrap_or_default();
                directories.push(Directory {
                    name,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }

        Ok(directories)
    }

    match list(&query.path).await {
        Ok(directories) => HttpResponse::Ok().json(directories),
        Err(_) => HttpResponse::InternalServerError().body("Failed to list directory"),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
	cfg.service(
    web::scope("/filesystem")
          .service(list_directory)
	);
}