import axios, { 
  AxiosError, 
  AxiosInstance, 
  AxiosRequestConfig, 
  AxiosResponse, 
  InternalAxiosRequestConfig 
} from 'axios';
import { deleteCookie, getCookie, setCookie } from 'cookies-next';
import { refreshToken } from './authentication';
import { jwtDecode } from 'jwt-decode';

export { isAxiosError } from "axios"

const MAX_RETRY_ATTEMPTS = 3;
const TIMEOUT_MS = 10000;
const REFRESH_THRESHOLD_SECONDS = 30;

interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
  _errorType?: string;
}
interface TokenResponse {
  status: boolean;
  token: string;
}

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];
let localAddress = '';

if (typeof window !== 'undefined') {
  const server = JSON.parse(window.localStorage.getItem('server') || '{}');
  localAddress = server.local_address || window.location.origin;
}

const axiosInstance = axios.create({
  baseURL: `${localAddress}/api`,
  withCredentials: true,
  timeout: TIMEOUT_MS
});

const redirectToLogin = () => {
  deleteCookie('plm_accessToken');
  deleteCookie('plm_refreshToken');
  window.location.href = '/login';
};

const addRefreshSubscriber = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback);
};

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
};

const handleTokenRefresh = async () => {
  try {
    const response = await refreshToken();
    if (response?.status && response.token) {
      setCookie('plm_accessToken', response.token);
      return response.token;
    }
    redirectToLogin();
    return null;
  } catch (error) {
    console.error('Token refresh failed:', error);
    redirectToLogin();
    return null;
  }
};

const setupInterceptors = (instance: AxiosInstance): void => {
  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (config.url?.includes('refresh')) {
      return config;
    }

    const accessToken = getCookie('plm_accessToken');
    const refreshTokenValue = getCookie('plm_refreshToken');

    try {
      if (!accessToken && refreshTokenValue && !isRefreshing) {
        isRefreshing = true;
        const newToken = await handleTokenRefresh();
        isRefreshing = false;
        if (newToken) {
          config.headers.set('Authorization', `Bearer ${newToken}`);
        }
        return config;
      }

      if (accessToken) {
        const decoded = jwtDecode<{ exp: number }>(accessToken.toString());
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (decoded.exp && (decoded.exp - currentTime) < REFRESH_THRESHOLD_SECONDS && 
            refreshTokenValue && !isRefreshing) {
          isRefreshing = true;
          const newToken = await handleTokenRefresh();
          isRefreshing = false;
          if (newToken) {
            config.headers.set('Authorization', `Bearer ${newToken}`);
          }
        } else {
          config.headers.set('Authorization', `Bearer ${accessToken}`);
        }
      }
    } catch (error) {
      console.error('Token validation failed:', error);
    }
    
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as CustomAxiosRequestConfig;
      
      if (originalRequest.url?.includes('auth/refresh') || 
          originalRequest.url?.includes('auth/is-valid')) {
        return Promise.reject(error);
      }

      if (error.response?.status === 401) {
        const refreshTokenValue = getCookie('plm_refreshToken');
        
        if (!refreshTokenValue) {
          redirectToLogin();
          return Promise.reject(error);
        }
      
        if (isRefreshing) {
          return new Promise(resolve => {
            addRefreshSubscriber((token: string) => {
              originalRequest.headers = {
                ...originalRequest.headers,
                Authorization: `Bearer ${token}`
              };
              resolve(axiosInstance(originalRequest));
            });
          });
        }
      
        isRefreshing = true;
        const newToken = await handleTokenRefresh();
        isRefreshing = false;

        if (newToken) {
          onRefreshed(newToken);
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: `Bearer ${newToken}`
          };
          return axiosInstance(originalRequest);
        }
      }

      return Promise.reject(error);
    }
  );
};

setupInterceptors(axiosInstance);

export default axiosInstance;