use actix_web::dev::HttpServiceFactory;
use actix_web::{App, HttpResponse, HttpServer, middleware, web};
use actix_web_httpauth::middleware::HttpAuthentication;
use diesel::connection::SimpleConnection;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::api::auth::{
    admin_guard, create_media_stream_token, is_valid, login, logout, refresh, register, validator,
};
use crate::api::image::image;
use crate::api::library::{
    head_stream_song, index, library_catalog, library_catalog_artists, library_readiness,
    library_refresh, library_roots, remove_library_root, stream_song,
};
use crate::api::{
    album, artist, cast, filesystem, genres, home, lyrics, metadata, playback, playlist, search,
    setup, song, user,
};
use crate::app::LocalApp;
use crate::library::state::LibraryLifecycle;
use crate::{assets, http, settings};

const MAX_JSON_BODY_BYTES: usize = 1024 * 1024;
const MAX_STREAMING_PAYLOAD_BYTES: usize = 6 * 1024 * 1024;
static STARTED_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn uptime_seconds() -> u64 {
    STARTED_AT
        .lock()
        .ok()
        .and_then(|started| started.as_ref().map(Instant::elapsed))
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

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
                .service(remove_library_root),
        )
}

fn music_routes_at(path: &'static str) -> impl HttpServiceFactory {
    web::scope(path)
        .wrap(HttpAuthentication::with_fn(validator))
        .service(create_media_stream_token)
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
    let pool_state = pool.state();
    let database_check = tokio::time::timeout(
        Duration::from_secs(2),
        web::block(move || {
            probe_database(&pool)?;
            crate::persistence::connection::recovery_snapshot_count()
                .map_err(|error| error.to_string())
        }),
    )
    .await;
    let (database_ok, snapshot_count) = match database_check {
        Ok(Ok(Ok(count))) => (true, Some(count)),
        _ => (false, None),
    };
    let library_state = library.readiness().await;
    let library_ok = !matches!(
        library_state.state,
        crate::library::state::LibraryReadinessState::Failed
    );
    let body = serde_json::json!({
        "status": if database_ok && library_ok { "ready" } else { "not_ready" },
        "database": if database_ok { "ok" } else { "unavailable" },
        "library": library_state.state,
        "message": library_state.message,
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": uptime_seconds(),
        "database_pool": {
            "connections": pool_state.connections,
            "idle_connections": pool_state.idle_connections,
        },
        "recovery_snapshots": snapshot_count,
    });
    if database_ok && library_ok {
        HttpResponse::Ok().json(body)
    } else {
        HttpResponse::ServiceUnavailable().json(body)
    }
}

async fn discovery_manifest() -> HttpResponse {
    let instance_id = match settings::instance_id() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "could not load discovery identity");
            return HttpResponse::InternalServerError().finish();
        }
    };
    HttpResponse::Ok().json(serde_json::json!({
        "protocol": "parson",
        "protocolVersion": parson_core::PROTOCOL_VERSION,
        "instanceId": instance_id,
        "name": settings::library_name(),
        "product": "parson-music",
        "serverVersion": env!("CARGO_PKG_VERSION"),
        "pairingRequired": true,
        "capabilities": ["streaming", "downloads", "lyrics", "casting"],
    }))
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
    if let Ok(mut started) = STARTED_AT.lock() {
        *started = Some(Instant::now());
    }
    dotenvy::dotenv().ok();
    settings::validate().map_err(std::io::Error::other)?;
    let local_app =
        LocalApp::open_uninitialized().map_err(|error| std::io::Error::other(error.to_string()))?;
    let startup_library = local_app.library.clone();
    startup_library.set_indexing("Loading library.").await;
    let startup_scan = startup_library
        .try_begin_scan()
        .expect("new library lifecycle has no active scan");
    let database = web::Data::new(local_app.database);
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
                    .service(logout),
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
                            .service(logout),
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

    use super::{MAX_JSON_BODY_BYTES, discovery_manifest, probe_database};

    #[actix_web::test]
    async fn discovery_manifest_identifies_parson_without_exposing_private_data() {
        let response = discovery_manifest().await;
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
