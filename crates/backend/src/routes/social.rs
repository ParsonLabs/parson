use std::error::Error;

use actix_web::{get, post, web, HttpResponse, Responder};
use diesel::prelude::*;
use serde::Deserialize;

use crate::utils::database::database::establish_connection;

#[derive(Deserialize)]
struct FollowRequest {
    follower_id: i32,
    following_id: i32,
}

#[post("/follow")]
async fn follow(item: web::Json<FollowRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::follow::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    diesel::insert_into(follow)
        .values((follower_id.eq(item.follower_id), following_id.eq(item.following_id)))
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Followed successfully"))
}

#[get("/followers/{user_id}")]
async fn get_followers(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::follow::dsl::*;

    let user_id = path.into_inner();
    let mut connection = establish_connection().get().unwrap();

    let results = follow
        .filter(following_id.eq(user_id))
        .select(follower_id)
        .load::<i32>(&mut connection)?;

    Ok(HttpResponse::Ok().json(results))
}

#[get("/following/{user_id}")]
async fn get_following(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::follow::dsl::*;

    let user_id = path.into_inner();
    let mut connection = establish_connection().get().unwrap();

    let results = follow
        .filter(follower_id.eq(user_id))
        .select(following_id)
        .load::<i32>(&mut connection)?;

    Ok(HttpResponse::Ok().json(results))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
  cfg.service(
    web::scope("/social")
    .service(follow)
    .service(get_followers)
    .service(get_following)
  );
}