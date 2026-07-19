package com.parsonlabs.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ParsonDiscoveryModule : Module() {
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private val resolved = mutableSetOf<String>()
  private val context: Context get() = requireNotNull(appContext.reactContext)

  private fun startDiscovery() {
    if (discoveryListener != null) return
    val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("parson-discovery").apply { setReferenceCounted(false); acquire() }
    resolved.clear()
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) = Unit
      override fun onDiscoveryStopped(type: String) = Unit
      override fun onStartDiscoveryFailed(type: String, code: Int) { stopDiscovery() }
      override fun onStopDiscoveryFailed(type: String, code: Int) { stopDiscovery() }
      override fun onServiceLost(service: NsdServiceInfo) { resolved.remove(service.serviceName) }
      override fun onServiceFound(service: NsdServiceInfo) {
        if (!service.serviceType.startsWith("_parson._tcp") || !resolved.add(service.serviceName)) return
        @Suppress("DEPRECATION")
        nsd.resolveService(service, object : NsdManager.ResolveListener {
          override fun onResolveFailed(info: NsdServiceInfo, code: Int) { resolved.remove(info.serviceName) }
          override fun onServiceResolved(info: NsdServiceInfo) {
            val host = info.host?.hostAddress ?: info.host?.hostName ?: return
            sendEvent("onService", mapOf("name" to info.serviceName, "host" to host, "port" to info.port))
          }
        })
      }
    }
    discoveryListener = listener
    nsd.discoverServices("_parson._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
  }

  private fun stopDiscovery() {
    val listener = discoveryListener ?: return
    discoveryListener = null
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
