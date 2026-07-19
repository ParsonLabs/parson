use std::collections::HashMap;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;

pub const SERVICE_TYPE: &str = "_parson._tcp.local.";

/// Keeps Parson's DNS-SD advertisement alive for as long as this value exists.
pub struct DiscoveryAdvertisement {
    daemon: ServiceDaemon,
    fullname: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    pub instance_id: String,
    pub name: String,
    pub origin: String,
    pub port: u16,
    pub is_current: bool,
}

impl Drop for DiscoveryAdvertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}

pub fn advertise(port: u16) -> Result<DiscoveryAdvertisement, String> {
    let bind_address = crate::settings::bind_address()?
        .parse::<std::net::IpAddr>()
        .map_err(|error| error.to_string())?;
    if bind_address.is_loopback() {
        return Err("the server is configured for this device only".to_string());
    }
    let instance_id = crate::settings::instance_id().map_err(|error| error.to_string())?;
    let name = crate::settings::library_name();
    let host = format!("parson-{}.local.", &instance_id[..8]);
    let properties = HashMap::from([
        ("id".to_string(), instance_id),
        ("name".to_string(), name.clone()),
        ("version".to_string(), "1".to_string()),
        ("product".to_string(), "parson-music".to_string()),
        ("api".to_string(), "1".to_string()),
        ("tls".to_string(), "0".to_string()),
        ("pairing".to_string(), "required".to_string()),
    ]);
    let service = ServiceInfo::new(SERVICE_TYPE, &name, &host, (), port, properties)
        .map_err(|error| error.to_string())?
        .enable_addr_auto();
    let fullname = service.get_fullname().to_string();
    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    daemon
        .register(service)
        .map_err(|error| error.to_string())?;
    tracing::info!(service = SERVICE_TYPE, %port, %name, "advertising Parson on the local network");
    Ok(DiscoveryAdvertisement { daemon, fullname })
}

/// Searches the local network for Parson libraries for a bounded interval.
pub async fn discover_nearby(timeout: Duration) -> Result<Vec<DiscoveredServer>, String> {
    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + timeout;
    let current_instance_id = crate::settings::instance_id().ok();
    let mut servers = HashMap::<String, DiscoveredServer>::new();

    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        let Ok(event) = tokio::time::timeout(remaining, receiver.recv_async()).await else {
            break;
        };
        let Ok(ServiceEvent::ServiceResolved(info)) = event else {
            continue;
        };
        if info.get_property_val_str("product") != Some("parson-music") {
            continue;
        }
        let Some(instance_id) = info
            .get_property_val_str("id")
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let name = info
            .get_property_val_str("name")
            .filter(|value| !value.is_empty())
            .unwrap_or("Parson Library");
        let Some(address) = info
            .get_addresses_v4()
            .into_iter()
            .find(|address| !address.is_loopback() && !address.is_unspecified())
        else {
            continue;
        };
        let port = info.get_port();
        let mut candidate = discovered_server(instance_id, name, address, port);
        candidate.is_current = current_instance_id.as_deref() == Some(instance_id);
        insert_discovered_server(&mut servers, candidate);
    }

    let _ = daemon.stop_browse(SERVICE_TYPE);
    let _ = daemon.shutdown();
    let mut servers = servers.into_values().collect::<Vec<_>>();
    servers.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(servers)
}

fn discovered_server(
    instance_id: &str,
    name: &str,
    address: std::net::Ipv4Addr,
    port: u16,
) -> DiscoveredServer {
    DiscoveredServer {
        instance_id: instance_id.to_string(),
        name: name.to_string(),
        origin: format!("http://{address}:{port}"),
        port,
        is_current: false,
    }
}

fn insert_discovered_server(
    servers: &mut HashMap<String, DiscoveredServer>,
    candidate: DiscoveredServer,
) {
    match servers.entry(candidate.instance_id.clone()) {
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(candidate);
        }
        std::collections::hash_map::Entry::Occupied(mut entry)
            if candidate.port == crate::settings::DEFAULT_PORT
                && entry.get().port != crate::settings::DEFAULT_PORT =>
        {
            entry.insert(candidate);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn discovered_servers_use_a_direct_browser_origin() {
        let server = super::discovered_server(
            "library-id",
            "Living room",
            "192.168.1.25".parse().unwrap(),
            1993,
        );
        assert_eq!(server.instance_id, "library-id");
        assert_eq!(server.name, "Living room");
        assert_eq!(server.origin, "http://192.168.1.25:1993");
        assert_eq!(server.port, 1993);
        assert!(!server.is_current);
    }

    #[test]
    fn official_port_wins_when_one_library_has_multiple_advertisements() {
        let mut servers = std::collections::HashMap::new();
        super::insert_discovered_server(
            &mut servers,
            super::discovered_server(
                "same-library",
                "Library",
                "192.168.1.25".parse().unwrap(),
                3001,
            ),
        );
        super::insert_discovered_server(
            &mut servers,
            super::discovered_server(
                "same-library",
                "Library",
                "192.168.1.25".parse().unwrap(),
                1993,
            ),
        );
        assert_eq!(servers["same-library"].port, 1993);
    }
}
