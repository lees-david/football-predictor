import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { MatchPrediction } from '../../types';

export const useMyPredictions = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['predictions', 'me', { tournamentId }],
    queryFn: async () => {
      const { data } = await apiClient.get<MatchPrediction[]>('/match-predictions/me', {
        params: tournamentId ? { tournament_id: tournamentId } : undefined
      });
      return data;
    },
  });
};

export const useSubmitPrediction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (predictionData: { fixture_id: number; predicted_home: number; predicted_away: number }) => {
      const { data } = await apiClient.post<MatchPrediction>('/match-predictions', predictionData);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['predictions', 'me'] });
    },
  });
};

export const useClearPredictions = (tournamentId?: number | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params?: { stage?: string }) => {
      const { data } = await apiClient.delete('/match-predictions/clear', {
        params: {
          tournament_id: tournamentId,
          ...(params?.stage ? { stage: params.stage } : {})
        }
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['predictions', 'me'] });
    },
  });
};

