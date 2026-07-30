use actix_web::dev::HttpServiceFactory;
use actix_web::{App, HttpRequest, HttpResponse, HttpServer, middleware, web};
use actix_web_httpauth::middleware::HttpAuthentication;
use diesel::connection::SimpleConnection;
use sha2::{Digest, Sha256};
use std::time::Duration;

use crate::api::auth::{
    admin_guard, approve_pairing, create_media_stream_token, is_valid, login, logout,
    pairing_status, refresh, register, start_pairing, validator,
};
use crate::api::image::{create_signed_image_url, image};
use crate::api::library::{
    head_stream_song, index, library_catalog, library_catalog_artists,
    library_classification_diagnostics, library_readiness, library_refresh, library_roots,
    remove_library_root, stream_song,
};
use crate::api::{
    album, artist, cast, data, filesystem, genres, home, lyrics, metadata, playback, playlist,
    search, setup, song, user,
};
use crate::app::LocalApp;
use crate::library::state::LibraryLifecycle;
use crate::{assets, http, settings};

const MAX_JSON_BODY_BYTES: usize = 1024 * 1024;
const MAX_STREAMING_PAYLOAD_BYTES: usize = 6 * 1024 * 1024;
const DESKTOP_CHALLENGE_HEADER: &str = "x-parson-desktop-challenge";

fn library_routes_at(path: &'static str) -> impl HttpServiceFactory {
    web::scope(path)
        .service(library_readiness)
        .service(
            web::scope("/catalog")
                .wrap(HttpAuthentication::with_fn(validator))
                .service(library_catalog)
                .service(library_catalog_artists),
        )
        .service(
            web::scope("")
                .wrap(HttpAuthentication::with_fn(admin_guard))
                .service(index)
                .service(library_refresh)
                .service(library_roots)
                .service(library_classification_diagnostics)
                .service(remove_library_root),
        )
}

fn music_routes_at(path: &'static str) -> impl HttpServiceFactory {
    web::scope(path)
        .wrap(HttpAuthentication::with_fn(validator))
        .service(create_media_stream_token)
        .service(create_signed_image_url)
        .service(head_stream_song)
        .service(stream_song)
        .service(
            web::scope("/filesystem")
                .wrap(HttpAuthentication::with_fn(admin_guard))
                .configure(filesystem::configure_admin),
        )
        .service(
            web::scope("/metadata")
                .wrap(HttpAuthentication::with_fn(admin_guard))
                .service(metadata::edit_library_metadata)
                .service(metadata::edit_album_metadata)
                .service(metadata::upload_album_cover),
        )
        .service(
            web::scope("/data/admin")
                .wrap(HttpAuthentication::with_fn(admin_guard))
                .configure(data::configure_admin),
        )
        .service(web::scope("/data").configure(data::configure_personal))
        .configure(artist::configure)
        .configure(album::configure)
        .configure(song::configure)
        .configure(user::configure)
        .configure(search::configure)
        .configure(playlist::configure)
        .configure(playback::configure)
        .configure(cast::configure)
        .configure(genres::configure)
        .configure(home::configure)
        .configure(lyrics::configure)
}

async fn core_libraries() -> HttpResponse {
    let registry = match crate::product::core_registry() {
        Ok(registry) => registry,
        Err(error) => {
            tracing::error!(%error, "could not open Core registry");
            return HttpResponse::InternalServerError().finish();
        }
    };
    match web::block(move || registry.libraries()).await {
        Ok(Ok(libraries)) => HttpResponse::Ok().json(libraries),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not read Core library registrations");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "Core library registry task stopped");
            HttpResponse::InternalServerError().finish()
        }
    }
}

fn probe_database(pool: &crate::persistence::connection::DbPool) -> Result<(), String> {
    let mut connection = pool
        .try_get()
        .ok_or_else(|| "database pool has no immediately available connection".to_string())?;
    connection
        .batch_execute("SELECT 1")
        .map_err(|error| error.to_string())
}

async fn readiness(
    database: web::Data<crate::persistence::connection::DbPool>,
    library: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let pool = database.get_ref().clone();
    let database_check = tokio::time::timeout(
        Duration::from_secs(2),
        web::block(move || {
            probe_database(&pool)?;
            crate::persistence::connection::recovery_snapshot_count()
                .map_err(|error| error.to_string())
        }),
    )
    .await;
    let database_ok = matches!(database_check, Ok(Ok(Ok(_))));
    let library_state = library.readiness().await;
    let library_ok = !matches!(
        &library_state.state,
        crate::library::state::LibraryReadinessState::Failed
    );
    let body = public_readiness_body(database_ok, library_state.state);
    if database_ok && library_ok {
        HttpResponse::Ok().json(body)
    } else {
        HttpResponse::ServiceUnavailable().json(body)
    }
}

