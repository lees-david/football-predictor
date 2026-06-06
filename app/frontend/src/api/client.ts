import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginPage = window.location.pathname.replace(/\/$/, "") === '/login';
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/') && !isLoginPage) {
      localStorage.removeItem('token');
      const urlParams = new URLSearchParams(window.location.search);
      const inviteToken = urlParams.get('token') || urlParams.get('invite');
      if (inviteToken) {
        window.location.href = `/login?token=${inviteToken}`;
      } else {
        window.location.href = '/login';
      }
    }
    if (error.response?.status === 503 && window.location.pathname !== '/maintenance') {
      window.location.href = '/maintenance';
    }
    return Promise.reject(error);
  }
);
