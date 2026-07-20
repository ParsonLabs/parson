package com.parsonlabs.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val MAX_DISCOVERED_SERVICES = 64

class ParsonDiscoveryModule : Module() {
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private val resolved = mutableSetOf<String>()
  private val resolutionQueue = ArrayDeque<Pair<String, NsdServiceInfo>>()
  private var resolutionInFlight = false
  private var resolutionGeneration = 0
  private val context: Context get() = requireNotNull(appContext.reactContext)

  private fun resolveNext(nsd: NsdManager, generation: Int) {
    if (
      generation != resolutionGeneration ||
      resolutionInFlight ||
      discoveryListener == null
    ) return
    val (key, service) = resolutionQueue.removeFirstOrNull() ?: return
    resolutionInFlight = true
    @Suppress("DEPRECATION")
    try {
      nsd.resolveService(service, object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
          if (generation != resolutionGeneration) return
          resolutionInFlight = false
          resolved.remove(key)
          resolveNext(nsd, generation)
        }

        override fun onServiceResolved(info: NsdServiceInfo) {
          if (generation != resolutionGeneration) return
          resolutionInFlight = false
          val host = info.host?.hostAddress ?: info.host?.hostName
          if (host == null || info.port !in 1..65535) {
            resolved.remove(key)
          } else if (discoveryListener != null && resolved.contains(key)) {
            sendEvent(
              "onService",
              mapOf("name" to info.serviceName, "host" to host, "port" to info.port),
            )
          }
          resolveNext(nsd, generation)
        }
      })
    } catch (_: RuntimeException) {
      resolutionInFlight = false
      resolved.remove(key)
      resolveNext(nsd, generation)
    }
  }

  private fun startDiscovery() {
    if (discoveryListener != null) return
    val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
    val wifi =
      context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    val generation = ++resolutionGeneration
    resolutionQueue.clear()
    resolutionInFlight = false
    multicastLock = try {
      wifi.createMulticastLock("parson-discovery").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: RuntimeException) {
      return
    }
    resolved.clear()
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) = Unit
      override fun onDiscoveryStopped(type: String) = Unit
      override fun onStartDiscoveryFailed(type: String, code: Int) { stopDiscovery() }
      override fun onStopDiscoveryFailed(type: String, code: Int) { stopDiscovery() }
      override fun onServiceLost(service: NsdServiceInfo) {
        val key = "${service.serviceName}|${service.serviceType}"
        resolved.remove(key)
        resolutionQueue.removeAll { it.first == key }
      }
      override fun onServiceFound(service: NsdServiceInfo) {
        val key = "${service.serviceName}|${service.serviceType}"
        if (
          !service.serviceType.startsWith("_parson._tcp") ||
          (!resolved.contains(key) && resolved.size >= MAX_DISCOVERED_SERVICES) ||
          !resolved.add(key)
        ) return
        resolutionQueue.addLast(key to service)
        resolveNext(nsd, generation)
      }
    }
    discoveryListener = listener
    try {
      nsd.discoverServices("_parson._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (_: RuntimeException) {
      discoveryListener = null
      resolutionGeneration += 1
      resolutionQueue.clear()
      resolutionInFlight = false
      runCatching { multicastLock?.release() }
      multicastLock = null
    }
  }

  private fun stopDiscovery() {
    val listener = discoveryListener ?: return
    discoveryListener = null
    resolutionGeneration += 1
    resolutionQueue.clear()
    resolutionInFlight = false
    runCatching { (context.getSystemService(Context.NSD_SERVICE) as NsdManager).stopServiceDiscovery(listener) }
    runCatching { multicastLock?.release() }
    multicastLock = null
  }

  override fun definition() = ModuleDefinition {
    Name("ParsonDiscovery")
    Events("onService")
    Function("start") { startDiscovery() }
    Function("stop") { stopDiscovery() }
    OnStartObserving("onService") { startDiscovery() }
    OnStopObserving("onService") { stopDiscovery() }
    OnDestroy { stopDiscovery() }
  }
}
