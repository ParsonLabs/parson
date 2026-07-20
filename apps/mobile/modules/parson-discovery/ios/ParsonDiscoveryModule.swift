import ExpoModulesCore
import Foundation

private let maxDiscoveredServices = 64

private final class ParsonServiceBrowser: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  let browser = NetServiceBrowser()
  var emit: ((String, String, Int) -> Void)?
  private var services: [String: NetService] = [:]
  private var started = false
  override init() { super.init(); browser.delegate = self }
  func start() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.start() }
      return
    }
    guard !started else { return }
    started = true
    browser.searchForServices(ofType: "_parson._tcp.", inDomain: "local.")
  }
  func stop() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.stop() }
      return
    }
    guard started else { return }
    started = false
    browser.stop()
    services.values.forEach { $0.stop() }
    services.removeAll()
  }
  private func key(for service: NetService) -> String {
    "\(service.name)|\(service.type)|\(service.domain)"
  }
  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    let serviceKey = key(for: service)
    guard services[serviceKey] == nil, services.count < maxDiscoveredServices else { return }
    services[serviceKey] = service
    service.delegate = self
    service.resolve(withTimeout: 5)
  }
  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    let serviceKey = key(for: service)
    guard services[serviceKey] === service else { return }
    services.removeValue(forKey: serviceKey)?.stop()
  }
  func netServiceBrowserDidStopSearch(_ browser: NetServiceBrowser) {
    started = false
    services.values.forEach { $0.stop() }
    services.removeAll()
  }
  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    started = false
    services.values.forEach { $0.stop() }
    services.removeAll()
  }
  func netServiceDidResolveAddress(_ sender: NetService) {
    let serviceKey = key(for: sender)
    guard started, services[serviceKey] === sender else { return }
    defer { services.removeValue(forKey: serviceKey) }
    guard let hostname = sender.hostName, sender.port > 0 else { return }
    emit?(sender.name, hostname.hasSuffix(".") ? String(hostname.dropLast()) : hostname, sender.port)
  }
  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    let serviceKey = key(for: sender)
    if services[serviceKey] === sender {
      services.removeValue(forKey: serviceKey)
    }
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
