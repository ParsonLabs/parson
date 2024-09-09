use std::error::Error;

use actix_web::{get, post, web, HttpResponse, Responder};
use diesel::prelude::*;
use diesel::result::Error as DieselError;

use crate::utils::database::{database::establish_connection, models::ServerInfo};

#[get("/info")]
async fn get_server_info() -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::server_info::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    match server_info.select(ServerInfo::as_select()).first::<ServerInfo>(&mut connection) {
        Ok(server_info_data) => Ok(HttpResponse::Ok().json(server_info_data)),
        Err(DieselError::NotFound) => Ok(HttpResponse::NotFound().body("Server info not found")),
        Err(e) => Err(Box::new(e)),
    }
}

#[post("/info")]
async fn set_server_info(info: web::Json<ServerInfo>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::server_info::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let new_info = ServerInfo {
        local_address: info.local_address.clone(),
        server_name: info.server_name.clone(),
        version: info.version.clone(),
        product_name: info.product_name.clone(),
        startup_wizard_completed: info.startup_wizard_completed,
        login_disclaimer: info.login_disclaimer.clone(),
    };

    diesel::insert_into(server_info)
        .values(&new_info)
        .on_conflict((server_name, local_address))
        .do_update()
        .set(&new_info)
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Server info set successfully"))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/server")
            .service(get_server_info)
            .service(set_server_info)
    );
}