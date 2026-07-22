use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rand::RngExt;
use rand::distr::Alphanumeric;

static SESSION_SECRET: OnceLock<String> = OnceLock::new();
pub const DEFAULT_PORT: u16 = 1993;

fn parse_port(value: Option<&str>) -> Result<u16, String> {
    match value {
        Some(value) => value
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(|| "PARSON_PORT must be an integer from 1 to 65535".to_string()),
        None => Ok(DEFAULT_PORT),
    }
}

fn parse_bind_address(value: Option<&str>) -> Result<String, String> {
    let address = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("0.0.0.0");
    address
        .parse::<std::net::IpAddr>()
        .map(|address| address.to_string())
        .map_err(|_| "PARSON_BIND_ADDRESS must be an IPv4 or IPv6 address".to_string())
}

fn parse_public_url(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let origin = value.strip_suffix('/').unwrap_or(value);
    let authority = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .ok_or_else(|| "PARSON_PUBLIC_URL must start with http:// or https://".to_string())?;
    if authority.is_empty()
        || authority.contains(['/', '?', '#', '@'])
        || origin.chars().any(char::is_whitespace)
    {
        return Err(
            "PARSON_PUBLIC_URL must be an origin without a path, such as https://parson.dev"
                .to_string(),
        );
    }
    Ok(Some(origin.to_string()))
}

fn configured_public_url() -> Result<Option<String>, String> {
    parse_public_url(std::env::var("PARSON_PUBLIC_URL").ok().as_deref())
}

fn allowed_origins_for(public_url: Option<String>) -> Vec<String> {
    let mut origins = vec![
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    if let Some(origin) = public_url
        && !origins.contains(&origin)
    {
        origins.push(origin);
    }
    origins
}

fn secure_cookies_for(public_url: Option<&str>) -> bool {
    public_url.is_some_and(|url| url.starts_with("https://"))
}

pub fn port() -> Result<u16, String> {
    parse_port(std::env::var("PARSON_PORT").ok().as_deref())
}

pub fn bind_address() -> Result<String, String> {
    parse_bind_address(std::env::var("PARSON_BIND_ADDRESS").ok().as_deref())
}

pub fn secure_cookies() -> bool {
    let public_url = configured_public_url().ok().flatten();
    secure_cookies_for(public_url.as_deref())
}

pub fn allowed_origins() -> Vec<String> {
    allowed_origins_for(configured_public_url().ok().flatten())
}

pub fn validate() -> Result<(), String> {
    port()?;
    bind_address()?;
    configured_public_url()?;
    initialize_session_secret()?;
    Ok(())
}

pub fn is_container() -> bool {
    std::env::var_os("RUNNING_IN_DOCKER").is_some()
        || Path::new("/.dockerenv").exists()
        || Path::new("/run/.containerenv").exists()
}

pub fn data_path(parts: &[&str]) -> PathBuf {
    let mut path = if let Some(path) = std::env::var_os("PARSON_DATA_DIR") {
        PathBuf::from(path)
    } else if is_container() {
        PathBuf::from("/Parson")
    } else {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("Parson");
        path
    };
    path.extend(parts);
    path
}

pub fn core_database_path() -> PathBuf {
    data_path(&["Database", "parson-core.db"])
}

pub fn music_database_path() -> PathBuf {
    data_path(&["Database", "parson-music.db"])
}

pub fn legacy_music_database_path() -> PathBuf {
    data_path(&["Database", "music.db"])
}

pub fn suggested_library_path() -> PathBuf {
    if is_container() {
        return PathBuf::from("/music");
    }
    dirs::audio_dir()
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn library_name() -> String {
    let name = std::env::var("PARSON_LIBRARY_NAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Parson Library".to_string());
    let sanitized = name
        .chars()
        .filter(|character| !character.is_control())
        .take(48)
        .collect::<String>();
    if sanitized.trim().is_empty() {
        "Parson Library".to_string()
    } else {
        sanitized
    }
}

pub fn instance_id() -> std::io::Result<String> {
    #[cfg(test)]
    return Ok("00000000-0000-4000-8000-000000000001".to_string());

    #[cfg(not(test))]
    {
        let path = data_path(&["Discovery", "instance-id"]);
        load_or_create_instance_id_at(&path)
    }
}

fn load_or_create_instance_id_at(path: &Path) -> std::io::Result<String> {
    if let Ok(value) = fs::read_to_string(path) {
        let value = value.trim();
        if uuid::Uuid::parse_str(value).is_ok() {
            return Ok(value.to_string());
        }
        let _ = fs::remove_file(path);
    }
    let value = uuid::Uuid::new_v4().to_string();
    persist_secret(path, &value)?;
    Ok(value)
}

pub fn initialize_session_secret() -> Result<(), String> {
    if SESSION_SECRET.get().is_some() {
        return Ok(());
    }

    #[cfg(test)]
    let secret = "parson-test-session-key-that-is-never-used-in-production".to_string();
    #[cfg(not(test))]
    let secret = load_or_create_session_secret().map_err(|error| {
        format!(
            "could not initialize the private session key in {}: {error}",
            data_path(&["Secrets"]).display()
        )
    })?;

    let _ = SESSION_SECRET.set(secret);
    Ok(())
}

pub fn session_secret() -> &'static str {
    #[cfg(test)]
    return SESSION_SECRET
        .get_or_init(|| "parson-test-session-key-that-is-never-used-in-production".to_string());

    #[cfg(not(test))]
    SESSION_SECRET
        .get()
        .expect("session secret must be initialized during server startup")
}

#[cfg(not(test))]
fn load_or_create_session_secret() -> std::io::Result<String> {
    let path = data_path(&["Secrets", "session.key"]);
    let legacy_path = data_path(&["Secrets", "jwt.key"]);
    load_or_create_session_secret_at(&path, &legacy_path)
}

fn load_or_create_session_secret_at(path: &Path, legacy_path: &Path) -> std::io::Result<String> {
    if let Ok(secret) = fs::read_to_string(path) {
        if secret.len() < 32 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "session.key is invalid; remove it to generate a new key",
            ));
        }
        restrict_secret_permissions(path);
        return Ok(secret);
    }

    if let Ok(secret) = fs::read_to_string(legacy_path)
        && secret.len() >= 32
    {
        persist_secret(path, &secret)?;
        let _ = fs::remove_file(legacy_path);
        return Ok(secret);
    }

    let secret: String = rand::rng()
        .sample_iter(Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    persist_secret(path, &secret)?;
    Ok(secret)
}

