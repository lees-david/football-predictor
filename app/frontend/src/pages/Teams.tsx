import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTournamentContext } from '../api/TournamentContext';
import { useFixtures } from '../api/hooks/useFixtures';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { getFifaRanking } from '../utils/fifaRankings';
import { formatDateTime } from '../utils/timezone';
import { Search, ArrowLeft, Calendar, Trophy, Flag, ShieldAlert, Sparkles, ChevronRight, Play } from 'lucide-react';

interface TeamInfo {
  name: string;
  logo: string | null;
  groupCode: string;
  rank: number;
  points: number | null;
  isEliminated: boolean;
}

export const Teams: React.FC = () => {
  const { selectedTournament } = useTournamentContext();
  const { data: fixtures, isLoading } = useFixtures(selectedTournament?.id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedTeamName = searchParams.get('team') || '';
  const [searchQuery, setSearchQuery] = useState('');

  // Extract unique teams and determine elimination status
  const teams = useMemo(() => {
    if (!fixtures) return [];

    const isPlaceholder = (name: string) => {
      const low = name.toLowerCase();
      return ['match', 'placeholder', 'winner', 'loser', 'runner', 'group'].some(x => low.includes(x));
    };

    const checkEliminated = (teamName: string, groupCode: string): boolean => {
      // Check KO stage matches first
      const koFixtures = fixtures.filter(f => f.stage !== 'group');
      const lostKo = koFixtures.some(f => 
        f.status === 'completed' &&
        (f.home_team === teamName || f.away_team === teamName) &&
        f.knockout_winner !== teamName
      );

      if (lostKo) {
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
          if (!presentInKo) return true;
        } else {
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

          stats.sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            if (b.gd !== a.gd) return b.gd - a.gd;
            return b.gf - a.gf;
          });

          const rankInGroup = stats.findIndex(s => s.team === teamName);
          if (rankInGroup === 3) {
            return true;
          }
        }
      }

      return false;
    };

    const tempMap = new Map<string, Omit<TeamInfo, 'isEliminated'>>();

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

    const resultList: TeamInfo[] = [];
    tempMap.forEach((teamData) => {
      const isEliminated = checkEliminated(teamData.name, teamData.groupCode);
      resultList.push({
        ...teamData,
        isEliminated,
      });
    });

    // Sort alphabetically by team name
    return resultList.sort((a, b) => a.name.localeCompare(b.name));
  }, [fixtures]);

  // Find currently selected team details
  const activeTeam = useMemo(() => {
    return teams.find(t => t.name.toLowerCase() === selectedTeamName.toLowerCase()) || null;
  }, [teams, selectedTeamName]);

  // Retrieve fixtures and results for the selected team
  const teamFixturesAndResults = useMemo(() => {
    if (!fixtures || !activeTeam) return { results: [], upcoming: [] };

    const teamName = activeTeam.name;
    const teamGames = fixtures.filter(
      f => f.home_team === teamName || f.away_team === teamName
    );

    // Sort by kickoff time
    const sortedGames = [...teamGames].sort(
      (a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
    );

    return {
      results: sortedGames.filter(f => f.status === 'completed'),
      upcoming: sortedGames.filter(f => f.status !== 'completed'),
    };
  }, [fixtures, activeTeam]);

  // Filtered list of teams for the initial/search screen
  const filteredTeams = useMemo(() => {
    return teams.filter(t => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;
      return t.name.toLowerCase().includes(query) || `group ${t.groupCode}`.toLowerCase().includes(query);
    });
  }, [teams, searchQuery]);

  const selectTeam = (teamName: string) => {
    setSearchParams({ team: teamName });
    setSearchQuery('');
  };

  const clearSelection = () => {
    setSearchParams({});
  };

  const STAGE_LABELS: Record<string, string> = {
    group: 'Group Stage',
    round_32: 'Round of 32',
    round_16: 'Round of 16',
    quarter_final: 'Quarter-Finals',
    semi_final: 'Semi-Finals',
    third_place: 'Third Place Play-off',
    final: 'Final',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-textMuted text-sm animate-pulse">Loading Teams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Selection screen (when no team is selected or selection is invalid) */}
      {!activeTeam ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
                <Flag className="text-amber-500" size={30} /> Teams Directory
              </h1>
              <p className="text-textMuted text-sm mt-1">
                Explore participating teams, check their FIFA rankings, view past match results, and see upcoming fixtures.
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
              <h3 className="text-lg font-bold text-white">No Teams Found</h3>
              <p className="text-sm max-w-md">
                No active fixtures found for this tournament yet. Ensure the tournament is properly seeded in the admin settings.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Controls */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:max-w-md">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by team name or group..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-textMuted font-semibold uppercase tracking-wider bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                    {filteredTeams.length} of {teams.length} Teams
                  </span>
                </div>
              </div>

              {/* Grid Layout of Teams */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredTeams.map(t => (
                  <Card
                    key={t.name}
                    onClick={() => selectTeam(t.name)}
                    className={`p-4 hover:border-amber-500/50 transition-all duration-300 cursor-pointer group flex flex-col justify-between h-40 border-white/5 relative overflow-hidden ${
                      t.isEliminated ? 'opacity-50 hover:opacity-80 grayscale-[30%] bg-white/[0.02]' : 'bg-white/[0.04] hover:bg-white/[0.06] shadow-md'
                    }`}
                  >
                    {/* Background glow on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                    <div className="flex justify-between items-start z-10">
                      <div className="flex items-center gap-3">
                        {t.logo ? (
                          <img
                            src={t.logo}
                            alt={t.name}
                            className="w-9 h-6 object-cover rounded shadow-sm border border-white/10"
                          />
                        ) : (
                          <div className="w-9 h-6 rounded bg-white/10 flex items-center justify-center font-bold text-xs text-white">
                            {t.name[0]}
                          </div>
                        )}
                        <div>
                          <h3 className="font-bold text-white group-hover:text-amber-400 transition-colors truncate max-w-[130px]" title={t.name}>
                            {t.name}
                          </h3>
                          <p className="text-xs text-textMuted font-medium">Group {t.groupCode}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-amber-500 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 font-mono">
                        #{t.rank === 999 ? 'N/A' : t.rank}
                      </span>
                    </div>

                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-white/5 z-10">
                      <div>
                        {t.isEliminated ? (
                          <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">
                            Eliminated
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-textMuted group-hover:text-white flex items-center gap-0.5 transition-colors font-medium">
                        View Details <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Team Detail Screen */
        <div className="space-y-6 animate-fadeIn">
          {/* Back Action */}
          <div>
            <button
              onClick={clearSelection}
              className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors group mb-2"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" /> Back to Teams Directory
            </button>
          </div>

          {/* Team Hero Header */}
          <Card className="p-6 md:p-8 bg-gradient-to-br from-white/[0.06] to-white/[0.02] border-white/10 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
            {/* Ambient Background decoration */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -z-10" />

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              {activeTeam.logo ? (
                <img
                  src={activeTeam.logo}
                  alt={activeTeam.name}
                  className="w-24 h-16 object-cover rounded-xl shadow-lg border-2 border-white/20"
                />
              ) : (
                <div className="w-24 h-16 rounded-xl bg-white/10 flex items-center justify-center font-bold text-3xl text-white shadow-lg">
                  {activeTeam.name[0]}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    {activeTeam.name}
                  </h1>
                  {activeTeam.isEliminated ? (
                    <span className="text-xs font-bold text-red-400 bg-red-400/10 px-3 py-1 rounded-full border border-red-400/20">
                      Eliminated
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/20 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Active
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-textMuted">
                  <span className="font-semibold px-2 py-0.5 rounded bg-white/5 text-white">Group {activeTeam.groupCode}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Trophy size={14} className="text-amber-500" />
                    FIFA Rank: <strong className="text-amber-400">#{activeTeam.rank === 999 ? 'N/A' : activeTeam.rank}</strong>
                    {activeTeam.points && ` (${activeTeam.points} pts)`}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick dropdown switcher */}
            <div className="flex items-center gap-2">
              <label htmlFor="team-switcher" className="text-xs text-textMuted font-semibold uppercase tracking-wider">Switch Team:</label>
              <select
                id="team-switcher"
                value={activeTeam.name}
                onChange={e => selectTeam(e.target.value)}
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
              >
                {teams.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name} (Group {t.groupCode})
                  </option>
                ))}
              </select>
            </div>
          </Card>

          {/* Results and Fixtures sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Results Section (Results to Date) */}
            {teamFixturesAndResults.results.length > 0 && (
              <Card className="p-6 border-white/5 flex flex-col h-fit">
                <div className="flex items-center gap-2 border-b border-white/5 pb-4 mb-4">
                  <Sparkles className="text-emerald-400" size={20} />
                  <h2 className="text-xl font-bold text-white">Results to Date</h2>
                </div>

                <div className="space-y-4">
                  {teamFixturesAndResults.results.map(fixture => {
                    const isHome = fixture.home_team === activeTeam.name;
                    const opponent = isHome ? fixture.away_team : fixture.home_team;
                    const opponentLogo = isHome ? fixture.away_logo : fixture.home_logo;
                    const teamScore = isHome ? fixture.home_score : fixture.away_score;
                    const oppScore = isHome ? fixture.away_score : fixture.home_score;
                    
                    let outcome: 'W' | 'D' | 'L' = 'D';
                    if (fixture.knockout_winner) {
                      outcome = fixture.knockout_winner === activeTeam.name ? 'W' : 'L';
                    } else if (teamScore !== null && oppScore !== null) {
                      if (teamScore > oppScore) outcome = 'W';
                      else if (teamScore < oppScore) outcome = 'L';
                    }

                    return (
                      <div
                        key={fixture.id}
                        onClick={() => navigate('/predictions')}
                        className="p-4 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-between gap-4"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                            {STAGE_LABELS[fixture.stage] || fixture.stage}
                          </span>
                          <div className="flex items-center gap-2.5 mt-1">
                            {opponentLogo ? (
                              <img
                                src={opponentLogo}
                                alt={opponent}
                                className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
                              />
                            ) : (
                              <div className="w-6 h-4 rounded bg-white/15 flex items-center justify-center font-bold text-[8px] text-white/60">
                                {opponent[0]}
                              </div>
                            )}
                            <span className="font-semibold text-white text-sm">vs {opponent}</span>
                          </div>
                          <span className="text-[10px] text-textMuted">{formatDateTime(fixture.kickoff_time)}</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="font-mono font-bold text-lg text-white">
                              {fixture.home_score} : {fixture.away_score}
                            </span>
                            {fixture.home_score_aet !== null && fixture.away_score_aet !== null && (
                              <div className="text-[9px] text-amber-400 font-semibold tracking-wide uppercase">
                                AET {fixture.home_score_aet} : {fixture.away_score_aet}
                              </div>
                            )}
                          </div>

                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-xs border ${
                            outcome === 'W'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : outcome === 'L'
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}>
                            {outcome}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Fixtures Section (Upcoming Fixtures) */}
            {teamFixturesAndResults.upcoming.length > 0 && (
              <Card className="p-6 border-white/5 flex flex-col h-fit">
                <div className="flex items-center gap-2 border-b border-white/5 pb-4 mb-4">
                  <Calendar className="text-amber-500" size={20} />
                  <h2 className="text-xl font-bold text-white">Upcoming Fixtures</h2>
                </div>

                <div className="space-y-4">
                  {teamFixturesAndResults.upcoming.map(fixture => {
                    const isHome = fixture.home_team === activeTeam.name;
                    const opponent = isHome ? fixture.away_team : fixture.home_team;
                    const opponentLogo = isHome ? fixture.away_logo : fixture.home_logo;
                    const isLive = fixture.status === 'live';

                    return (
                      <div
                        key={fixture.id}
                        className={`p-4 bg-white/[0.02] border rounded-xl flex items-center justify-between gap-4 transition-all duration-200 ${
                          isLive 
                            ? 'border-emerald-500/30 bg-emerald-500/[0.02]' 
                            : 'border-white/5 hover:border-white/10 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                              {STAGE_LABELS[fixture.stage] || fixture.stage}
                            </span>
                            {isLive && (
                              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20 animate-pulse flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-emerald-400" /> LIVE
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 mt-1">
                            {opponentLogo ? (
                              <img
                                src={opponentLogo}
                                alt={opponent}
                                className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
                              />
                            ) : (
                              <div className="w-6 h-4 rounded bg-white/15 flex items-center justify-center font-bold text-[8px] text-white/60">
                                {opponent[0]}
                              </div>
                            )}
                            <span className="font-semibold text-white text-sm">vs {opponent}</span>
                          </div>
                          <span className="text-[10px] text-textMuted">{formatDateTime(fixture.kickoff_time)}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate('/predictions')}
                            className={`flex items-center gap-1.5 rounded-xl text-xs py-1.5 px-3 transition-all duration-200 border ${
                              isLive 
                                ? 'bg-emerald-500/15 hover:bg-emerald-500 text-emerald-400 hover:text-black border-emerald-500/20 hover:border-emerald-500' 
                                : 'bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black border-amber-500/20 hover:border-amber-500'
                            }`}
                          >
                            {isLive ? <Play size={12} className="fill-current" /> : null}
                            Predict
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Empty state if both are empty */}
            {teamFixturesAndResults.results.length === 0 && teamFixturesAndResults.upcoming.length === 0 && (
              <Card className="col-span-full p-8 text-center text-textMuted flex flex-col items-center justify-center gap-2 border-white/5 bg-white/[0.02]">
                <ShieldAlert size={36} className="text-amber-500/60" />
                <h3 className="text-base font-bold text-white">No Match Fixtures</h3>
                <p className="text-xs max-w-sm">
                  This team has no fixtures scheduled and has not played any completed matches in the system.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
