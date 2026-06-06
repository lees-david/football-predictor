import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

interface AdminUser {
  id: number;
  email: string;
  display_name: string;
  role: 'admin' | 'player';
  total_points: number;
  current_rank: number | null;
  is_active: boolean;
  can_manage_leagues: boolean;
  can_manage_tournaments: boolean;
  can_invite_users: boolean;
  created_at: string;
}

interface UpdateRolePayload {
  userId: number;
  role?: 'admin' | 'player';
  can_manage_leagues?: boolean;
  can_manage_tournaments?: boolean;
  can_invite_users?: boolean;
  is_active?: boolean;
}

export const useAdminUsers = () =>
  useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data,
  });

export const useUpdateUserRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ...payload }: UpdateRolePayload) =>
      (await apiClient.put(`/admin/users/${userId}/role`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useAdminUserDetails = (userId: number | null) =>
  useQuery({
    queryKey: ['admin', 'users', userId, 'details'],
    queryFn: async () => (await apiClient.get(`/admin/users/${userId}/details`)).data,
    enabled: !!userId,
  });
