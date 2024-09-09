import axios from './axios';

/**
 * Index the library at the specified path.
 * @param {string} pathToLibrary - The path to the library.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function indexLibrary(pathToLibrary: string): Promise<string> {
  let localAddress = '';
  if (typeof window !== 'undefined') {
    const server = JSON.parse(window.localStorage.getItem('server') || '{}');
    localAddress = server.local_address || window.location.origin;
  }

  const encodedPath = encodeURIComponent(pathToLibrary);
  const response = await axios.get(`/library/index/${encodedPath}`, {
    baseURL: localAddress
  });
  return response.data;
}