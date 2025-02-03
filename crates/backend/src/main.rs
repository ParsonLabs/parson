mod routes;
mod structures;
mod utils;

use std::io::Write;
use std::{env, io};
use std::error::Error;

use actix_cors::Cors;
use actix_web::HttpResponse;
use actix_web::{middleware, web, App, HttpServer};
use actix_web_httpauth::middleware::HttpAuthentication;
use notify::{Event, RecursiveMode, Watcher};
use routes::authentication::{admin_guard, is_valid, refresh, renew_refresh_token};
use tokio::sync::broadcast;
use tokio::task;
use tracing::{error, info, Level};
use tracing_subscriber::FmtSubscriber;

use routes::{album, database, genres, music};
use routes::artist;
use routes::authentication::{login, register, validator};
use routes::filesystem;
use routes::image::image;
use routes::music::{
    index, index_library_no_cover_url, library_refresh, process_music_library_no_ws, read_library_paths, Libraries 
};
use routes::playlist;
use routes::search::{self, populate_search_data};
use routes::server;
use routes::social;
use routes::song;
use routes::user;
use routes::web as web_routes;

use utils::config::{self, get_libraries_config_path};
use utils::database::database::{migrations_ran, redo_migrations};
use utils::database::database::run_migrations;
// use utils::update::check_for_updates;
use utils::websocket::ws;

use rust_embed::RustEmbed;

// use discord::run_discord;

#[derive(RustEmbed)]
#[folder = "../../apps/web/out"]
struct Asset;

async fn serve_embedded_file(path: web::Path<String>) -> Result<HttpResponse, Box<dyn Error>> {
    let mut file_path = path.into_inner();

    if let Some(content) = Asset::get(&file_path) {
        let body = content.data.into_owned();
        let mime_type = mime_guess::from_path(&file_path).first_or_octet_stream();
        return Ok(HttpResponse::Ok()
            .content_type(mime_type.as_ref())
            .body(body));
    }

    if file_path.is_empty() {
        file_path = "index.html".to_string();
    } else {
        if !file_path.ends_with('/') {
            file_path.push('/');
        }
        file_path.push_str("index.html");
    }

    match Asset::get(&file_path) {
        Some(content) => {
            let body = content.data.into_owned();
            let mime_type = mime_guess::from_path(&file_path).first_or_octet_stream();
            Ok(HttpResponse::Ok()
                .content_type(mime_type.as_ref())
                .body(body))
        }
        None => {
            Ok(HttpResponse::NotFound().body("404 Not Found!"))
        }
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("setting default subscriber failed");

    // let update_result = task::spawn_blocking(|| check_for_updates())
    //     .await
    //     .expect("Checking for Updates Failed! Are you connected to the internet?");

    // if let Err(e) = update_result {
    //     eprintln!("[ERROR] {}", e);
    //     std::process::exit(1);
    // }

    let mut port = 3001;
    let mut redo = false;

    let args: Vec<String> = env::args().collect();
    for i in 0..args.len() {
        if args[i] == "-p" || args[i] == "--port" {
            if i + 1 < args.len() {
                port = args[i + 1].parse().unwrap_or(3001);
            }
        } else if args[i] == "redo" {
            redo = true;
        }
    }

    if redo {
        print!("Are you sure you would like to redo migrations? This will reset the database. (yes/no): ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        let input = input.trim().to_lowercase();

        if input == "yes" || input == "y" {
            match task::spawn_blocking(|| redo_migrations()).await {
                Ok(Ok(())) => println!("Migrations redone successfully."),
                Ok(Err(e)) => eprintln!("Failed to redo migrations: {}", e),
                Err(e) => eprintln!("Task failed: {}", e),
            }
        } else {
            println!("Redo migrations aborted.");
        }
    }

    info!("Starting server on port {}", port); 

    let (tx, _rx) = broadcast::channel(16);
    let tx_clone = tx.clone();

    std::thread::spawn(move || {
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
            Ok(_) => {
                if let Err(e) = tx_clone.send(()) {
                    error!("Failed to send watch event: {}", e);
                }
            }
            Err(e) => error!("Watch error: {}", e),
        }
    }).expect("Failed to create watcher");

    let config_content = std::fs::read_to_string(get_libraries_config_path())
        .expect("Failed to read libraries config");
    let libraries: Libraries = serde_json::from_str(&config_content)
        .expect("Failed to parse libraries config");
    
    for library_path in &libraries.paths {
        let path = std::path::Path::new(library_path);
        let watch_path = path.parent().unwrap_or(path);
    
        watcher.watch(watch_path, RecursiveMode::NonRecursive)
            .expect("Failed to watch library path");

        std::thread::park();
        watcher.watch(watch_path, RecursiveMode::NonRecursive)
            .expect("Failed to watch libraries path");
    }
    
    std::thread::park();
});

    let mut rx = tx.subscribe();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
        
        while rt.block_on(rx.recv()).is_ok() {
            info!("Libraries file changed");
            let paths = rt.block_on(read_library_paths());
                for path in paths {
                    if let Err(e) = rt.block_on(process_music_library_no_ws(&path)) {
                        error!("Failed to process library {}: {}", path, e);
                    }
                }
        }
    });

    task::spawn(async move {
        if !migrations_ran() {
            if let Err(e) = run_migrations() {
                eprintln!("Failed to run migrations: {}", e);
            }
        }
    
        if let Err(e) = populate_search_data().await {
            eprintln!("Failed to populate search data: {}", e);
        }
        // run_modules().await;
    });
    
    HttpServer::new(move || {
        let authentication = HttpAuthentication::with_fn(validator);
        let admin = HttpAuthentication::with_fn(admin_guard);
    
        let protected = web::scope("/api")
            .wrap(authentication)
            .service(music::songs_list)
            .service(music::test)
            .service(music::stream_song)
            .service(music::format_contributing_artists_route)
            .configure(artist::configure)
            .configure(album::configure)
            .configure(song::configure)
            .configure(user::configure)
            .configure(filesystem::configure)
            .configure(search::configure)
            .configure(social::configure)
            .configure(playlist::configure)
            .configure(config::configure)
            .configure(genres::configure)
            .configure(web_routes::configure);    
        
        let library_routes = web::scope("/library")
            .wrap(admin)
            .service(index_library_no_cover_url)
            .service(index)
            .service(library_refresh);

        App::new()
            .wrap(
                Cors::default()
                    .allow_any_origin()
                    .allow_any_method()
                    .allow_any_header()
                    .supports_credentials()
            )
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::default())
            .service(
                web::scope("/api/auth")
                    .service(login)
                    .service(register)
                    .service(refresh)
                    .service(is_valid)
                    .service(renew_refresh_token)
            )
            .service(image)
            .route("/ws", web::get().to(ws))
            .service(
                web::scope("/api/s")
                .configure(server::configure)
            )
            .service(protected)
            .service(library_routes)
            .configure(database::configure)
            .route("/{filename:.*}", web::get().to(serve_embedded_file))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

// async fn run_modules() {
//     run_discord().await;
// }