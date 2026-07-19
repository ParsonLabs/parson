use crate::library::state::{LibraryCache, LibraryLifecycle};

pub async fn initialize_library(lifecycle: &LibraryLifecycle) {
    lifecycle.set_indexing("Loading library.").await;
    match LibraryCache::load_persisted().await {
        Ok(cache) => lifecycle.set_ready(cache).await,
        Err(cache_error) => match LibraryCache::new().await {
            Ok(cache) => lifecycle.set_ready_and_persist(cache).await,
            Err(error) => {
                let is_missing = error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound);
                if is_missing {
                    lifecycle.set_no_library().await;
                } else {
                    let message = format!("Failed to load the indexed library: {error}");
                    tracing::error!(%error, %cache_error, "library initialization failed");
                    lifecycle.set_failed(message).await;
                }
            }
        },
    }
}
