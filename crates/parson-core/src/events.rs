use std::error::Error;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::{FileId, LibraryId, ProductCapability};

pub type ConsumerError = Box<dyn Error + Send + Sync + 'static>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub id: FileId,
    pub library_id: LibraryId,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_at_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum LibraryEvent {
    FileAdded(FileRef),
    FileChanged(FileRef),
    FileRemoved {
        library_id: LibraryId,
        file_id: FileId,
    },
    LibraryUnavailable(LibraryId),
}

/// Product-owned interpretation of Core library events.
pub trait LibraryConsumer: Send + Sync {
    fn capability(&self) -> &ProductCapability;

    fn handle<'a>(
        &'a self,
        event: LibraryEvent,
    ) -> Pin<Box<dyn Future<Output = Result<(), ConsumerError>> + Send + 'a>>;
}

/// Routes an event to consumers registered for its library capability.
pub async fn dispatch(
    capability: &ProductCapability,
    consumers: &[&dyn LibraryConsumer],
    event: LibraryEvent,
) -> Result<usize, ConsumerError> {
    let mut delivered = 0;
    for consumer in consumers {
        if consumer.capability() == capability {
            consumer.handle(event.clone()).await?;
            delivered += 1;
        }
    }
    Ok(delivered)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct Consumer {
        capability: ProductCapability,
        calls: AtomicUsize,
    }

    impl LibraryConsumer for Consumer {
        fn capability(&self) -> &ProductCapability {
            &self.capability
        }

        fn handle<'a>(
            &'a self,
            _event: LibraryEvent,
        ) -> Pin<Box<dyn Future<Output = Result<(), ConsumerError>> + Send + 'a>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })
        }
    }

    #[test]
    fn dispatch_is_capability_owned_not_media_switched() {
        let music = Consumer {
            capability: ProductCapability::new("music").expect("music"),
            calls: AtomicUsize::new(0),
        };
        let video = Consumer {
            capability: ProductCapability::new("video").expect("video"),
            calls: AtomicUsize::new(0),
        };
        let library = LibraryId::from_registration_key("music:/media");
        let event = LibraryEvent::LibraryUnavailable(library);
        let delivered =
            run(dispatch(music.capability(), &[&music, &video], event)).expect("dispatch");
        assert_eq!(delivered, 1);
        assert_eq!(music.calls.load(Ordering::Relaxed), 1);
        assert_eq!(video.calls.load(Ordering::Relaxed), 0);
    }

    fn run<F: Future>(future: F) -> F::Output {
        use std::task::{Context, Poll, Waker};
        let mut context = Context::from_waker(Waker::noop());
        let mut future = std::pin::pin!(future);
        loop {
            if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
                return output;
            }
        }
    }
}
