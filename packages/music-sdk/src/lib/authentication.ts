import axios, { isAxiosError } from './axios';

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

export async function isValid(): Promise<TokenValidationResponse> {
  try {
    const response = await axios.get('/auth/is-valid');
    return response.data;
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Token validation error:", error.response?.data);
      return {
        status: false,
        message: error.response?.data?.message || "Token validation failed"
      };
    }
    return {
      status: false,
      message: "Token validation failed"
    };
  }
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
  try {
    const response = await axios.post('/auth/refresh');
    return {
      status: true,
      token: response.data.token,
      message: 'Token refreshed successfully'
    };
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Refresh Token Error:", error.response?.data);
      return {
        status: false,
        token: '',
        message: error.response?.data?.message || "Token refresh failed"
      };
    }
    return {
      status: false,
      token: '',
      message: "Token refresh failed"
    };
  }
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