//! Product-neutral building blocks shared by Parson products.

mod events;
mod ids;
mod library;
mod registry;

pub use events::{ConsumerError, FileRef, LibraryConsumer, LibraryEvent, dispatch};
pub use ids::{FileId, LibraryId};
pub use library::{LibraryRegistration, ProductCapability};
pub use registry::CoreRegistry;

/// Protocol version for the product-neutral Core API and discovery manifest.
pub const PROTOCOL_VERSION: u16 = 1;
