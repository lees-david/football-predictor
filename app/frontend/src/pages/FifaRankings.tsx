import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournamentContext } from '../api/TournamentContext';
import { useFixtures } from '../api/hooks/useFixtures';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { getFifaRanking } from '../utils/fifaRankings';
import { Search, ArrowUpDown, Trophy, ArrowRight, ShieldAlert } from 'lucide-react';

interface TeamRow {
  name: string;
  logo: string | null;
  groupCode: string;
  rank: number;
  points: number | null;
  isEliminated: boolean;
}

export const FifaRankings: React.FC = () => {
  const { selectedTournament } = useTournamentContext();
  const { data: fixtures, isLoading } = useFixtures(selectedTournament?.id);
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'rank' | 'name' | 'group'>('rank');
  const [sortAsc, setSortAsc] = useState(true);

  // Extract unique teams and determine elimination status
  const teams = useMemo(() => {
    if (!fixtures) return [];
    
    // 1. Helper to check if a name is a placeholder
    const isPlaceholder = (name: string) => {
      const low = name.toLowerCase();
      return ['match', 'placeholder', 'winner', 'loser', 'runner', 'group'].some(x => low.includes(x));
    };

    // 2. Helper to check if a team is eliminated
    const checkEliminated = (teamName: string, groupCode: string): boolean => {
      // Check KO stage matches first
      const koFixtures = fixtures.filter(f => f.stage !== 'group');
      const lostKo = koFixtures.some(f => 
        f.status === 'completed' &&
        (f.home_team === teamName || f.away_team === teamName) &&
        f.knockout_winner !== teamName
      );

      if (lostKo) {
        // If they lost a KO match, they are eliminated unless they are scheduled in another active/future KO match (e.g. 3rd-place match)
        const isScheduledInOtherKo = koFixtures.some(f => 
          f.status !== 'completed' &&
          (f.home_team === teamName || f.away_team === teamName)
        );
        if (!isScheduledInOtherKo) {
          return true;
        }
      }

      // Check Group Stage
      const groupFixtures = fixtures.filter(f => f.stage === 'group' && f.group_code === groupCode);
      if (groupFixtures.length > 0 && groupFixtures.every(f => f.status === 'completed')) {
        const allGroupFixtures = fixtures.filter(f => f.stage === 'group');
        const allGroupCompleted = allGroupFixtures.every(f => f.status === 'completed');

        const presentInKo = koFixtures.some(f => 
          f.home_team === teamName || f.away_team === teamName
        );

        if (allGroupCompleted) {
          // If the entire group stage is finished, they must be in a KO fixture to still be active
          if (!presentInKo) return true;
        } else {
          // If only their group is completed, calculate group standings. 4th place is always eliminated.
          const teamsInGroup = Array.from(new Set(groupFixtures.flatMap(f => [f.home_team, f.away_team])));
          const stats = teamsInGroup.map(t => {
            let pts = 0, gd = 0, gf = 0;
            groupFixtures.forEach(f => {
              if (f.home_score !== null && f.away_score !== null) {
                if (f.home_team === t) {
                  gf += f.home_score;
                  gd += (f.home_score - f.away_score);
                  if (f.home_score > f.away_score) pts += 3;
                  else if (f.home_score === f.away_score) pts += 1;
                } else if (f.away_team === t) {
                  gf += f.away_score;
                  gd += (f.away_score - f.home_score);
                  if (f.away_score > f.home_score) pts += 3;
                  else if (f.away_score === f.home_score) pts += 1;
                }
              }
            });
            return { team: t, pts, gd, gf };
          });

          // Sort group standing
          stats.sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            if (b.gd !== a.gd) return b.gd - a.gd;
            return b.gf - a.gf;
          });

          const rankInGroup = stats.findIndex(s => s.team === teamName);
          if (rankInGroup === 3) {
            return true; // 4th place is eliminated
          }
        }
      }

      return false;
    };

    const tempMap = new Map<string, Omit<TeamRow, 'isEliminated'>>();

    fixtures.forEach(f => {
      if (f.stage === 'group' && f.group_code) {
        if (f.home_team && !isPlaceholder(f.home_team) && !tempMap.has(f.home_team)) {
          const rankInfo = getFifaRanking(f.home_team);
          tempMap.set(f.home_team, {
            name: f.home_team,
            logo: f.home_logo,
            groupCode: f.group_code,
            rank: rankInfo?.rank ?? 999,
            points: rankInfo?.points ?? null,
          });
        }
        if (f.away_team && !isPlaceholder(f.away_team) && !tempMap.has(f.away_team)) {
          const rankInfo = getFifaRanking(f.away_team);
          tempMap.set(f.away_team, {
            name: f.away_team,
            logo: f.away_logo,
            groupCode: f.group_code,
            rank: rankInfo?.rank ?? 999,
            points: rankInfo?.points ?? null,
          });
        }
      }
    });

    const resultList: TeamRow[] = [];
    tempMap.forEach((teamData) => {
      const isEliminated = checkEliminated(teamData.name, teamData.groupCode);
      resultList.push({
        ...teamData,
        isEliminated,
      });
    });

    return resultList;
  }, [fixtures]);

  // Handle sorting toggles
  const handleSort = (field: 'rank' | 'name' | 'group') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Filter and Sort teams list
  const filteredAndSortedTeams = useMemo(() => {
    let result = teams.filter(t => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;

      // Match group filters like "Group A" or "A"
      const groupMatch = query.match(/^(?:group\s+)?([a-l])$/i);
      if (groupMatch) {
        return t.groupCode.toLowerCase() === groupMatch[1].toLowerCase();
      }

      return t.name.toLowerCase().includes(query) || `group ${t.groupCode}`.toLowerCase().includes(query);
    });

    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'rank') {
        comparison = a.rank - b.rank;
      } else if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'group') {
        comparison = a.groupCode.localeCompare(b.groupCode);
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [teams, searchQuery, sortField, sortAsc]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-textMuted text-sm animate-pulse">Loading FIFA rankings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            🏆 FIFA Rankings
          </h1>
          <p className="text-textMuted text-sm mt-1">
            Reference guide of all participating teams, their official ranks, and tournament groups.
          </p>
        </div>
        {selectedTournament && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
            <Trophy size={14} />
            {selectedTournament.name}
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <Card className="p-8 text-center text-textMuted flex flex-col items-center justify-center gap-2 border-white/5">
          <ShieldAlert size={40} className="text-amber-500/80" />
          <h3 className="text-lg font-bold text-white">No Teams Discovered</h3>
          <p className="text-sm max-w-md">
            No active group stage fixtures were found for this tournament yet. Ensure the tournament is seeded.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:max-w-sm">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted w-4 h-4" />
              <input
                type="text"
                placeholder="Search teams or groups (e.g., 'Group C')..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
              />
            </div>
            <div className="text-xs text-textMuted font-semibold uppercase tracking-wider">
              Showing {filteredAndSortedTeams.length} of {teams.length} teams
            </div>
          </div>

          {/* Rankings Table */}
          <Card className="overflow-hidden border-white/5 rounded-2xl glass-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/5">
                    <th
                      onClick={() => handleSort('rank')}
                      className="px-6 py-4 text-xs font-semibold text-textMuted uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        Rank
                        <ArrowUpDown size={12} className={sortField === 'rank' ? 'text-amber-500' : 'text-textMuted/60'} />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('name')}
                      className="px-6 py-4 text-xs font-semibold text-textMuted uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        Team
                        <ArrowUpDown size={12} className={sortField === 'name' ? 'text-amber-500' : 'text-textMuted/60'} />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('group')}
                      className="px-6 py-4 text-xs font-semibold text-textMuted uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        Group
                        <ArrowUpDown size={12} className={sortField === 'group' ? 'text-amber-500' : 'text-textMuted/60'} />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-xs font-semibold text-textMuted uppercase tracking-wider">
                      Points
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-textMuted uppercase tracking-wider">
                      Status / Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredAndSortedTeams.map(t => (
                    <tr
                      key={t.name}
                      onClick={() => navigate(`/teams?team=${encodeURIComponent(t.name)}`)}
                      className={`transition-colors duration-150 hover:bg-white/5 cursor-pointer group ${
                        t.isEliminated ? 'opacity-70 bg-black/5' : ''
                      }`}
                    >
                      <td className="px-6 py-4 text-sm font-mono font-bold text-amber-500">
                        #{t.rank === 999 ? 'N/A' : t.rank}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-white">
                        <div className="flex items-center gap-3">
                          {t.logo ? (
                            <img
                              src={t.logo}
                              alt={t.name}
                              className="w-7 h-4.5 object-cover rounded shadow-sm border border-white/10"
                            />
                          ) : (
                            <div className="w-7 h-5 rounded bg-white/5 flex items-center justify-center font-bold text-xs text-white">
                              {t.name[0]}
                            </div>
                          )}
                          <span className={`${!t.isEliminated ? 'group-hover:text-amber-400' : 'text-textMuted'} transition-colors`}>{t.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-textMuted">
                        Group {t.groupCode}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-textMuted">
                        {t.points ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {t.isEliminated ? (
                          <span className="text-xs text-red-500/80 font-bold uppercase tracking-wider bg-red-500/10 px-2.5 py-1 rounded-xl border border-red-500/20">
                            Eliminated
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate('/predictions');
                            }}
                            className="inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/20 hover:border-amber-500 rounded-xl text-xs py-1.5 px-3 transition-all duration-200"
                          >
                            Predict <ArrowRight size={12} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