fn public_readiness_body(
    database_ok: bool,
    library_state: crate::library::state::LibraryReadinessState,
) -> serde_json::Value {
    let library_ok = !matches!(
        &library_state,
        crate::library::state::LibraryReadinessState::Failed
    );
    serde_json::json!({
        "status": if database_ok && library_ok { "ready" } else { "not_ready" },
        "database": if database_ok { "ok" } else { "unavailable" },
        "library": library_state,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

fn desktop_instance_proof(secret: &str, challenge: &str) -> Option<String> {
    if secret.len() < 32
        || !(32..=128).contains(&challenge.len())
        || !challenge.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    const BLOCK_BYTES: usize = 64;
    let secret = secret.as_bytes();
    let mut key = [0_u8; BLOCK_BYTES];
    if secret.len() > BLOCK_BYTES {
        key[..32].copy_from_slice(&Sha256::digest(secret));
    } else {
        key[..secret.len()].copy_from_slice(secret);
    }
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for offset in 0..BLOCK_BYTES {
        inner_pad[offset] ^= key[offset];
        outer_pad[offset] ^= key[offset];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(challenge.as_bytes());
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner.finalize());
    Some(
        outer
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

async fn discovery_manifest(request: HttpRequest) -> HttpResponse {
    let instance_id = match settings::instance_id() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "could not load discovery identity");
            return HttpResponse::InternalServerError().finish();
        }
    };
    let mut manifest = serde_json::json!({
        "protocol": "parson",
        "protocolVersion": parson_core::PROTOCOL_VERSION,
        "instanceId": instance_id,
        "name": settings::library_name(),
        "product": "parson-music",
        "serverVersion": env!("CARGO_PKG_VERSION"),
        "pairingRequired": true,
        "capabilities": ["streaming", "downloads", "lyrics", "casting"],
    });
    if let (Ok(secret), Some(challenge)) = (
        std::env::var("PARSON_DESKTOP_INSTANCE_TOKEN"),
        request
            .headers()
            .get(DESKTOP_CHALLENGE_HEADER)
            .and_then(|value| value.to_str().ok()),
    ) && let Some(proof) = desktop_instance_proof(&secret, challenge)
    {
        manifest["desktopProof"] = serde_json::Value::String(proof);
    }
    HttpResponse::Ok().json(manifest)
}

async fn nearby_servers() -> HttpResponse {
    match crate::discovery::discover_nearby(Duration::from_millis(1_500)).await {
        Ok(servers) => HttpResponse::Ok().json(servers),
        Err(error) => {
            tracing::warn!(%error, "nearby Parson discovery failed");
            HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": "discovery_unavailable",
                "message": "Nearby discovery is unavailable on this device."
            }))
        }
    }
}

/// Builds and binds the HTTP server without awaiting it.
pub async fn build_server() -> std::io::Result<(actix_web::dev::Server, u16)> {
    build_server_with_shutdown_timeout(Duration::from_secs(30)).await
}

