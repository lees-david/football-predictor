import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { User } from '../../types';

export const useMe = () => {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await apiClient.get<User>('/users/me');
      return data;
    },
    retry: false,
  });
};

export const useLogin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: URLSearchParams) => {
      const { data } = await apiClient.post<{access_token: string}>('/auth/login', credentials, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      return data;
    },
    onSuccess: (data) => {
      localStorage.setItem('token', data.access_token);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};

export const useRegister = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userData: any) => {
      const { data } = await apiClient.post<{access_token: string}>('/auth/register', userData);
      return data;
    },
    onSuccess: (data) => {
      localStorage.setItem('token', data.access_token);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};

export const useForgotPassword = () => {
  return useMutation({
    mutationFn: async (email: string) => {
      const { data } = await apiClient.post('/auth/forgot-password', { email });
      return data;
    },
  });
};

export const useResetPassword = () => {
  return useMutation({
    mutationFn: async ({ token, new_password }: { token: string; new_password: string }) => {
      const { data } = await apiClient.post('/auth/reset-password', { token, new_password });
      return data;
    },
  });
};

export const logout = () => {
  localStorage.removeItem('token');
  window.location.href = '/login';
};
