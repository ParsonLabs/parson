import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { deleteCookie, getCookie, setCookie } from 'cookies-next';
import { refreshToken } from './authentication';

let localAddress = '';
if (typeof window !== 'undefined') {
  const server = JSON.parse(window.localStorage.getItem('server') || '{}');
  localAddress = server.local_address || window.location.origin;
}

const axiosInstance = axios.create({
  baseURL: `${localAddress}/api`,
  withCredentials: true,
});

interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _retryAttempt?: number;
  _retryDelay?: number;
}

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = 1000;

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

      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        originalRequest._retryAttempt = 0;
        originalRequest._retryDelay = INITIAL_RETRY_DELAY;

        try {
          const response = await refreshToken();
          
          if (response?.token) {
            setCookie('plm_accessToken', response.token);
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${response.token}`;
            }
            return axiosInstance(originalRequest);
          }
          
          throw new Error('No token received from refresh attempt');
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          deleteCookie('plm_accessToken');
          
          if (originalRequest._retryAttempt! < MAX_RETRY_ATTEMPTS) {
            originalRequest._retryAttempt! += 1;
            const delay = originalRequest._retryDelay! * Math.pow(2, originalRequest._retryAttempt!);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return axiosInstance(originalRequest);
          }
          
          throw error;
        }
      }

      return Promise.reject(error);
    }
  );
};

setupInterceptors(axiosInstance);

export default axiosInstance;