/// Builds the HTTP server with a caller-selected shutdown deadline.
pub async fn build_server_with_shutdown_timeout(
    shutdown_timeout: Duration,
) -> std::io::Result<(actix_web::dev::Server, u16)> {
    dotenvy::dotenv().ok();
    settings::apply_staged_reset()?;
    settings::apply_staged_restore()?;
    settings::validate().map_err(std::io::Error::other)?;
    let local_app =
        LocalApp::open_uninitialized().map_err(|error| std::io::Error::other(error.to_string()))?;
    let startup_library = local_app.library.clone();
    startup_library.set_indexing("Loading library.").await;
    let startup_scan = startup_library
        .try_begin_scan()
        .expect("new library lifecycle has no active scan");
    let database = web::Data::new(local_app.database);
    data::start_automatic_backups(database.get_ref().clone());
    let library = web::Data::from(local_app.library);
    let lyrics_service = web::Data::new(
        lyrics::LyricsService::new()
            .map_err(|error| std::io::Error::other(format!("lyrics client: {error}")))?,
    );
    {
        let service = lyrics_service.clone();
        tokio::spawn(async move {
            crate::startup::initialize_library(&startup_library).await;
            drop(startup_scan);
            crate::api::library::start_automatic_library_refresh(startup_library.clone());
            let Ok(cache) = startup_library.cache().await else {
                return;
            };
            match service.backfill_search_index(cache).await {
                Ok(indexed) if indexed > 0 => {
                    tracing::info!(indexed, "backfilled stored lyrics search index")
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "stored lyrics search backfill failed"),
            }
        });
    }
    let bind_port = settings::port().map_err(std::io::Error::other)?;
    let bind_address = settings::bind_address().map_err(std::io::Error::other)?;
    let worker_count = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get().clamp(2, 4))
        .unwrap_or(2);
    tracing::info!(address = %bind_address, port = bind_port, worker_count, "starting Parson server");

    let server = HttpServer::new(move || {
        App::new()
            .app_data(database.clone())
            .app_data(library.clone())
            .app_data(lyrics_service.clone())
            .app_data(web::JsonConfig::default().limit(MAX_JSON_BODY_BYTES))
            .app_data(web::PayloadConfig::new(MAX_STREAMING_PAYLOAD_BYTES))
            .wrap(http::cors())
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::default())
            .wrap(middleware::from_fn(http::request_context))
            .service(
                web::scope("/api/v1/auth")
                    .service(login)
                    .service(register)
                    .service(refresh)
                    .service(is_valid)
                    .service(logout)
                    .service(start_pairing)
                    .service(pairing_status)
                    .service(
                        web::scope("")
                            .wrap(HttpAuthentication::with_fn(validator))
                            .service(approve_pairing),
                    ),
            )
            .service(web::scope("/api/v1/setup").configure(setup::configure))
            .route("/api/v1/discovery/nearby", web::get().to(nearby_servers))
            .route(
                "/api/v1/cast/media/{song}/stream",
                web::get().to(cast::cast_media),
            )
            .service(library_routes_at("/api/v1/library"))
            .service(music_routes_at("/api/v1"))
            .service(
                web::scope("/api/core/v1")
                    .service(
                        web::scope("/accounts")
                            .service(login)
                            .service(register)
                            .service(refresh)
                            .service(is_valid)
                            .service(logout)
                            .service(start_pairing)
                            .service(pairing_status)
                            .service(
                                web::scope("")
                                    .wrap(HttpAuthentication::with_fn(validator))
                                    .service(approve_pairing),
                            ),
                    )
                    .service(web::scope("/setup").configure(setup::configure))
                    .route("/discovery/nearby", web::get().to(nearby_servers))
                    .service(
                        web::resource("/libraries")
                            .wrap(HttpAuthentication::with_fn(admin_guard))
                            .route(web::get().to(core_libraries)),
                    ),
            )
            .service(library_routes_at("/api/music/v1/library"))
            .service(music_routes_at("/api/music/v1"))
            .service(image)
            .route(
                "/health",
                web::get().to(|| async { HttpResponse::Ok().finish() }),
            )
            .route("/health/ready", web::get().to(readiness))
            .route("/.well-known/parson", web::get().to(discovery_manifest))
            .route(
                "/{filename:.*}",
                web::head().to(assets::serve_embedded_file),
            )
            .route("/{filename:.*}", web::get().to(assets::serve_embedded_file))
    })
    .workers(worker_count)
    .keep_alive(Duration::from_secs(75))
    .client_request_timeout(Duration::from_secs(15))
    .client_disconnect_timeout(Duration::from_secs(5))
    .shutdown_timeout(shutdown_timeout.as_secs())
    .bind((bind_address, bind_port))?
    .run();

    Ok((server, bind_port))
}

