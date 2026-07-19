use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::LibraryId;

/// An installable product capability represented as extensible data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProductCapability(String);

impl ProductCapability {
    pub fn new(value: impl Into<String>) -> Result<Self, &'static str> {
        let value = value.into();
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err("product capabilities must use lowercase kebab-case");
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ProductCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRegistration {
    pub id: LibraryId,
    pub path: PathBuf,
    pub capability: ProductCapability,
    pub display_name: Option<String>,
    pub enabled: bool,
}

impl LibraryRegistration {
    pub fn new(path: impl Into<PathBuf>, capability: ProductCapability) -> Self {
        let path = path.into();
        let key = format!("{}:{}", capability.as_str(), normalized_path(&path));
        Self {
            id: LibraryId::from_registration_key(&key),
            path,
            capability,
            display_name: None,
            enabled: true,
        }
    }
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_identity_includes_the_product_capability() {
        let music = LibraryRegistration::new(
            "/media",
            ProductCapability::new("music").expect("capability"),
        );
        let video = LibraryRegistration::new(
            "/media",
            ProductCapability::new("video").expect("capability"),
        );
        assert_ne!(music.id, video.id);
    }

    #[test]
    fn capability_is_extensible_without_core_product_variants() {
        assert_eq!(
            ProductCapability::new("audiobooks")
                .expect("capability")
                .as_str(),
            "audiobooks"
        );
        assert!(ProductCapability::new("Music").is_err());
    }
}
