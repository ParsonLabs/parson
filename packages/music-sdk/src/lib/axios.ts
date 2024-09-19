import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { deleteCookie, getCookie } from 'cookies-next';
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
  _retryCount?: number;
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

      if (error.response && error.response.status === 401 && originalRequest) {
        if (!originalRequest._retry) {
          originalRequest._retry = true;
          originalRequest._retryCount = 0;
        }

        if (originalRequest._retryCount! < 10) {
          originalRequest._retryCount! += 1;

          try {
            const response = await refreshToken();

            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${response.token}`;
            }

            return axiosInstance(originalRequest);
          } catch (refreshError) {
            deleteCookie("plm_accessToken");
            return Promise.reject(refreshError);
          }
        } else {
          deleteCookie("plm_accessToken");
          return Promise.reject(error);
        }
      }

      return Promise.reject(error);
    }
  );
};

setupInterceptors(axiosInstance);

export default axiosInstance;