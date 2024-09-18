import axios from './axios';

/**
 * Fetch the configuration.
 * @returns {Promise<any>} - A promise that resolves to the configuration data.
 */
export async function getConfig(): Promise<any> {
  const response = await axios.get('/config/get');
  return response.data;
}

/**
 * Check if the configuration file exists.
 * @returns {Promise<boolean>} - A promise that resolves to a boolean indicating if the config file exists.
 */
export async function hasConfig(): Promise<boolean> {
  try {
    const response = await axios.get('/config/has_config');
    return response.status === 200;
  } catch (error) {
    return false;
  }
}