fn persist_secret(path: &Path, secret: &str) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("session key path has no parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".jwt-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(secret.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        restrict_secret_permissions(path);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn restrict_secret_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
        tracing::warn!(%error, path = %path.display(), "could not restrict session key permissions");
    }
}

#[cfg(not(unix))]
fn restrict_secret_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::{
        allowed_origins_for, load_or_create_instance_id_at, load_or_create_session_secret_at,
        parse_bind_address, parse_port, parse_public_url, persist_secret, secure_cookies_for,
    };

    #[test]
    fn invalid_ports_are_rejected_instead_of_silently_defaulting() {
        assert_eq!(parse_port(None), Ok(1993));
        assert_eq!(parse_port(Some("1993")), Ok(1993));
        assert!(parse_port(Some("0")).is_err());
        assert!(parse_port(Some("not-a-port")).is_err());
    }

    #[test]
    fn desktop_hosts_can_restrict_the_server_to_loopback() {
        assert_eq!(parse_bind_address(None), Ok("0.0.0.0".to_string()));
        assert_eq!(
            parse_bind_address(Some("127.0.0.1")),
            Ok("127.0.0.1".to_string())
        );
        assert!(parse_bind_address(Some("localhost")).is_err());
    }

    #[test]
    fn session_keys_are_persisted_without_leaving_partial_files() {
        let directory =
            std::env::temp_dir().join(format!("music-secret-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("session.key");
        persist_secret(&path, "a-stable-secret-with-more-than-thirty-two-bytes")
            .expect("persist secret");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read persisted secret"),
            "a-stable-secret-with-more-than-thirty-two-bytes"
        );
        assert_eq!(
            std::fs::read_dir(&directory)
                .expect("list secret directory")
                .count(),
            1
        );
        std::fs::remove_dir_all(directory).expect("secret test cleanup");
    }

    #[test]
    fn generated_session_keys_are_stable_without_an_environment_secret() {
        let directory =
            std::env::temp_dir().join(format!("music-session-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("session.key");
        let legacy = directory.join("jwt.key");
        let first = load_or_create_session_secret_at(&path, &legacy).expect("generate key");
        let second = load_or_create_session_secret_at(&path, &legacy).expect("reload key");
        assert!(first.len() >= 32);
        assert_eq!(first, second);
        std::fs::remove_dir_all(directory).expect("session test cleanup");
    }

    #[test]
    fn discovery_identity_is_stable_and_repairs_invalid_data() {
        let directory =
            std::env::temp_dir().join(format!("music-discovery-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("instance-id");
        std::fs::create_dir_all(&directory).expect("discovery test directory");
        std::fs::write(&path, "not-an-instance-id").expect("invalid identity");
        let first = load_or_create_instance_id_at(&path).expect("repair identity");
        let second = load_or_create_instance_id_at(&path).expect("reload identity");
        assert!(uuid::Uuid::parse_str(&first).is_ok());
        assert_eq!(first, second);
        std::fs::remove_dir_all(directory).expect("discovery test cleanup");
    }

    #[test]
    fn the_public_url_is_an_exact_origin_and_extends_development_cors() {
        assert_eq!(
            parse_public_url(Some("https://music.example/")).expect("valid origin"),
            Some("https://music.example".to_string())
        );
        assert!(
            allowed_origins_for(Some("https://music.example".into()))
                .contains(&"https://music.example".to_string())
        );
        assert!(secure_cookies_for(Some("https://music.example")));
        assert!(!secure_cookies_for(Some("http://music.lan")));
        assert!(parse_public_url(Some("null")).is_err());
        assert!(parse_public_url(Some("https://music.example/app")).is_err());
        assert!(parse_public_url(Some("https://user@music.example")).is_err());
    }
}
