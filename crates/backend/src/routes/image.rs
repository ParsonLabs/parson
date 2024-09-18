use std::collections::HashMap;
use std::convert::TryInto;
use std::fs::read;

use actix_web::{get, web, Error, HttpRequest, HttpResponse, Responder, Result};
use actix_web::http::header::{CacheControl, CacheDirective};
use ::image::{ImageReader, imageops::FilterType};
use ravif::{Encoder, Img, RGBA8};
use webp::Encoder as WebpEncoder;

#[get("/image/{path:.*}")]
pub async fn image(req: HttpRequest, path: web::Path<String>) -> Result<impl Responder, Error> {
    let file_path = path.into_inner();
    let query = req.query_string();
    let query_params: HashMap<String, String> = web::Query::<HashMap<String, String>>::from_query(query)?.into_inner();
    let raw = query_params.get("raw").map_or(false, |v| v == "true");

    if raw {
        match read(&file_path) {
            Ok(data) => Ok(HttpResponse::Ok()
                .content_type("image/png")
                .insert_header(CacheControl(vec![
                    CacheDirective::Public,
                    CacheDirective::MaxAge(604800),
                ]))
                .body(data)),
            Err(_) => Ok(HttpResponse::NoContent().body("Image not found")),
        }
    } else {
        let img = match ImageReader::open(&file_path)?.decode() {
            Ok(img) => img,
            Err(_) => return serve_raw_image(&file_path),
        };

        let resized_img = img.resize(400, 400, FilterType::CatmullRom);

        let mut bytes: Vec<u8> = Vec::new();
        let content_type = match query_params.get("format").map(|s| s.as_str()) {
            Some("webp") => {
                match WebpEncoder::from_image(&resized_img) {
                    Ok(encoder) => {
                        let webp_data = encoder.encode(75.0);
                        bytes.extend_from_slice(&webp_data);
                        "image/webp"
                    },
                    Err(_) => return serve_raw_image(&file_path),
                }
            },
            Some("avif") => {
                let pixels: Vec<RGBA8> = resized_img.to_rgba8().pixels().map(|p| RGBA8::new(p[0], p[1], p[2], p[3])).collect();
                let width: usize = resized_img.width().try_into().unwrap();
                let height: usize = resized_img.height().try_into().unwrap();
                let img = Img::new(&pixels[..], width, height);
                match Encoder::new()
                    .with_quality(50.0)
                    .with_speed(6)
                    .encode_rgba(img) {
                    Ok(avif_data) => {
                        bytes.extend_from_slice(&avif_data.avif_file);
                        "image/avif"
                    },
                    Err(_) => return serve_raw_image(&file_path),
                }
            },
            _ => {
                match WebpEncoder::from_image(&resized_img) {
                    Ok(encoder) => {
                        let webp_data = encoder.encode(75.0);
                        bytes.extend_from_slice(&webp_data);
                        "image/webp"
                    },
                    Err(_) => return serve_raw_image(&file_path),
                }
            }
        };

        Ok(HttpResponse::Ok()
            .content_type(content_type)
            .insert_header(CacheControl(vec![
                CacheDirective::Public,
                CacheDirective::MaxAge(604800),
            ]))
            .body(bytes))
    }
}

fn serve_raw_image(file_path: &str) -> Result<HttpResponse, Error> {
    match read(file_path) {
        Ok(data) => Ok(HttpResponse::Ok()
            .content_type("image/png")
            .insert_header(CacheControl(vec![
                CacheDirective::Public,
                CacheDirective::MaxAge(604800),
            ]))
            .body(data)),
        Err(_) => Ok(HttpResponse::NoContent().body("Image not found")),
    }
}