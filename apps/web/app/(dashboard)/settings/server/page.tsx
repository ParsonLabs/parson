"use client"

import { getServerInfo, setServerInfo } from '@music/sdk';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { Button } from "@music/ui/components/button";
import { Input } from "@music/ui/components/input";
import { Label } from "@music/ui/components/label";
import { motion } from "framer-motion";
import { Check, Globe, Server, ServerCrash } from "lucide-react";

export default function ServerPage() {
  const [localAddress, setLocalAddress] = useState('');
  const [serverName, setServerName] = useState('');
  const [loginDisclaimer, setLoginDisclaimer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  useEffect(() => {
    async function fetchServerInfo() {
      try {
        const serverInfo = await getServerInfo();
        setLocalAddress(serverInfo.local_address);
        setServerName(serverInfo.server_name);
        setLoginDisclaimer(serverInfo.login_disclaimer);
      } catch (error) {
        console.error("Failed to fetch server info", error);
      }
    }
  
    fetchServerInfo();
  }, []);

  const { push } = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await setServerInfo(localAddress, serverName, "1.0.0", "ParsonLabs Music", true, loginDisclaimer);
      localStorage.setItem("server", JSON.stringify({ 
        local_address: localAddress, 
        server_name: serverName, 
        version: "1.0.0", 
        product_name: "ParsonLabs Music", 
        startup_wizard_completed: true, 
        login_disclaimer: loginDisclaimer 
      }));
      setSuccessMessage("Server settings updated successfully");

      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (error) {
      console.error("Failed to update server settings", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-white mb-6">Server Configuration</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="bg-zinc-800/50 rounded-lg border border-zinc-700/50 p-6 shadow-inner">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-indigo-600/20">
                <Server className="h-5 w-5 text-indigo-400" />
              </div>
              <h2 className="text-xl font-medium text-white">Server Settings</h2>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="server_name" className="text-gray-200">Server Name</Label>
                  <div className="relative">
                    <Server className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      id="server_name"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      required
                      placeholder="My Music Server"
                      className="pl-10 bg-zinc-900/80 border-zinc-700/50 focus-visible:ring-indigo-500"
                    />
                  </div>
                  <p className="text-xs text-gray-400">This name will be displayed on the login page.</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="local_address" className="text-gray-200">Local Address</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      id="local_address"
                      value={localAddress}
                      onChange={(e) => setLocalAddress(e.target.value)}
                      required
                      placeholder="192.168.1.100:8000"
                      className="pl-10 bg-zinc-900/80 border-zinc-700/50 focus-visible:ring-indigo-500"
                    />
                  </div>
                  <p className="text-xs text-gray-400">The local IP address and port for your server.</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="login_disclaimer" className="text-gray-200">Login Disclaimer</Label>
                  <Input
                    id="login_disclaimer"
                    value={loginDisclaimer}
                    onChange={(e) => setLoginDisclaimer(e.target.value)}
                    placeholder="Enter a disclaimer message for the login page (optional)"
                    className="bg-zinc-900/80 border-zinc-700/50 focus-visible:ring-indigo-500 min-h-[100px]"
                  />
                  <p className="text-xs text-gray-400">Optional message to display on the login screen.</p>
                </div>
              </div>
              
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 rounded-md bg-green-900/40 text-green-300 text-sm"
                >
                  <Check className="h-4 w-4" />
                  {successMessage}
                </motion.div>
              )}
              
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {isSubmitting ? "Updating..." : "Save Server Settings"}
              </Button>
            </form>
          </div>
        </div>
        
        <div>
          <div className="bg-zinc-800/50 rounded-lg border border-zinc-700/50 p-6 shadow-inner h-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-purple-600/20">
                <ServerCrash className="h-5 w-5 text-purple-400" />
              </div>
              <h2 className="text-xl font-medium text-white">Server Status</h2>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-gray-200">Server Online</span>
                </div>
                <p className="mt-2 text-sm text-gray-400">Your server is currently online and accessible.</p>
              </div>
              
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-200">Version</span>
                  <span className="text-sm text-gray-400">1.0.0</span>
                </div>
              </div>
              
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-200">Server Address</span>
                  <code className="text-xs bg-black/30 px-2 py-1 rounded text-gray-300">{localAddress}</code>
                </div>
              </div>
              
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-200">Server Name</span>
                  <span className="text-sm text-gray-400">{serverName}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}