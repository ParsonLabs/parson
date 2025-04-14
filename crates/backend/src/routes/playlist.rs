use std::error::Error;

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::utils::database::{
    database::establish_connection,
    models::{NewPlaylist, Playlist}
};

#[derive(Deserialize)]
struct AddSongToPlaylistRequest {
    playlist_id: i32,
    song_id: String,
}

#[post("/add_song")]
async fn add_song(item: web::Json<AddSongToPlaylistRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::playlist::dsl::playlist;
    use crate::utils::database::schema::song::dsl::song;
    use crate::utils::database::schema::_playlist_to_song::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let playlist_exists = playlist
        .filter(crate::utils::database::schema::playlist::dsl::id.eq(item.playlist_id))
        .select(crate::utils::database::schema::playlist::dsl::id)
        .first::<i32>(&mut connection)
        .optional()?
        .is_some();

    if !playlist_exists {
        return Ok(HttpResponse::BadRequest().body("Playlist does not exist"));
    }

    let song_exists = song
        .filter(crate::utils::database::schema::song::dsl::id.eq(item.song_id.clone()))
        .select(crate::utils::database::schema::song::dsl::id)
        .first::<String>(&mut connection)
        .optional()?
        .is_some();

    if !song_exists {
        diesel::insert_into(song)
            .values(crate::utils::database::schema::song::dsl::id.eq(item.song_id.clone()))
            .execute(&mut connection)?;
    }

    diesel::insert_into(_playlist_to_song)
        .values((a.eq(item.playlist_id), b.eq(item.song_id.clone())))
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Song added to playlist successfully"))
}

#[derive(Deserialize)]
struct CreatePlaylistRequest {
    user_id: i32,
    name: String,
}



#[post("/create")]
async fn create(item: web::Json<CreatePlaylistRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::playlist::dsl::*;
    use crate::utils::database::schema::_playlist_to_user::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let new_playlist = NewPlaylist {
        name: item.name.clone(),
    };

    diesel::insert_into(playlist)
        .values(&new_playlist)
        .execute(&mut connection)?;
    use diesel::SelectableHelper;
    
    let created_playlist = playlist
        .select(Playlist::as_select())
        .order(id.desc())
        .first::<Playlist>(&mut connection)?;

    diesel::insert_into(_playlist_to_user)
        .values((a.eq(created_playlist.id), b.eq(item.user_id)))
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Playlist created successfully"))
}


#[derive(Deserialize)]
struct DeletePlaylistRequest {
	playlist_id: i32,
}

#[delete("/delete")]
async fn delete(item: web::Json<DeletePlaylistRequest>) -> Result<impl Responder, Box<dyn Error>> {
	use crate::utils::database::schema::playlist::dsl::*;

	let mut connection = establish_connection().get().unwrap();

	diesel::delete(playlist.filter(id.eq(item.playlist_id)))
		.execute(&mut connection)?;

	Ok(HttpResponse::Ok().body("Playlist deleted successfully"))
}

#[get("/info/{playlist}")]
async fn info(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::playlist::dsl::*;
    use crate::utils::database::schema::_playlist_to_song::dsl::{a as song_a, b as song_b, _playlist_to_song};
    use crate::utils::database::schema::_playlist_to_user::dsl::{a as user_a, b as user_b, _playlist_to_user};
    use diesel::sql_types::Timestamp;
    use diesel::dsl::sql;

    let playlist_id = path.into_inner();
    let mut connection = establish_connection().get().unwrap();

    let result = playlist
        .select(Playlist::as_select())
        .filter(id.eq(playlist_id))
        .first::<Playlist>(&mut connection)?;

    let song_infos: Vec<SongInfo> = _playlist_to_song
        .filter(song_a.eq(playlist_id))
        .select((song_b, sql::<Timestamp>("date_added")))
        .load::<(String, NaiveDateTime)>(&mut connection)?
        .into_iter()
        .map(|(song_id, other_date_added)| SongInfo {
            song_id,
            date_added: other_date_added,
        })
        .collect();

    let user_ids: Vec<i32> = _playlist_to_user
        .filter(user_a.eq(playlist_id))
        .select(user_b)
        .load::<i32>(&mut connection)?;

    let response = PlaylistInfoResponse {
        id: result.id,
        name: result.name,
        created_at: result.created_at,
        updated_at: result.updated_at,
        song_infos,
        user_ids,
    };

    Ok(HttpResponse::Ok().json(response))
}

#[derive(Deserialize, Serialize)]
struct SongInfo {
    song_id: String,
    date_added: NaiveDateTime,
}

#[derive(Deserialize, Serialize)]
struct PlaylistInfoResponse {
    id: i32,
    name: String,
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
    song_infos: Vec<SongInfo>,
    user_ids: Vec<i32>,
}

#[get("/list/{id}")]
async fn list(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::playlist::dsl::*;
    use crate::utils::database::schema::_playlist_to_user::dsl::*;

    let user_id = path.into_inner();
    let mut connection = establish_connection().get().unwrap();

    let playlist_ids: Vec<i32> = _playlist_to_user
        .filter(b.eq(user_id))
        .select(a)
        .load::<i32>(&mut connection)?;

    let results = playlist
        .select(Playlist::as_select())
        .filter(id.eq_any(playlist_ids))
        .load::<Playlist>(&mut connection)?;

    Ok(HttpResponse::Ok().json(results))
}


pub fn configure(cfg: &mut web::ServiceConfig) {
	cfg.service(
		web::scope("/playlist")
			.service(add_song)
			 .service(create)
			 .service(delete)
			 .service(info)
			 .service(list)
	);
}