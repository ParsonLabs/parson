"use client"

import { getServerInfo, setServerInfo } from '@music/sdk';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';


export default function ServerPage() {

  const [localAddress, setLocalAddress] = useState('');
  const [serverName, setServerName] = useState('');
  const [loginDisclaimer, setLoginDisclaimer] = useState('');
  
  useEffect(() => {
    async function fetchServerInfo() {
      const serverInfo = await getServerInfo();
      setLocalAddress(serverInfo.local_address);
      setServerName(serverInfo.server_name);
      setLoginDisclaimer(serverInfo.login_disclaimer);
    }
  
    fetchServerInfo();
  }, []);

  const { push } = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    await setServerInfo(localAddress, serverName, "1.0.0", "ParsonLabs Music", true, loginDisclaimer);
    localStorage.setItem("server", JSON.stringify({ local_address: localAddress, server_name: serverName, version: "1.0.0", product_name: "ParsonLabs Music", startup_wizard_completed: true, login_disclaimer: loginDisclaimer }))
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950">
      <h1 className="text-2xl font-bold text-center text-white pb-10">Customise Server</h1>
      <form onSubmit={handleSubmit} className="space-y-6 text-white w-80">
        <div>
          <label htmlFor="local_address" className="block text-sm font-medium text-white">Local Address:</label>
          <input
            type="text"
            id="local_address"
            value={localAddress}
            onChange={(e) => setLocalAddress(e.target.value)}
            required
            className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
          />
        </div>
        <div>
          <label htmlFor="server_name" className="block text-sm font-medium text-white">Server Name:</label>
          <input
            type="text"
            id="server_name"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            required
            className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
          />
        </div>
        <div>
          <label htmlFor="login_disclaimer" className="block text-sm font-medium text-white">Login Disclaimer (optional):</label>
          <input
            type="text"
            id="login_disclaimer"
            value={loginDisclaimer}
            onChange={(e) => setLoginDisclaimer(e.target.value)}
            className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
          />
        </div>
        <button
          type="submit"
          className="w-full px-4 py-2 mt-6 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Add Server
        </button>
      </form>
    </div>
  );
};