import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';
import { Fixture } from '../../types';

export const useFixtures = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['fixtures', { tournamentId }],
    queryFn: async () => {
      const { data } = await apiClient.get<Fixture[]>('/fixtures', {
        params: tournamentId ? { tournament_id: tournamentId } : undefined
      });
      return data;
    },
  });
};

export const useFixture = (id: number) => {
  return useQuery({
    queryKey: ['fixtures', id],
    queryFn: async () => {
      const { data } = await apiClient.get<Fixture>(`/fixtures/${id}`);
      return data;
    },
    enabled: !!id,
  });
};
