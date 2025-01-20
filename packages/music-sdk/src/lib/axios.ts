import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { deleteCookie, getCookie, setCookie } from 'cookies-next';
import { refreshToken } from './authentication';
import { jwtDecode } from 'jwt-decode';

let localAddress = '';
if (typeof window !== 'undefined') {
  const server = JSON.parse(window.localStorage.getItem('server') || '{}');
  localAddress = server.local_address || window.location.origin;
}

const MAX_RETRY_ATTEMPTS = 3;
const TIMEOUT_MS = 10000;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const axiosInstance = axios.create({
  baseURL: `${localAddress}/api`,
  withCredentials: true,
  timeout: TIMEOUT_MS
});

interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

// Helper to add token refresh subscriber
const addRefreshSubscriber = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback);
}

// Helper to notify subscribers
const onRefreshed = (token: string) => {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
}

const setupInterceptors = (instance: AxiosInstance): void => {
  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const accessToken = getCookie('plm_accessToken');
    const refreshTokenValue = getCookie('plm_refreshToken');

    if (config.url?.includes('refresh')) {
      return config;
    }

    try {
      if (!accessToken && refreshTokenValue && !isRefreshing) {
        // Try refresh first if no access token but refresh token exists
        isRefreshing = true;
        try {
          const response = await refreshToken();
          if (response?.token) {
            setCookie('plm_accessToken', response.token);
            config.headers.set('Authorization', `Bearer ${response.token}`);
            isRefreshing = false;
            return config;
          }
        } catch (error) {
          console.error('Initial refresh failed:', error);
        } finally {
          isRefreshing = false;
        }
      }

      if (accessToken) {
        const decoded = jwtDecode<{ exp: number }>(accessToken.toString());
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (decoded.exp && (decoded.exp - currentTime) < 30 && refreshTokenValue && !isRefreshing) {
          isRefreshing = true;
          try {
            const response = await refreshToken();
            if (response?.token) {
              setCookie('plm_accessToken', response.token);
              config.headers.set('Authorization', `Bearer ${response.token}`);
            }
          } catch (error) {
            console.error('Pre-emptive refresh failed:', error);
            // Don't delete cookies here, let the response interceptor handle it
          } finally {
            isRefreshing = false;
          }
        } else {
          config.headers.set('Authorization', `Bearer ${accessToken}`);
        }
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      // Don't delete cookies here, attempt refresh in response interceptor
    }
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as CustomAxiosRequestConfig;
      const refreshTokenValue = getCookie('plm_refreshToken');
      
      if (error.response?.status === 401 && !originalRequest._retry && refreshTokenValue) {
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

        originalRequest._retry = true;
        isRefreshing = true;
        
        try {
          const refreshResult = await refreshToken();
          if (refreshResult?.token) {
            setCookie('plm_accessToken', refreshResult.token);
            onRefreshed(refreshResult.token);
            originalRequest.headers = {
              ...originalRequest.headers,
              Authorization: `Bearer ${refreshResult.token}`
            };
            return axiosInstance(originalRequest);
          }
        } catch (refreshError) {
          console.error('Refresh failed, clearing tokens:', refreshError);
        } finally {
          isRefreshing = false;
        }

        // Only delete cookies if refresh failed
        deleteCookie('plm_accessToken');
        deleteCookie('plm_refreshToken');
        refreshSubscribers = [];
        window.location.href = '/login';
      }

      return Promise.reject(error);
    }
  );
};

setupInterceptors(axiosInstance);

export default axiosInstance;
