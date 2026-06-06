import React from 'react';
import { Card } from '../components/ui/Card';
import { apiClient } from '../api/client';
import { useMe } from '../api/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { History, Trophy, Layers, Crown } from 'lucide-react';

interface PointsHistoryEntry {
  id: number;
  tournament_id: number;
  tournament_name: string;
  points_awarded: number;
  source_type: 'match' | 'group_bracket' | 'ko_bracket';
  source_id: string;
  source_label: string;
  match_number?: string | null;
  context?: string | null;
  reason?: string | null;
  created_at: string;
}

interface PointsHistoryTournamentSummary {
  tournament_id: number;
  tournament_name: string;
  total_points: number;
  match_points: number;
  group_bracket_points: number;
  ko_bracket_points: number;
}

interface PointsHistoryResponse {
  summaries: PointsHistoryTournamentSummary[];
  entries: PointsHistoryEntry[];
}

export const MyPoints: React.FC = () => {
  const { data: currentUser } = useMe();
  const { data: pointsHistory } = useQuery<PointsHistoryResponse>({
    queryKey: ['me', 'points-history'],
    queryFn: async () => {
      const { data } = await apiClient.get<PointsHistoryResponse>('/users/me/points-history');
      return data;
    },
    enabled: !!currentUser,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-3xl font-bold text-textMain tracking-tight">My Points</h1>
        <p className="text-textMuted mt-1">A full breakdown of every point you've earned across all tournaments.</p>
      </div>

      <Card title={<span className="flex items-center gap-2"><History size={20} className="text-primary" /> Points Breakdown</span>}>
        {!pointsHistory || pointsHistory.entries.length === 0 ? (
          <div className="text-sm text-textMuted italic py-4 text-center">
            No points awarded yet. Make predictions and watch them score as fixtures complete.
          </div>
        ) : (
          <div className="space-y-6">
            {pointsHistory.summaries.map((s) => {
              const tournamentEntries = pointsHistory.entries.filter(e => e.tournament_id === s.tournament_id);
              return (
                <div key={s.tournament_id} className="space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <div className="text-sm font-bold text-textMain">{s.tournament_name}</div>
                    <div className="text-lg font-bold text-primary font-mono">{s.total_points} pts</div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-black/30 rounded-lg px-2 py-2 border border-white/5">
                      <div className="flex items-center justify-center gap-1 text-[10px] text-textMuted uppercase tracking-wider mb-1">
                        <Trophy size={11} /> Match
                      </div>
                      <div className="text-base font-bold text-amber-400 font-mono">{s.match_points}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg px-2 py-2 border border-white/5">
                      <div className="flex items-center justify-center gap-1 text-[10px] text-textMuted uppercase tracking-wider mb-1">
                        <Layers size={11} /> Groups
                      </div>
                      <div className="text-base font-bold text-orange-400 font-mono">{s.group_bracket_points}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg px-2 py-2 border border-white/5">
                      <div className="flex items-center justify-center gap-1 text-[10px] text-textMuted uppercase tracking-wider mb-1">
                        <Crown size={11} /> KO
                      </div>
                      <div className="text-base font-bold text-rose-400 font-mono">{s.ko_bracket_points}</div>
                    </div>
                  </div>

                  <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
                    {tournamentEntries.map((e) => {
                      const isMatch = e.source_type === 'match';
                      const isGroup = e.source_type === 'group_bracket';
                      const isKo = e.source_type === 'ko_bracket';
                      return (
                        <div key={e.id} className="flex items-start justify-between px-3 py-2 bg-black/20 hover:bg-black/40 transition-colors text-xs">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="mt-0.5 shrink-0">
                              {isMatch && <Trophy size={12} className="text-amber-400/70" />}
                              {isGroup && <Layers size={12} className="text-orange-400/70" />}
                              {isKo && <Crown size={12} className="text-rose-400/70" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-textMain truncate">{e.source_label}</div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {e.match_number && (
                                  <span className="text-[10px] text-textMuted font-mono bg-white/5 px-1 rounded">
                                    {e.match_number}
                                  </span>
                                )}
                                {e.context && (
                                  <span className="text-[10px] text-textMuted">{e.context}</span>
                                )}
                                {e.reason && (
                                  <>
                                    {(e.match_number || e.context) && <span className="text-[10px] text-white/20">·</span>}
                                    <span className="text-[10px] text-primary/70">{e.reason}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3 mt-0.5">
                            <span className="text-[10px] text-textMuted font-mono">
                              {new Date(e.created_at).toLocaleDateString()}
                            </span>
                            <span className={`font-bold font-mono ${e.points_awarded >= 0 ? 'text-success' : 'text-danger'}`}>
                              {e.points_awarded >= 0 ? '+' : ''}{e.points_awarded}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
