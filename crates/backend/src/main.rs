use std::io;

use tracing_subscriber::EnvFilter;

#[actix_web::main]
async fn main() -> io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let result = run().await;
    if let Err(error) = &result {
        eprintln!(
            "{}",
            startup_error_banner(error, parson_music::settings::is_container())
        );
    }
    result
}

async fn run() -> io::Result<()> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("repair-index")) {
        let path = args.next().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "usage: parson-music-server repair-index <library-path>",
            )
        })?;
        let path = path.to_string_lossy();
        let (_, report) = parson_music::library::indexer::repair_library_database(&path)
            .map_err(|error| io::Error::other(error.to_string()))?;
        tracing::info!(
            scanned_files = report.scanned_files,
            indexed_files = report.indexed_files,
            "Library catalog repair completed"
        );
        return Ok(());
    }

    parson_music::server::run().await
}

fn startup_error_banner(error: &io::Error, is_container: bool) -> String {
    let title = match error.kind() {
        io::ErrorKind::NotFound => "PARSON CANNOT FIND A REQUIRED PATH",
        io::ErrorKind::PermissionDenied => "PARSON CANNOT ACCESS A REQUIRED PATH",
        _ => "PARSON COULD NOT START",
    };
    let reason = error
        .to_string()
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let mut banner = format!(
        "\n\
+------------------------------------------------------------------+\n\
| {title:<64} |\n\
+------------------------------------------------------------------+\n\
Reason: {reason}\n"
    );
    if is_container {
        let data_path = parson_music::settings::data_path(&[]);
        let music_path = parson_music::settings::suggested_library_path();
        banner.push_str(&format!(
            "\n\
Docker/NAS checks:\n\
  - Confirm the NAS share is mounted on the Docker host.\n\
  - Confirm every volume source directory exists.\n\
  - Confirm {data_path} is writable by the container user.\n\
  - Confirm the music volume is mounted at {music_path}.\n\
\n\
Resolved data path:  {data_path}\n\
Resolved music path: {music_path}\n",
            data_path = data_path.display(),
            music_path = music_path.display(),
        ));
    }
    banner.push_str("+------------------------------------------------------------------+");
    banner
}

#[cfg(test)]
mod tests {
    use super::startup_error_banner;
    use std::io;

    #[test]
    fn missing_container_paths_show_nas_mount_guidance() {
        let banner = startup_error_banner(
            &io::Error::new(
                io::ErrorKind::NotFound,
                "configured directory is unavailable",
            ),
            true,
        );

        assert!(banner.contains("PARSON CANNOT FIND A REQUIRED PATH"));
        assert!(banner.contains("configured directory is unavailable"));
        assert!(banner.contains("Confirm the NAS share is mounted"));
        assert!(banner.contains("Resolved data path:"));
        assert!(banner.contains("Resolved music path:"));
    }

    #[test]
    fn permission_failures_have_a_distinct_heading() {
        let banner = startup_error_banner(
            &io::Error::new(io::ErrorKind::PermissionDenied, "directory is read-only"),
            true,
        );

        assert!(banner.contains("PARSON CANNOT ACCESS A REQUIRED PATH"));
        assert!(banner.contains("directory is read-only"));
    }

    #[test]
    fn startup_error_details_cannot_break_the_banner_into_log_lines() {
        let banner = startup_error_banner(&io::Error::other("first line\nsecond line"), false);

        assert!(banner.contains("PARSON COULD NOT START"));
        assert!(banner.contains("Reason: first line second line"));
        assert!(!banner.contains("Docker/NAS checks:"));
    }
}
