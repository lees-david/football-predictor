import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

interface Tournament {
  id: number;
  name: string;
  is_active: boolean;
  has_bracket: boolean;
}

interface CreateTournamentPayload {
  name: string;
  is_active: boolean;
  has_bracket: boolean;
}

interface UpdateTournamentPayload extends CreateTournamentPayload {
  id: number;
}

export const useAdminTournaments = () =>
  useQuery<Tournament[]>({
    queryKey: ['admin', 'tournaments'],
    queryFn: async () => (await apiClient.get('/admin/tournaments')).data,
  });

export const useCreateTournament = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateTournamentPayload) =>
      (await apiClient.post('/admin/tournaments', payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tournaments'] }),
  });
};

export const useUpdateTournament = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateTournamentPayload) =>
      (await apiClient.put(`/admin/tournaments/${id}`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tournaments'] }),
  });
};

export const useSyncTournament = () =>
  useMutation({
    mutationFn: async (tournamentId: number) =>
      (await apiClient.post(`/admin/tournaments/${tournamentId}/sync`)).data,
  });

export const useResetTournament = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tournamentId: number) =>
      (await apiClient.post(`/admin/tournaments/${tournamentId}/reset`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tournaments'] }),
  });
};
