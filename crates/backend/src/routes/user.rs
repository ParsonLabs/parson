use std::error::Error;
use std::fs;
use std::io::Write;

use actix_multipart::Multipart;
use actix_web::{get, post, web, HttpResponse, Responder};
use diesel::{ExpressionMethods, QueryDsl, RunQueryDsl};
use dotenvy::dotenv;
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use crate::routes::authentication::{hash_password, verify_password};
use crate::utils::config::get_profile_picture_path;
use crate::utils::database::database::establish_connection;
use crate::utils::database::models::{ListenHistoryItem, NewListenHistoryItem, User};

#[derive(Deserialize)]
pub struct AuthData {
    username: String,
    current_password: String,
    new_password: String,
}

#[post("/change_password")]
pub async fn change_password(form: web::Json<AuthData>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::user::dsl::*;
    dotenv().ok();

    let mut connection = establish_connection().get().unwrap();

    let stored_password: String = match user
        .filter(username.eq(&form.username))
        .select(password)
        .first::<String>(&mut connection) {
            Ok(return_password) => return_password,
            Err(_) => return Ok(HttpResponse::InternalServerError().body("User not found")),
        };

    if !verify_password(&form.current_password, &stored_password) {
      return Ok(HttpResponse::Unauthorized().body("Current password is incorrect"));
    }

    let hashed_new_password = match hash_password(&form.new_password) {
      Ok(return_password) => return_password,
      Err(e) => return Ok(HttpResponse::InternalServerError().body(format!("Failed to hash new password: {}", e))),
    };

    match diesel::update(user.filter(username.eq(&form.username)))
      .set(password.eq(hashed_new_password))
      .execute(&mut connection) {
        Ok(_) => Ok(HttpResponse::Ok().body("Password changed")),
        Err(_) => Ok(HttpResponse::InternalServerError().body("There was an error updating the password!")),
    }
}

#[derive(Deserialize)]
struct ListenHistoryQuery {
    user_id: i32,
}

pub async fn fetch_listen_history(user_id_param: i32) -> Result<Vec<ListenHistoryItem>, Box<dyn Error>> {
    use crate::utils::database::schema::listen_history_item::dsl::*;

    let mut connection = establish_connection().get()?;

    let results = listen_history_item
        .filter(user_id.eq(user_id_param))
        .load::<ListenHistoryItem>(&mut connection)?;

    Ok(results)
}

#[get("/get_listen_history")]
async fn get_listen_history(query: web::Query<ListenHistoryQuery>) -> Result<HttpResponse, Box<dyn Error>> {
    let results = fetch_listen_history(query.user_id).await?;
    Ok(HttpResponse::Ok().json(results))
}

#[derive(Deserialize)]
struct AddSongRequest {
    user_id: i32,
    song_id: String,
}

#[post("/add_song_to_listen_history")]
async fn add_song_to_listen_history(
    item: web::Json<AddSongRequest>,
) -> Result<HttpResponse, Box<dyn Error>> {
    use crate::utils::database::schema::listen_history_item;

    let mut connection = establish_connection().get().unwrap();

    let new_item = NewListenHistoryItem {
        user_id: item.user_id,
        song_id: item.song_id.clone(),
    };

    diesel::insert_into(listen_history_item::table)
        .values(&new_item)
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Song added to history"))
}

#[derive(Deserialize)]
struct SetBitrateRequest {
    user_id: i32,
    bitrate: i32,
}

#[post("/set_bitrate")]
async fn set_bitrate(
    item: web::Json<SetBitrateRequest>,
) -> impl Responder {
    use crate::utils::database::schema::user::dsl::{user, bitrate};

    let mut connection = establish_connection().get().unwrap();

    diesel::update(user.find(item.user_id))
        .set(bitrate.eq(item.bitrate))
        .execute(&mut connection)
        .expect("Error updating bitrate");

    HttpResponse::Ok().body("Bitrate set")
}

#[derive(Deserialize)]
struct SetNowPlayingRequest {
    user_id: i32,
    now_playing: String,
}

#[post("/set_now_playing")]
async fn set_now_playing(
    item: web::Json<SetNowPlayingRequest>,
) -> impl Responder {
    use crate::utils::database::schema::user::dsl::{user, now_playing};

    let mut connection = establish_connection().get().unwrap();

    diesel::update(user.find(item.user_id))
        .set(now_playing.eq(item.now_playing.clone()))
        .execute(&mut connection)
        .expect("Error updating now playing");

    HttpResponse::Ok().body("Now playing set")
}

#[derive(Deserialize)]
struct GetNowPlayingRequest {
    user_id: i32,
}

#[derive(Serialize)]
struct GetNowPlayingResponse {
    now_playing: Option<String>,
}

#[get("/get_now_playing")]
async fn get_now_playing(
    item: web::Query<GetNowPlayingRequest>,
) -> impl Responder {
    use crate::utils::database::schema::user::dsl::{user, now_playing};

    let mut connection = establish_connection().get().unwrap();

    let result = user
        .find(item.user_id)
        .select(now_playing)
        .first::<Option<String>>(&mut connection)
        .expect("Error loading now playing");

    HttpResponse::Ok().json(GetNowPlayingResponse { now_playing: result })
}

#[get("/info_by_username/{username}")]
async fn get_user_info(path: web::Path<String>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::user::dsl::*;

    let path_username = path.into_inner();
    let mut connection = establish_connection().get().unwrap();

    let recieved_user = user
        .filter(username.eq(&path_username))
        .first::<User>(&mut connection)?;

    Ok(HttpResponse::Ok().json(recieved_user))
}

#[get("/info_by_id/{id}")]
async fn get_user_info_by_id(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::user::dsl::*;

    let path_id = path.into_inner();
    let mut connection = establish_connection().get()?;

    let recieved_user = user
        .filter(id.eq(path_id))
        .first::<User>(&mut connection)?;

    Ok(HttpResponse::Ok().json(recieved_user))
}

#[get("/profile_picture/{id}")]
async fn get_profile_picture(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    let user_id = path.into_inner();
    let mut profile_picture_path = get_profile_picture_path();
    profile_picture_path.push(format!("{}.jpg", user_id));

    if profile_picture_path.exists() {
        let image_data = fs::read(profile_picture_path)?;
        Ok(HttpResponse::Ok().content_type("image/jpeg").body(image_data))
    } else {
        Ok(HttpResponse::NotFound().body("Profile picture not found"))
    }
}

#[post("/profile_picture/{id}")]
async fn upload_profile_picture(mut payload: Multipart, path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    let user_id = path.into_inner();
    let mut profile_picture_path = get_profile_picture_path();
    profile_picture_path.push(format!("{}.jpg", user_id));

    while let Some(item) = payload.next().await {
        let mut field = item?;
        let profile_picture_path_clone = profile_picture_path.clone();
        let mut file = web::block(move || std::fs::File::create(&profile_picture_path_clone)).await??;

        while let Some(chunk) = field.next().await {
            let data = chunk?;
            file = web::block(move || file.write_all(&data).map(|_| file)).await??;
        }
    }

    Ok(HttpResponse::Ok().body("Profile picture uploaded successfully"))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
  cfg.service(
      web::scope("/user")
          .service(change_password)
          .service(get_listen_history)
          .service(add_song_to_listen_history)
          .service(set_bitrate)
          .service(get_now_playing)
          .service(set_now_playing)
          .service(get_user_info)
          .service(get_user_info_by_id)
          .service(get_profile_picture)
          .service(upload_profile_picture)
  );
}