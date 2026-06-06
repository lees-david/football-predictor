import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { League, LeaderboardEntry, HistoricalRankEntry } from '../../types';

export const useMyLeagues = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['leagues', { tournamentId }],
    queryFn: async () => {
      const { data } = await apiClient.get<League[]>('/leagues', {
        params: { joined_only: true, ...(tournamentId ? { tournament_id: tournamentId } : {}) }
      });
      return data;
    },
  });
};

export const useGlobalRank = (tournamentId?: number | null) => {
  return useQuery({
    queryKey: ['globalRank', tournamentId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ rank: number | null; total_players: number }>('/rankings/global', {
        params: { tournament_id: tournamentId },
      });
      return data;
    },
    enabled: !!tournamentId,
  });
};

export const useLeaderboard = (leagueId: number | null) => {
  return useQuery({
    queryKey: ['leaderboard', leagueId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ league_id: number; entries: LeaderboardEntry[] }>(`/rankings/${leagueId}`);
      return data.entries;
    },
    enabled: !!leagueId,
  });
};

export const useRankingHistory = (leagueId: number | null) => {
  return useQuery({
    queryKey: ['rankingHistory', leagueId],
    queryFn: async () => {
      const { data } = await apiClient.get<HistoricalRankEntry[]>(`/rankings/${leagueId}/history`);
      return data;
    },
    enabled: !!leagueId,
  });
};

export const useJoinLeague = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invite_token: string) => {
      const { data } = await apiClient.post('/leagues/join', { invite_token });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
    },
  });
};

export const useLeaveLeague = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: number) => {
      const { data } = await apiClient.post(`/leagues/${leagueId}/leave`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
    },
  });
};

