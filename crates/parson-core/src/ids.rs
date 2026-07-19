use std::fmt;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

fn stable_id(namespace: &str, value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(namespace.as_bytes());
    digest.update([0]);
    digest.update(value.as_bytes());
    URL_SAFE_NO_PAD.encode(&digest.finalize()[..18])
}

macro_rules! stable_identifier {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self, &'static str> {
                let value = value.into();
                if value.is_empty()
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                {
                    return Err("Parson IDs must be non-empty URL-safe strings");
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

stable_identifier!(LibraryId);
stable_identifier!(FileId);

impl LibraryId {
    /// Derives a stable identifier from a host-owned registration key.
    pub fn from_registration_key(key: &str) -> Self {
        Self(stable_id("parson-library", key))
    }
}

impl FileId {
    /// Derives a stable file identity within a library. `identity` should be a
    /// platform file identity when one exists and a normalized path otherwise.
    pub fn within(library: &LibraryId, identity: &str) -> Self {
        Self(stable_id(
            "parson-file",
            &format!("{}\0{identity}", library.as_str()),
        ))
    }

    pub fn from_path(library: &LibraryId, path: &Path) -> Self {
        Self::within(library, &path.to_string_lossy().replace('\\', "/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_stable_and_library_scoped() {
        let music = LibraryId::from_registration_key("music:/srv/media");
        let video = LibraryId::from_registration_key("video:/srv/media");
        assert_eq!(music, LibraryId::from_registration_key("music:/srv/media"));
        assert_ne!(
            FileId::from_path(&music, Path::new("/srv/media/item.bin")),
            FileId::from_path(&video, Path::new("/srv/media/item.bin"))
        );
    }

    #[test]
    fn externally_loaded_ids_are_validated() {
        assert!(LibraryId::parse("library_123").is_ok());
        assert!(LibraryId::parse("../library").is_err());
    }
}
