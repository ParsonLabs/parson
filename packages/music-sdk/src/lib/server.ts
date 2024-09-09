import { AxiosResponse } from 'axios';
import axios from './axios';
import { ServerInfo } from './types';

/**
 * Set the server information.
 * @param {string} localAddress - The local address of the server.
 * @param {string} serverName - The name of the server.
 * @param {string} version - The version of the server.
 * @param {string} productName - The product name of the server.
 * @param {boolean} startupWizardCompleted - Whether the startup wizard is completed.
 * @param {string} [loginDisclaimer] - The login disclaimer of the server.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function setServerInfo(
  localAddress: string,
  serverName: string,
  version: string,
  productName: string,
  startupWizardCompleted: boolean,
  loginDisclaimer?: string
): Promise<string> {
  const response = await axios.post('/s/server/info', {
    local_address: localAddress,
    server_name: serverName,
    version: version,
    product_name: productName,
    startup_wizard_completed: startupWizardCompleted,
    login_disclaimer: loginDisclaimer,
  });
  return response.data;
}

/**
 * Get the server information.
 * @returns {Promise<ServerInfo>} - A promise that resolves to the server information.
 */
export async function getServerInfo(): Promise<ServerInfo> {
  const response: AxiosResponse<ServerInfo> = await axios.get('/s/server/info');
  return response.data;
}
