import axios from './axios';

/**
 * Fetch the configuration.
 * @returns {Promise<any>} - A promise that resolves to the configuration data.
 */
export async function getConfig(): Promise<any> {
  const response = await axios.get('/config/get');
  return response.data;
}