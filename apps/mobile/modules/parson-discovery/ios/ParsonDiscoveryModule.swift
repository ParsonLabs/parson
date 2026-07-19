import ExpoModulesCore
import Foundation

private final class ParsonServiceBrowser: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  let browser = NetServiceBrowser()
  var emit: ((String, String, Int) -> Void)?
  override init() { super.init(); browser.delegate = self }
  func start() { browser.searchForServices(ofType: "_parson._tcp.", inDomain: "local.") }
  func stop() { browser.stop() }
  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    service.delegate = self
    service.resolve(withTimeout: 5)
  }
  func netServiceDidResolveAddress(_ sender: NetService) {
    guard let hostname = sender.hostName else { return }
    emit?(sender.name, hostname.hasSuffix(".") ? String(hostname.dropLast()) : hostname, sender.port)
  }
}

public class ParsonDiscoveryModule: Module {
  private let discovery = ParsonServiceBrowser()
  public func definition() -> ModuleDefinition {
    Name("ParsonDiscovery")
    Events("onService")
    OnCreate { self.discovery.emit = { [weak self] name, host, port in self?.sendEvent("onService", ["name": name, "host": host, "port": port]) } }
    Function("start") { self.discovery.start() }
    Function("stop") { self.discovery.stop() }
    OnStartObserving("onService") { self.discovery.start() }
    OnStopObserving("onService") { self.discovery.stop() }
    OnDestroy { self.discovery.stop() }
  }
}
