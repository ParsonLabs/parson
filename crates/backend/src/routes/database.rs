use std::error::Error;
use actix_web::{post, web, HttpResponse, Responder};
use actix_web_httpauth::middleware::HttpAuthentication;

use crate::utils::database::database::redo_migrations;

use super::authentication::admin_guard;

#[post("/redo_migrations")]
async fn redo_migrations_handler() -> Result<impl Responder, Box<dyn Error>> {
    match redo_migrations() {
        Ok(_) => Ok(HttpResponse::Ok().body("Migrations redone successfully")),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("Error redoing migrations: {}", e))),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    let admin = HttpAuthentication::with_fn(admin_guard);

    cfg.service(
      web::scope("/database")
        .wrap(admin)
        .service(redo_migrations_handler)
    );
}
