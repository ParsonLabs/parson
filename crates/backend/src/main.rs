use tracing_subscriber::EnvFilter;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("repair-index")) {
        let path = args.next().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "usage: parson-music-server repair-index <library-path>",
            )
        })?;
        let path = path.to_string_lossy();
        let (_, report) = parson_music::library::indexer::repair_library_database(&path)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        tracing::info!(
            scanned_files = report.scanned_files,
            indexed_files = report.indexed_files,
            "Library catalog repair completed"
        );
        return Ok(());
    }

    parson_music::server::run().await
}
