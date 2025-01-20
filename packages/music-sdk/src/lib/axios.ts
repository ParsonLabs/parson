import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { deleteCookie, getCookie, setCookie } from 'cookies-next';
import { refreshToken } from './authentication';

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
  instance.interceptors.request.use((config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const token = getCookie('plm_accessToken');
    if (token) {
      if (!config.headers) {
        config.headers = new AxiosHeaders();
      }
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => response,
    async (error: AxiosError): Promise<any> => {
      const originalRequest = error.config as CustomAxiosRequestConfig;
      
      // Skip retry for refresh token endpoint
      if (originalRequest.url?.includes('refresh')) {
        return Promise.reject(error);
      }

      // Handle 401 with token refresh
      if (error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          // Wait for new token
          return new Promise(resolve => {
            addRefreshSubscriber((token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(axiosInstance(originalRequest));
            });
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;
        
        try {
          const response = await refreshToken();
          
          if (!response?.token) {
            throw new Error('No token received from refresh attempt');
          }

          setCookie('plm_accessToken', response.token);
          onRefreshed(response.token);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${response.token}`;
          }
          
          isRefreshing = false;
          return axiosInstance(originalRequest);
          
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          deleteCookie('plm_accessToken');
          isRefreshing = false;
          refreshSubscribers = [];
          return Promise.reject(error);
        }
      }

      // Skip retry for auth failures
      if (error.response?.status === 401 || error.response?.status === 403) {
        return Promise.reject(error);
      }

      // Handle other errors with retry logic
      if (!originalRequest._retryCount) {
        originalRequest._retryCount = 0;
      }

      if (originalRequest._retryCount < MAX_RETRY_ATTEMPTS) {
        originalRequest._retryCount++;
        const delay = Math.pow(2, originalRequest._retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return axiosInstance(originalRequest);
      }

      return Promise.reject(error);
    }
  );
};

setupInterceptors(axiosInstance);

export default axiosInstance;
