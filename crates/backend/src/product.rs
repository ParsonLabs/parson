//! Parson Music's adapter to the product-neutral Parson Core.

use std::path::Path;

use parson_core::{CoreRegistry, LibraryRegistration, ProductCapability};

use crate::app::AppError;

pub const CAPABILITY_NAME: &str = "music";

pub fn capability() -> ProductCapability {
    ProductCapability::new(CAPABILITY_NAME).expect("the built-in music capability is valid")
}

pub fn core_registry() -> Result<CoreRegistry, AppError> {
    CoreRegistry::open(crate::settings::core_database_path())
}

/// Registers a music root with Core and returns its stable ID.
pub fn register_library_root(path: &Path) -> Result<LibraryRegistration, AppError> {
    let registration = LibraryRegistration::new(path, capability());
    core_registry()?.register(&registration)?;
    Ok(registration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn music_is_registered_as_data_not_a_core_enum_variant() {
        assert_eq!(capability().as_str(), "music");
    }
}