pub async fn run() -> std::io::Result<()> {
    let (server, port) = build_server().await?;
    let _advertisement = match crate::discovery::advertise(port) {
        Ok(advertisement) => Some(advertisement),
        Err(error) => {
            if error == "the server is configured for this device only" {
                tracing::info!("local discovery is disabled for a loopback-only server");
            } else {
                tracing::warn!(%error, "local discovery is unavailable");
            }
            None
        }
    };
    let result = server.await;
    crate::persistence::connection::mark_clean_shutdown();
    result
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use actix_web::{App, HttpResponse, http::StatusCode, test, web};
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;

    use super::{
        MAX_JSON_BODY_BYTES, desktop_instance_proof, discovery_manifest, probe_database,
        public_readiness_body,
    };

    #[actix_web::test]
    async fn discovery_manifest_identifies_parson_without_exposing_private_data() {
        let response = discovery_manifest(test::TestRequest::get().to_http_request()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("manifest body");
        let value: serde_json::Value = serde_json::from_slice(&body).expect("manifest json");
        assert_eq!(value["protocol"], "parson");
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["product"], "parson-music");
        assert!(
            value["instanceId"]
                .as_str()
                .is_some_and(|id| !id.is_empty())
        );
        assert!(value.get("libraryPath").is_none());
        assert!(value.get("desktopProof").is_none());
    }

    #[actix_web::test]
    async fn desktop_instance_proofs_are_secret_bound_and_validate_challenges() {
        let challenge = "a".repeat(64);
        let first =
            desktop_instance_proof(&"1".repeat(64), &challenge).expect("valid desktop proof");
        let second =
            desktop_instance_proof(&"2".repeat(64), &challenge).expect("second desktop proof");
        assert_eq!(first.len(), 64);
        assert_eq!(
            first,
            "c04f7260c84377afa8e5f1ec17f05215da0a1761b0187213d5d3b6dacb168e4d"
        );
        assert_ne!(first, second);
        assert!(desktop_instance_proof("short", &challenge).is_none());
        assert!(desktop_instance_proof(&"1".repeat(64), "not-hex").is_none());
    }

    #[actix_web::test]
    async fn public_readiness_omits_host_diagnostics_and_failure_details() {
        let body =
            public_readiness_body(false, crate::library::state::LibraryReadinessState::Failed);
        for private in [
            "message",
            "database_pool",
            "recovery_snapshots",
            "uptime_seconds",
        ] {
            assert!(body.get(private).is_none(), "{private} must stay private");
        }
        assert_eq!(body["status"], "not_ready");
    }

    async fn accept_json(_: web::Json<serde_json::Value>) -> HttpResponse {
        HttpResponse::NoContent().finish()
    }

    #[actix_web::test]
    async fn oversized_json_is_rejected_before_the_handler() {
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(MAX_JSON_BODY_BYTES))
                .route("/json", web::post().to(accept_json)),
        )
        .await;
        let payload = format!("{{\"value\":\"{}\"}}", "x".repeat(MAX_JSON_BODY_BYTES));
        let request = test::TestRequest::post()
            .uri("/json")
            .insert_header(("content-type", "application/json"))
            .set_payload(payload)
            .to_request();

        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[actix_web::test]
    async fn catalog_routes_live_under_the_library_resource() {
        let app = test::init_service(
            App::new().service(
                web::scope("/api/v1/library")
                    .service(super::library_readiness)
                    .service(
                        web::scope("/catalog")
                            .service(super::library_catalog)
                            .service(super::library_catalog_artists),
                    ),
            ),
        )
        .await;

        for path in ["/api/v1/library/catalog", "/api/v1/library/catalog/artists"] {
            let response =
                test::call_service(&app, test::TestRequest::get().uri(path).to_request()).await;
            assert_ne!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }

        let obsolete = test::call_service(
            &app,
            test::TestRequest::get().uri("/api/v1/catalog").to_request(),
        )
        .await;
        assert_eq!(obsolete.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn library_refresh_is_registered_at_its_public_api_path() {
        let app =
            test::init_service(App::new().service(super::library_routes_at("/api/v1/library")))
                .await;

        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/v1/library/refresh")
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn library_root_removal_is_registered_at_its_public_api_path() {
        let app =
            test::init_service(App::new().service(super::library_routes_at("/api/v1/library")))
                .await;

        let response = test::call_service(
            &app,
            test::TestRequest::delete()
                .uri("/api/v1/library/roots?path=%2Fsrv%2Faudio")
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn music_catalog_is_available_only_in_product_or_legacy_namespaces() {
        let app = test::init_service(
            App::new()
                .service(super::library_routes_at("/api/v1/library"))
                .service(super::library_routes_at("/api/music/v1/library")),
        )
        .await;

        for path in ["/api/v1/library/catalog", "/api/music/v1/library/catalog"] {
            let response =
                test::call_service(&app, test::TestRequest::get().uri(path).to_request()).await;
            assert_ne!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }

        let core_path = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/core/v1/library/catalog")
                .to_request(),
        )
        .await;
        assert_eq!(core_path.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn database_probe_is_immediate_when_the_pool_is_exhausted() {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Arc::new(
            Pool::builder()
                .max_size(1)
                .build(manager)
                .expect("readiness test pool"),
        );
        assert!(probe_database(&pool).is_ok());

        let held = pool.get().expect("held readiness connection");
        assert!(probe_database(&pool).is_err());
        drop(held);
        assert!(probe_database(&pool).is_ok());
    }
}
