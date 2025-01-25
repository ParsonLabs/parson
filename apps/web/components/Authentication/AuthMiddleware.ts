import { QueryClient } from '@tanstack/react-query';
import { getCookie } from 'cookies-next';
import { jwtDecode } from 'jwt-decode';

export function createAuthMiddleware(queryClient: QueryClient) {
  let isRefreshing = false;
  let failedQueue: any[] = [];

  const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach(prom => {
      if (error) {
        prom.reject(error);
      } else {
        prom.resolve(token);
      }
    });
    failedQueue = [];
  };

  return async (config: any) => {
    const accessToken = getCookie('plm_accessToken');
    
    if (accessToken) {
      try {
        const decoded = jwtDecode(accessToken.toString());
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (decoded.exp && decoded.exp < currentTime) {
          if (!isRefreshing) {
            isRefreshing = true;
            
            try {
              const response = await fetch(`${window.location.origin}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include'
              });

              if (!response.ok) {
                throw new Error('Token refresh failed');
              }

              isRefreshing = false;
              processQueue(null, accessToken);
              
              queryClient.invalidateQueries();
              
              return config;
            } catch (error) {
              processQueue(error, null);
              throw error;
            }
          }

          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          });
        }
      } catch (error) {
        console.error('Token validation failed:', error);
      }
    }

    return config;
  };
}