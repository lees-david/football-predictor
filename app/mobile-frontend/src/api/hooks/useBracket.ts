import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export const useMyBracket = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['bracket', 'me', { tournamentId }],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get('/bracket/me', {
          params: tournamentId ? { tournament_id: tournamentId } : undefined
        });
        return data;
      } catch (err: any) {
        // 404 = bracket doesn't exist (yet, or after admin reset). Return null so the
        // query cache replaces stale data instead of retaining the previous bracket.
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !!tournamentId,
    retry: false,
  });
};

export const useSubmitBracket = (tournamentId?: number | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bracketData: any) => {
      const { data } = await apiClient.post('/bracket', bracketData, {
        params: tournamentId ? { tournament_id: tournamentId } : undefined
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bracket', 'me', { tournamentId }] });
    },
  });
};

interface ActualSlotResult {
  team_a: string | null;
  team_b: string | null;
  winner: string | null;
  status: string;
}

export interface ActualBracketResults {
  group_standings: Record<string, string[]>;
  slots: Record<string, ActualSlotResult>;
}

export const useActualBracketResults = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['bracket', 'actual-results', { tournamentId }],
    queryFn: async () => {
      const { data } = await apiClient.get('/bracket/actual-results', {
        params: tournamentId ? { tournament_id: tournamentId } : undefined,
      });
      return data as ActualBracketResults;
    },
    enabled: !!tournamentId,
    refetchInterval: 60_000,
  });
};

export const useClearBracket = (tournamentId?: number | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { type: 'all' | 'group' | 'knockout' }) => {
      const { data } = await apiClient.delete('/bracket/clear', {
        params: {
          tournament_id: tournamentId,
          type: params.type
        }
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bracket', 'me', { tournamentId }] });
    },
  });
};

