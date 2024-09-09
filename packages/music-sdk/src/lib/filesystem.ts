import axios from './axios';

/**
 * Represents a directory with a name and path.
 */
interface Directory {
  name: string;
  path: string;
}

/**
 * List directories in the specified path.
 * @param {string} path - The path of the directory to list.
 * @returns {Promise<Directory[]>} - A promise that resolves to an array of directories.
 */
export async function listDirectory(path: string): Promise<Directory[]> {
  const response = await axios.get('/filesystem/list_directory', {
    params: { path },
  });
  return response.data;
}