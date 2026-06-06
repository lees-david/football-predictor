import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMyLeagues, useLeaderboard, useRankingHistory } from '../api/hooks/useRankings';
import { useMe } from '../api/hooks/useAuth';
import { useTournamentContext } from '../api/TournamentContext';
import { Copy, CheckCircle, Users, Trophy, TrendingUp, BookOpen } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ---------------------------------------------------------------------------
// Form Guide component — 5 coloured circles for last 5 prediction outcomes
// ---------------------------------------------------------------------------
type FormResult = 'exact' | 'correct' | 'wrong' | 'none';

interface FormGuideProps {
  form: FormResult[];
}

const FORM_COLOURS: Record<FormResult, string> = {
  exact:   'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]',
  correct: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]',
  wrong:   'bg-red-500/70',
  none:    'bg-white/15',
};

const FORM_TITLE: Record<FormResult, string> = {
  exact:   'Exact score (+3)',
  correct: 'Correct result (+1)',
  wrong:   'Wrong (0)',
  none:    'No prediction',
};

const FormGuide: React.FC<FormGuideProps> = ({ form }) => (
  <div className="flex items-center gap-1" title="Last 5 predictions">
    {Array.from({ length: 5 }).map((_, i) => {
      const result = form[i] ?? 'none';
      return (
        <div
          key={i}
          title={FORM_TITLE[result]}
          className={`w-3 h-3 rounded-full transition-all ${FORM_COLOURS[result]}`}
        />
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Shared chart helpers
// ---------------------------------------------------------------------------
const CHART_COLOURS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444'];

const STAGE_ORDER: Record<string, number> = {
  'MD-1': 1, 'MD-2': 2, 'MD-3': 3,
  'R32': 4, 'R16': 5, 'QF': 6, 'SF': 7, '3rd': 8, 'F': 9,
};

// ---------------------------------------------------------------------------
// Points Worm Chart — cumulative points over time for top-5 players
// ---------------------------------------------------------------------------
const PointsWormChart: React.FC<{
  history: Array<{ user_id: number; display_name: string; matchday_id: string; points_at_time: number }>;
  currentUserId?: number;
}> = ({ history, currentUserId }) => {
  if (!history.length) {
    return (
      <div className="h-48 flex items-center justify-center text-white/30 text-sm">
        Points history will appear once matches have been scored.
      </div>
    );
  }

  const matchdays = [...new Set(history.map(r => r.matchday_id))].sort(
    (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
  );

  const playerMap = new Map<number, { display_name: string; pts: Record<string, number> }>();
  for (const row of history) {
    if (!playerMap.has(row.user_id)) {
      playerMap.set(row.user_id, { display_name: row.display_name, pts: {} });
    }
    playerMap.get(row.user_id)!.pts[row.matchday_id] = row.points_at_time;
  }

  // Top-5 by points at the latest matchday
  const lastMD = matchdays[matchdays.length - 1];
  const players = [...playerMap.entries()]
    .sort((a, b) => (b[1].pts[lastMD] ?? 0) - (a[1].pts[lastMD] ?? 0))
    .slice(0, 5);

  const chartData = matchdays.map(md => {
    const row: Record<string, unknown> = { matchday: md };
    for (const [, p] of players) {
      row[p.display_name] = p.pts[md] ?? null;
    }
    return row;
  });

  const maxPts = Math.max(...players.flatMap(([, p]) => Object.values(p.pts)), 1);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="matchday"
          tick={{ fill: '#8B949E', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, maxPts]}
          tick={{ fill: '#8B949E', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={28}
          label={{ value: 'Pts', angle: -90, position: 'insideLeft', fill: '#8B949E', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{ background: '#161B22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F0F6FC' }}
          labelStyle={{ color: '#8B949E', marginBottom: 4, fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#8B949E' }} />
        {players.map(([uid, p], i) => (
          <Line
            key={uid}
            type="monotone"
            dataKey={p.display_name}
            stroke={CHART_COLOURS[i]}
            strokeWidth={uid === currentUserId ? 3 : 1.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
            strokeDasharray={uid === currentUserId ? undefined : '4 2'}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

// ---------------------------------------------------------------------------
// Worm Chart — rank over time for top-4 players
// ---------------------------------------------------------------------------

const WormChart: React.FC<{
  history: Array<{ user_id: number; display_name: string; matchday_id: string; rank_at_time: number }>;
  currentUserId?: number;
}> = ({ history, currentUserId }) => {
  if (!history.length) {
    return (
      <div className="h-48 flex items-center justify-center text-white/30 text-sm">
        Rank history will appear once matches have been scored.
      </div>
    );
  }

  // Get unique players (sorted by best final rank) and unique matchdays
  const playerMap = new Map<number, { display_name: string; ranks: Record<string, number> }>();
  const matchdays = [...new Set(history.map(r => r.matchday_id))].sort(
    (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
  );

  for (const row of history) {
    if (!playerMap.has(row.user_id)) {
      playerMap.set(row.user_id, { display_name: row.display_name, ranks: {} });
    }
    playerMap.get(row.user_id)!.ranks[row.matchday_id] = row.rank_at_time;
  }

  // Take top-4 players by best (lowest) final rank
  const players = [...playerMap.entries()]
    .sort((a, b) => {
      const lastMD = matchdays[matchdays.length - 1];
      return (a[1].ranks[lastMD] ?? 999) - (b[1].ranks[lastMD] ?? 999);
    })
    .slice(0, 4);

  // Build chart data rows
  const chartData = matchdays.map(md => {
    const row: Record<string, unknown> = { matchday: md };
    for (const [, p] of players) {
      row[p.display_name] = p.ranks[md];
    }
    return row;
  });

  const maxRank = Math.max(
    ...history.map(r => r.rank_at_time),
    players.length,
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="matchday"
          tick={{ fill: '#8B949E', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          reversed
          domain={[1, maxRank]}
          tick={{ fill: '#8B949E', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={24}
          label={{ value: 'Rank', angle: -90, position: 'insideLeft', fill: '#8B949E', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{ background: '#161B22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F0F6FC' }}
          labelStyle={{ color: '#8B949E', marginBottom: 4, fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#8B949E' }} />
        {players.map(([uid, p], i) => (
          <Line
            key={uid}
            type="monotone"
            dataKey={p.display_name}
            stroke={CHART_COLOURS[i]}
            strokeWidth={uid === currentUserId ? 3 : 1.5}
            dot={false}
            activeDot={{ r: 4 }}
            strokeDasharray={uid === currentUserId ? undefined : '4 2'}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

// ---------------------------------------------------------------------------
// Tie-aware rank helpers
// ---------------------------------------------------------------------------
interface RankGroup {
  rank: number;
  pts: number;
  names: string[];
}

function buildRankGroups(entries: Array<{ display_name: string; total_points: number }>): RankGroup[] {
  const groups: RankGroup[] = [];
  let countSoFar = 0;
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.pts === e.total_points) {
      last.names.push(e.display_name);
    } else {
      groups.push({ rank: countSoFar + 1, pts: e.total_points, names: [e.display_name] });
    }
    countSoFar++;
  }
  return groups;
}

// Returns the display rank for each entry (ties share the same rank number)
function computeEntryRanks(entries: Array<{ total_points: number }>): number[] {
  const ranks: number[] = [];
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].total_points === entries[i - 1].total_points) {
      ranks.push(ranks[i - 1]);
    } else {
      ranks.push(rank);
    }
    rank++;
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// Podium for top-3 ranks (tie-aware)
// ---------------------------------------------------------------------------
const PODIUM_CFG = [
  { medal: '🥈', height: 'h-20', colour: 'bg-slate-400/20 border-slate-400/30' },
  { medal: '🥇', height: 'h-28', colour: 'bg-amber-500/20 border-amber-500/40' },
  { medal: '🥉', height: 'h-16', colour: 'bg-amber-700/20 border-amber-700/30' },
];

const Podium: React.FC<{ entries: Array<{ display_name: string; total_points: number }> }> = ({ entries }) => {
  const groups = buildRankGroups(entries).slice(0, 3); // top 3 distinct ranks
  if (groups.length < 2) return null;

  // Visual order: 2nd (index 1), 1st (index 0), 3rd (index 2)
  const visualOrder = [1, 0, 2];

  return (
    <div className="flex items-end justify-center gap-3 mb-6">
      {visualOrder.map((groupIdx, posIdx) => {
        const group = groups[groupIdx];
        if (!group) return <div key={posIdx} className="w-24" />;
        const cfg = PODIUM_CFG[posIdx];
        const isTied = group.names.length > 1;
        return (
          <div key={groupIdx} className="flex flex-col items-center gap-1">
            <div className="text-2xl">{cfg.medal}</div>
            {/* Names — stacked if tied */}
            <div className="flex flex-col items-center gap-0.5 max-w-[90px]">
              {group.names.map(name => (
                <div key={name} className="text-xs font-semibold text-white text-center truncate w-full">{name}</div>
              ))}
            </div>
            <div className="text-amber-400 font-bold text-xs">{group.pts} pts</div>
            <div className={`w-24 ${cfg.height} rounded-t-lg border ${cfg.colour} flex items-center justify-center`}>
              <span className="text-white/40 font-bold text-lg">{isTied ? `=${group.rank}` : `#${group.rank}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Leaderboard page
// ---------------------------------------------------------------------------
type Tab = 'standings' | 'roster' | 'invite';

export const Leaderboard: React.FC = () => {
  const { data: user } = useMe();
  const { selectedTournamentId } = useTournamentContext();
  const { data: leagues } = useMyLeagues(selectedTournamentId);
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('standings');
  const [copied, setCopied] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [searchParams] = useSearchParams();
  const queryLeagueId = searchParams.get('leagueId');

  React.useEffect(() => {
    if (queryLeagueId) {
      const parsedId = parseInt(queryLeagueId, 10);
      if (!isNaN(parsedId) && selectedLeagueId !== parsedId) {
        setSelectedLeagueId(parsedId);
      }
    } else if (leagues && leagues.length > 0 && selectedLeagueId === null) {
      setSelectedLeagueId(leagues[0].id);
    }
  }, [leagues, selectedLeagueId, queryLeagueId]);

  const { data: leaderboard = [], isLoading } = useLeaderboard(selectedLeagueId);
  const { data: history = [] } = useRankingHistory(selectedLeagueId);
  const entryRanks = React.useMemo(() => computeEntryRanks(leaderboard), [leaderboard]);

  const selectedLeague = leagues?.find(l => l.id === selectedLeagueId);

  // Derive mock form from prediction history (placeholder until API returns last_5_form)
  const formMap = React.useMemo(() => {
    const map = new Map<number, FormResult[]>();
    for (const entry of leaderboard) {
      // Placeholder: generate deterministic dummy form per user until backend provides it
      map.set(entry.user_id, (['none', 'none', 'none', 'none', 'none'] as FormResult[]));
    }
    return map;
  }, [leaderboard]);

  const copyInvite = () => {
    if (selectedLeague?.invite_token) {
      navigator.clipboard.writeText(selectedLeague.invite_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!leagues || leagues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-white/50">
        <Trophy size={48} className="mb-4 opacity-20" />
        <h2 className="text-2xl font-bold text-white mb-2">No Leagues Found</h2>
        <p>You must join a league to view the leaderboard.</p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'standings', label: 'Standings', icon: <Trophy size={16} /> },
    { key: 'roster', label: 'Roster', icon: <Users size={16} /> },
    { key: 'invite', label: 'Invite', icon: <BookOpen size={16} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Trophy className="text-amber-400" size={32} />
            Leaderboard
          </h1>
          <p className="text-white/50 text-sm mt-1">Compare your prediction performance across your leagues.</p>
        </div>

        {/* League selector */}
        {leagues.length > 1 && (
          <select
            value={selectedLeagueId || ''}
            onChange={e => {
              setSelectedLeagueId(Number(e.target.value));
              setActiveTab('standings');
            }}
            className="bg-[#161B22] border border-white/10 rounded-xl px-4 py-2.5 text-white outline-none focus:border-amber-500/50 transition-colors"
          >
            {leagues.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-xl w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-amber-500 text-black shadow-lg'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* STANDINGS TAB                                                     */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'standings' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="bg-[#161B22] border border-white/8 rounded-2xl p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-white mb-5 flex items-center gap-3">
                {selectedLeague?.logo_url ? (
                  <img 
                    src={selectedLeague.logo_url} 
                    alt={`${selectedLeague.name} logo`} 
                    className="w-8 h-8 rounded object-contain bg-white/5 border border-white/10 p-0.5 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-gradient-to-br from-primary/10 to-amber-500/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold font-mono shrink-0">
                    {selectedLeague?.name?.charAt(0).toUpperCase() || 'L'}
                  </div>
                )}
                <span>
                  {selectedLeague?.name ?? 'League'}
                  <span className="text-xs font-normal text-white/40 ml-2">({leaderboard.length} players)</span>
                </span>
              </h2>

              {/* Podium */}
              {leaderboard.length >= 2 && <Podium entries={leaderboard} />}

              {/* Full standings table */}
              {isLoading ? (
                <div className="text-white/30 text-sm py-8 text-center animate-pulse">Loading standings…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider w-12">#</th>
                        <th className="text-left py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider">Player</th>
                        <th className="text-left py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider hidden lg:table-cell">Form</th>
                        <th className="text-right py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider hidden lg:table-cell">🎯 Exact</th>
                        <th className="text-right py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider hidden lg:table-cell">📐 Margin</th>
                        <th className="text-right py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider hidden lg:table-cell">✅ Result</th>
                        <th className="text-right py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider hidden lg:table-cell">🏆 Bracket</th>
                        <th className="text-right py-2 px-3 text-white/40 font-medium text-xs uppercase tracking-wider">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, idx) => {
                        const isMe = entry.user_id === user?.id;
                        const bd = (entry as any).breakdown;
                        const rank = entryRanks[idx];
                        const isExpanded = expandedRow === entry.user_id;
                        return (
                          <React.Fragment key={entry.user_id}>
                            <tr
                              onClick={() => setExpandedRow(isExpanded ? null : entry.user_id)}
                              className={`border-b border-white/5 transition-colors cursor-pointer lg:cursor-default ${
                                isMe ? 'bg-amber-500/5 border-amber-500/20' : 'hover:bg-white/2'
                              }`}
                            >
                              <td className="py-3 px-3">
                                {rank === 1 ? <span className="text-lg">🥇</span>
                                 : rank === 2 ? <span className="text-lg">🥈</span>
                                 : rank === 3 ? <span className="text-lg">🥉</span>
                                 : <span className="text-white/40 font-bold">{rank}</span>}
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <div>
                                    <span className={`font-semibold ${isMe ? 'text-amber-400' : 'text-white'}`}>
                                      {entry.team_name || entry.display_name}
                                    </span>
                                    {entry.team_name && (
                                      <span className="block text-xs text-white/40">{entry.display_name}</span>
                                    )}
                                  </div>
                                  {isMe && <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">You</span>}
                                </div>
                              </td>
                              <td className="py-3 px-3 hidden lg:table-cell">
                                <FormGuide form={formMap.get(entry.user_id) ?? []} />
                              </td>
                              <td className="py-3 px-3 text-right hidden lg:table-cell">
                                <span className="text-sm font-mono text-emerald-400">{bd?.exact_score ?? 0}</span>
                              </td>
                              <td className="py-3 px-3 text-right hidden lg:table-cell">
                                <span className="text-sm font-mono text-blue-400">{bd?.correct_margin ?? 0}</span>
                              </td>
                              <td className="py-3 px-3 text-right hidden lg:table-cell">
                                <span className="text-sm font-mono text-white/60">{bd?.correct_outcome ?? 0}</span>
                              </td>
                              <td className="py-3 px-3 text-right hidden lg:table-cell">
                                <span className="text-sm font-mono text-amber-600">{bd?.bracket_pts ?? 0}</span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <span className="font-bold text-amber-400 text-base">{entry.total_points}</span>
                                {entry.delta !== undefined && entry.delta !== 0 && (
                                  <span className={`ml-2 text-xs ${entry.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {entry.delta > 0 ? '+' : ''}{entry.delta}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-amber-500/5 lg:hidden">
                                <td colSpan={3} className="py-2 px-3 pb-3 border-b border-white/5">
                                  <div className="grid grid-cols-2 gap-4 text-xs mt-2 bg-black/40 p-3 rounded-xl border border-white/5">
                                    <div className="space-y-1">
                                      <div className="text-textMuted font-medium flex justify-between">
                                        <span>🎯 Exact:</span>
                                        <span className="font-bold text-emerald-400 font-mono">{bd?.exact_score ?? 0}</span>
                                      </div>
                                      <div className="text-textMuted font-medium flex justify-between">
                                        <span>📐 Margin:</span>
                                        <span className="font-bold text-blue-400 font-mono">{bd?.correct_margin ?? 0}</span>
                                      </div>
                                      <div className="text-textMuted font-medium flex justify-between">
                                        <span>✅ Result:</span>
                                        <span className="font-bold text-white/60 font-mono">{bd?.correct_outcome ?? 0}</span>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-textMuted font-medium flex justify-between">
                                        <span>🏆 Bracket:</span>
                                        <span className="font-bold text-amber-600 font-mono">{bd?.bracket_pts ?? 0}</span>
                                      </div>
                                      <div className="text-textMuted font-medium flex flex-col gap-1 mt-2">
                                        <span>Form:</span>
                                        <FormGuide form={formMap.get(entry.user_id) ?? []} />
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                    })}
                    {leaderboard.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-white/30 text-sm">
                            No entries yet. Make your first prediction to appear here!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Points worm chart — total points over time for top-5 players */}
          <div className="bg-[#161B22] border border-white/8 rounded-2xl p-5 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-amber-400" />
              Points Over Time
            </h3>
            <PointsWormChart history={history} currentUserId={user?.id} />
            <p className="text-xs text-white/30 mt-3 text-center">
              Top 5 players · Cumulative points per stage
            </p>
          </div>

          {/* Rank worm chart — rank trajectory for top-4 players */}
          <div className="bg-[#161B22] border border-white/8 rounded-2xl p-5 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-400" />
              Rank Trajectories
            </h3>
            <WormChart history={history} currentUserId={user?.id} />
            <p className="text-xs text-white/30 mt-3 text-center">
              Top 4 players · Rank 1 = best
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* ROSTER TAB                                                        */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'roster' && (
        <div className="bg-[#161B22] border border-white/8 rounded-2xl p-6 backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-white mb-5 flex items-center gap-2">
            <Users size={18} className="text-blue-400" />
            Member Roster
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {leaderboard.map((entry, idx) => {
              const isMe = entry.user_id === user?.id;
              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                    isMe
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-white/3 border-white/5 hover:bg-white/6'
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                    idx === 0 ? 'bg-amber-500/30 text-amber-400' :
                    idx === 1 ? 'bg-slate-400/30 text-slate-300' :
                    idx === 2 ? 'bg-amber-700/30 text-amber-600' :
                    'bg-white/10 text-white/60'
                  }`}>
                    {(entry.team_name || entry.display_name)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold truncate ${isMe ? 'text-amber-400' : 'text-white'}`}>
                      {entry.team_name || entry.display_name}
                      {isMe && <span className="ml-1 text-xs opacity-60">(you)</span>}
                    </div>
                    {entry.team_name && (
                      <div className="text-xs text-white/40 truncate">{entry.display_name}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-white/40">#{entry.rank}</span>
                      <span className="text-xs font-bold text-amber-400">{entry.total_points} pts</span>
                    </div>
                    <div className="mt-2">
                      <FormGuide form={formMap.get(entry.user_id) ?? []} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* INVITE TAB                                                        */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'invite' && (
        <div className="bg-[#161B22] border border-white/8 rounded-2xl p-6 backdrop-blur-sm max-w-lg">
          <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <BookOpen size={18} className="text-blue-400" />
            Invite Friends
          </h2>
          <p className="text-white/50 text-sm mb-6">
            Share this token with friends so they can join <strong className="text-white">{selectedLeague?.name}</strong>.
            They paste it into the Sign Up form.
          </p>

          {selectedLeague?.invite_token ? (
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
              <code className="flex-1 text-amber-300 font-mono text-sm break-all">
                {selectedLeague.invite_token}
              </code>
              <button
                onClick={copyInvite}
                className="shrink-0 p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                title="Copy invite token"
              >
                {copied ? <CheckCircle size={18} className="text-emerald-400" /> : <Copy size={18} />}
              </button>
            </div>
          ) : (
            <div className="text-white/30 text-sm">No invite token available for this league.</div>
          )}

          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300">
            💡 Tip: Admins can rotate tokens or create new ones via the Admin → Manage Users panel.
          </div>
        </div>
      )}
    </div>
  );
};
