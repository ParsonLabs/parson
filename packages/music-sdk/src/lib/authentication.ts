import axios from './axios';

interface AuthData {
  username: string;
  password: string;
  role: string
}

interface ResponseAuthData {
  status: boolean;
  token: string;
  message?: string;
}

export interface RefreshTokenData {
  refreshToken: string;
}

interface UpdateUserData {
  username?: string;
  password?: string;
  roles?: string[];
}

/**
 * Register a new user.
 * @param {AuthData} data - The registration data.
 * @returns {Promise<ResponseAuthData>} - A promise that resolves to the response data.
 */
export async function register(data: AuthData): Promise<ResponseAuthData> {
  const response = await axios.post('/auth/register', data);
  return response.data;
}

/**
 * Login a user.
 * @param {AuthData} data - The login data.
 * @returns {Promise<ResponseAuthData>} - A promise that resolves to the response data.
 */
export async function login(data: AuthData): Promise<ResponseAuthData> {
  const response = await axios.post('/auth/login', data);
  return response.data;
}

/**
 * Refresh the access token.
 * @returns {Promise<ResponseAuthData>} - A promise that resolves to the response data.
 */
export async function refreshToken(): Promise<ResponseAuthData> {
  const response = await axios.post('/auth/refresh');
  return response.data;
}

/**
 * Update user information.
 * @param {UpdateUserData} data - The update user data.
 * @returns {Promise<ResponseAuthData>} - A promise that resolves to the response data.
 */
export async function updateUser(data: UpdateUserData): Promise<ResponseAuthData> {
  const response = await axios.put('/auth/update', data);
  return response.data;
}