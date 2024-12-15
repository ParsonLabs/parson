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

interface TokenValidationResponse {
  status: boolean;
  token_type?: string;
  claims?: {
    sub: string;
    exp: number;
    username: string;
    bitrate: number;
    token_type: string;
    role: string;
  };
  message?: string;
}

/**
 * Check if the current token is valid.
 * @returns {Promise<TokenValidationResponse>} - A promise that resolves to the validation response.
 */
export async function isValid(): Promise<TokenValidationResponse> {
  const response = await axios.get('/auth/is-valid');
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

/**
 * Validate JWT by making a request to /api/format/test.
 * @returns {Promise<"valid" | "invalid" | "error">} - A promise that resolves to "valid" if the JWT is valid, "invalid" if the JWT is invalid, and "error" for other errors.
 */
export async function validateJWT(): Promise<"valid" | "invalid" | "error"> {
  try {
    const response = await axios.get('/format/test');
    if (response.status === 200) return "valid";
    if (response.status === 403) return "invalid";
    return "error";
  } catch (error) {
    return "error";
  }
}