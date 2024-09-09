use std::sync::Mutex;
use actix_ws::Session;
use lazy_static::lazy_static;

lazy_static! {
    pub static ref GLOBAL_SESSION: Mutex<Option<Session>> = Mutex::new(None);
}