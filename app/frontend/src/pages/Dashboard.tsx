import React from 'react';
import { useMe } from '../api/hooks/useAuth';
import { useMyLeagues, useGlobalRank, useLeaderboard } from '../api/hooks/useRankings';
import { useFixtures } from '../api/hooks/useFixtures';
import { useMyPredictions } from '../api/hooks/usePredictions';
import { useMyBracket } from '../api/hooks/useBracket';
import { Card } from '../components/ui/Card';
import { useTournamentContext } from '../api/TournamentContext';
import { Trophy, Target, Clock, ArrowUpRight, Users, CheckCircle2, Calendar, MapPin, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../utils/timezone';
import { cleanTeamName } from '../utils/teamNames';

export const Dashboard: React.FC = () => {
  const { selectedTournamentId } = useTournamentContext();
  const { data: user } = useMe();
  const { data: leagues } = useMyLeagues(selectedTournamentId);
  const { data: globalRank } = useGlobalRank(selectedTournamentId);
  const { data: fixtures = [] } = useFixtures(selectedTournamentId);
  const { data: predictions = [] } = useMyPredictions(selectedTournamentId);
  const { data: bracket } = useMyBracket(selectedTournamentId);

  const [selectedLeagueId, setSelectedLeagueId] = React.useState<number | null>(null);

  // Set default selected league once loaded
  React.useEffect(() => {
    if (leagues && leagues.length > 0 && selectedLeagueId === null) {
      setSelectedLeagueId(leagues[0].id);
    }
  }, [leagues, selectedLeagueId]);

  const { data: leaderboardEntries = [], isLoading: isLoadingLeaderboard } = useLeaderboard(selectedLeagueId);

  const now = new Date();

  // -------------------------------------------------------------------------
  // Prediction Statistics Calculations
  // -------------------------------------------------------------------------
  const gradedPredictions = predictions.filter(p => {
    const fixture = fixtures.find(f => f.id === p.fixture_id);
    return fixture && fixture.status === 'completed';
  });

  const totalGraded = gradedPredictions.length;
  const exactCount = gradedPredictions.filter(p => p.points_awarded === 5).length;
  const partialCount = gradedPredictions.filter(p => p.points_awarded === 3 || p.points_awarded === 2).length;

  const totalPredictions = predictions.length;
  const totalFixtures = fixtures.length;
  const submissionRate = totalFixtures > 0 ? Math.round((totalPredictions / totalFixtures) * 100) : 0;
  const accuracyRate = totalGraded > 0 ? Math.round(((exactCount + partialCount) / totalGraded) * 100) : 0;

  // Active (open) fixtures: scheduled, kickoff > 15 min away
  const activeFixtures = fixtures.filter(f => {
    if (f.status !== 'scheduled') return false;
    const lockMs = new Date(f.kickoff_time).getTime() - 15 * 60000;
    return now.getTime() < lockMs;
  });
  const predictedActiveCount = activeFixtures.filter(f => predictions.some(p => p.fixture_id === f.id)).length;
  const allActiveFixturesPredicted = activeFixtures.length > 0 && predictedActiveCount === activeFixtures.length;

  // -------------------------------------------------------------------------
  // Next Match & Last Match Calculations
  // -------------------------------------------------------------------------
  
  // 1. Next Match (upcoming scheduled fixture)
  const nextScheduledFixture = [...fixtures]
    .filter(f => f.status === 'scheduled' && new Date(f.kickoff_time).getTime() > now.getTime())
    .sort((a, b) => {
      const dateA = new Date(a.kickoff_time).getTime();
      const dateB = new Date(b.kickoff_time).getTime();
      if (dateA !== dateB) return dateA - dateB;
      const groupA = a.group_code || '';
      const groupB = b.group_code || '';
      return groupA.localeCompare(groupB);
    })[0];
    
  const predictionForNext = nextScheduledFixture
    ? predictions.find(p => p.fixture_id === nextScheduledFixture.id)
    : undefined;

  // 2. Recent Matches (up to 5 most recently completed fixtures)
  const recentCompletedFixtures = [...fixtures]
    .filter(f => f.status === 'completed')
    .sort((a, b) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime())
    .slice(0, 5);

  const getMatchTypeName = (stage: string, groupCode: string | null) => {
    switch (stage) {
      case 'group':
        return groupCode ? `Group ${groupCode}` : 'Group Stage';
      case 'round_32':
        return 'R32';
      case 'round_16':
        return 'R16';
      case 'quarter_final':
        return 'QF';
      case 'semi_final':
        return 'SF';
      case 'third_place':
        return '3rd Place';
      case 'final':
        return 'Final';
      default:
        return stage.replace('_', ' ');
    }
  };

  // -------------------------------------------------------------------------
  // Readiness Checklist logic (identical to Instructions.tsx)
  // -------------------------------------------------------------------------
  const hasJoinedLeague = leagues && leagues.length > 0;

  // Helper to compute status per stage gate
  const getStageStatus = (
    stageName: string,
    prevStageName: string | null
  ): { status: 'completed' | 'active' | 'pending' | 'missed'; deadline?: string } => {
    const isStage6 = stageName === 'stage_6';

    // 1. Filter stage fixtures
    const stageFixtures = fixtures.filter(f => {
      if (isStage6) {
        return f.stage === 'third_place' || f.stage === 'final';
      }
      if (stageName === 'stage_1') return f.stage === 'group';
      if (stageName === 'stage_2') return f.stage === 'round_32';
      if (stageName === 'stage_3') return f.stage === 'round_16';
      if (stageName === 'stage_4') return f.stage === 'quarter_final';
      if (stageName === 'stage_5') return f.stage === 'semi_final';
      return false;
    });

    if (stageFixtures.length === 0) {
      return { status: 'pending' };
    }

    // 2. Compute minimum kickoff time
    const kickoffTimes = stageFixtures.map(f => new Date(f.kickoff_time).getTime());
    const firstKickoffMs = Math.min(...kickoffTimes);
    const firstKickoff = new Date(firstKickoffMs);
    const anyCompleted = stageFixtures.some(f => f.status === 'completed');
    const isPastKickoff = now.getTime() >= firstKickoffMs || anyCompleted;

    // 3. Count predictions
    const predictionsCount = predictions.filter(p =>
      stageFixtures.some(f => f.id === p.fixture_id)
    ).length;

    const allPredicted = predictionsCount === stageFixtures.length;

    // 4. Check previous stage
    let isPrevStageConcluded = true;
    if (prevStageName) {
      const prevFixtures = fixtures.filter(f => {
        if (prevStageName === 'stage_1') return f.stage === 'group';
        if (prevStageName === 'stage_2') return f.stage === 'round_32';
        if (prevStageName === 'stage_3') return f.stage === 'round_16';
        if (prevStageName === 'stage_4') return f.stage === 'quarter_final';
        if (prevStageName === 'stage_5') return f.stage === 'semi_final';
        return false;
      });
      isPrevStageConcluded = prevFixtures.length > 0 && prevFixtures.every(f => f.status === 'completed');
    }

    if (!isPrevStageConcluded) {
      return { status: 'pending' };
    }
    if (isPastKickoff && !allPredicted) {
      return { status: 'missed', deadline: firstKickoff.toLocaleString() };
    }
    if (isPastKickoff || allPredicted) {
      return { status: 'completed', deadline: firstKickoff.toLocaleString() };
    }
    return { status: 'active', deadline: firstKickoff.toLocaleString() };
  };

  const s1 = getStageStatus('stage_1', null);
  const s2 = getStageStatus('stage_2', 'stage_1');
  const s3 = getStageStatus('stage_3', 'stage_2');
  const s4 = getStageStatus('stage_4', 'stage_3');
  const s5 = getStageStatus('stage_5', 'stage_4');
  const s6 = getStageStatus('stage_6', 'stage_5');

  const hasGroupPicks = bracket && Array.isArray(bracket.group_picks) && bracket.group_picks.length > 0;
  const hasKoPicks = bracket && Array.isArray(bracket.ko_picks) && bracket.ko_picks.length > 0;

  const groupPicksStatus = (() => {
    if (hasGroupPicks) return 'completed';
    if (s1.status === 'pending') return 'pending';
    return 'active';
  })();
  const koPicksStatus = (() => {
    if (!hasGroupPicks) return 'pending';
    if (hasKoPicks) return 'completed';
    if (s1.status === 'pending') return 'pending';
    return 'active';
  })();

  const checklistItems: Array<{ title: string; desc: string; status: 'completed' | 'active' | 'pending' | 'missed'; link: string }> = [
    {
      title: 'Join or Create a League',
      desc: 'Compete in a private league with friends.',
      status: hasJoinedLeague ? 'completed' : 'active',
      link: '/leagues'
    },
    {
      title: 'Stage 1a: Predict 72 Group Match Scorelines',
      desc: 'Predict scorelines for all 72 group stage matches.',
      status: s1.status,
      link: '/predictions'
    },
    {
      title: 'Stage 1b: Predict Group Standings',
      desc: 'Predict the final standings for all 12 groups.',
      status: groupPicksStatus,
      link: '/bracket'
    },
    {
      title: 'Stage 1c: Predict Knockout Winners',
      desc: 'Build your full knockout bracket. Requires group picks to be saved first.',
      status: koPicksStatus,
      link: '/bracket?tab=ko'
    },
    {
      title: 'Stage 2 Predictions',
      desc: 'Predict Round of 32 scorelines.',
      status: s2.status,
      link: '/predictions'
    },
    {
      title: 'Stage 3 Predictions',
      desc: 'Predict Round of 16 scorelines.',
      status: s3.status,
      link: '/predictions'
    },
    {
      title: 'Stage 4 Predictions',
      desc: 'Predict Quarterfinals scorelines.',
      status: s4.status,
      link: '/predictions'
    },
    {
      title: 'Stage 5 Predictions',
      desc: 'Predict Semifinals scorelines.',
      status: s5.status,
      link: '/predictions'
    },
    {
      title: 'Stage 6 Predictions',
      desc: 'Predict Finals Weekend scorelines.',
      status: s6.status,
      link: '/predictions'
    }
  ];

  const nextOpenItem = checklistItems.find(item => item.status === 'active');
  const hasMissedItems = checklistItems.some(item => item.status === 'missed');

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back, {user?.display_name}</h1>
          <p className="text-textMuted">Here's your prediction center overview.</p>
        </div>
      </div>

      {/* Top Stats - Enforced identical tile heights and layout stretching */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
        <div className="h-full">
          <Card className="hover:border-primary/50 transition-colors group cursor-default relative overflow-hidden h-full flex flex-col justify-between min-h-[115px]">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Trophy size={48} className="text-primary" />
            </div>
            <div>
              <div className="text-textMuted text-xs font-semibold uppercase tracking-wider mb-1.5">Total Points</div>
              <div className="text-4xl font-bold text-white leading-none mt-2">{user?.total_points || 0}</div>
              {globalRank && globalRank.total_players > 0 && (
                <div className="text-xs text-textMuted mt-2 font-semibold">
                  {globalRank.rank != null
                    ? <span>Global rank <span className="text-primary font-mono">#{globalRank.rank}</span> of {globalRank.total_players}</span>
                    : <span>of {globalRank.total_players} players</span>
                  }
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="h-full">
          <Link to="/leagues" className="block cursor-pointer h-full">
            <Card className="hover:border-primary/50 transition-colors group relative overflow-hidden h-full flex flex-col justify-between min-h-[115px]">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Users size={48} className="text-secondary" />
              </div>
              <div>
                <div className="text-textMuted text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  Joined Leagues <ArrowUpRight size={12} className="opacity-40 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-4xl font-bold text-white leading-none mt-2">{leagues?.length || 0}</div>
              </div>
            </Card>
          </Link>
        </div>

        <div className="h-full">
          {nextOpenItem ? (
            <Link to={nextOpenItem.link} className="block cursor-pointer h-full">
              <Card className="hover:border-amber-500/50 transition-all group relative overflow-hidden bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/20 h-full flex flex-col justify-between min-h-[115px]">
                <div className="absolute top-0 right-0 p-4 opacity-15 group-hover:opacity-30 transition-opacity">
                  <CheckCircle2 size={48} className="text-amber-500 animate-pulse" />
                </div>
                <div>
                  <div className="text-amber-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    Action Needed
                  </div>
                  <div className="text-base font-bold text-white truncate w-[85%] mt-1">{nextOpenItem.title}</div>
                  <div className="text-[11px] text-textMuted truncate w-[85%] mt-0.5">{nextOpenItem.desc}</div>
                </div>
              </Card>
            </Link>
          ) : hasMissedItems ? (
            <Card className="hover:border-red-500/50 transition-colors group cursor-default relative overflow-hidden bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20 h-full flex flex-col justify-between min-h-[115px]">
              <div className="absolute top-0 right-0 p-4 opacity-15 group-hover:opacity-30 transition-opacity">
                <CheckCircle2 size={48} className="text-red-500" />
              </div>
              <div>
                <div className="text-red-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">Status</div>
                <div className="text-base font-bold text-white mt-1">Predictions Missed</div>
                <div className="text-[11px] text-textMuted mt-0.5">Some prediction windows have closed.</div>
              </div>
            </Card>
          ) : (
            <Card className="hover:border-success/50 transition-colors group cursor-default relative overflow-hidden bg-gradient-to-br from-success/10 to-transparent border-success/20 h-full flex flex-col justify-between min-h-[115px]">
              <div className="absolute top-0 right-0 p-4 opacity-15 group-hover:opacity-30 transition-opacity">
                <Trophy size={48} className="text-success" />
              </div>
              <div>
                <div className="text-success text-[10px] font-bold uppercase tracking-wider mb-1.5">Status</div>
                <div className="text-base font-bold text-white mt-1">100% Prepared 🏆</div>
                <div className="text-[11px] text-textMuted mt-0.5">All checklist items are completed!</div>
              </div>
            </Card>
          )}
        </div>
        
        <div className="h-full">
          <Card className={`hover:border-primary/50 transition-colors group cursor-default relative overflow-hidden h-full flex flex-col justify-between min-h-[115px] ${
            allActiveFixturesPredicted && totalGraded === 0
              ? 'bg-gradient-to-br from-success/10 to-transparent border-success/30'
              : 'bg-gradient-to-br from-primary/10 to-transparent'
          }`}>
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Target size={48} className="text-primary" />
            </div>
            <div>
              {totalGraded > 0 ? (
                <>
                  <div className="text-textMuted text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Prediction Accuracy
                  </div>
                  <div className="text-3xl font-bold text-white leading-none mt-2">
                    {accuracyRate}%
                  </div>
                  <div className="text-[10px] text-textMuted mt-2 font-semibold flex items-center gap-1.5">
                    <span className="text-success">🎯 {exactCount} Perfect</span>
                    <span>•</span>
                    <span className="text-primary">👍 {partialCount} Outcome</span>
                  </div>
                </>
              ) : allActiveFixturesPredicted ? (
                <>
                  <div className="text-success text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Prediction Progress
                  </div>
                  <div className="text-3xl font-bold text-success leading-none mt-2">
                    {totalPredictions} / {totalFixtures}
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1 mt-2 overflow-hidden">
                    <div
                      className="bg-success h-1 rounded-full transition-all duration-500"
                      style={{ width: `${submissionRate}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-success/80 mt-1.5 font-bold">
                    ✓ All available matches predicted
                  </div>
                </>
              ) : (
                <>
                  <div className="text-textMuted text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Prediction Progress
                  </div>
                  <div className="text-3xl font-bold text-white leading-none mt-2">
                    {totalPredictions} / {totalFixtures}
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1 mt-2 overflow-hidden">
                    <div
                      className="bg-primary h-1 rounded-full transition-all duration-500"
                      style={{ width: `${submissionRate}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-textMuted mt-1.5 font-semibold">
                    {submissionRate}% predicted
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Main Grid: Wide Leagues Tile + Narrow stacked Right Tile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        {/* Left Column: Leagues & Mini-Leaderboard Widget (Wider - lg:col-span-2) */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* My Leagues Card */}
          <Card title="My Leagues" className="h-full">
            {leagues && leagues.length > 0 ? (
              <div className="space-y-3">
                {leagues.map(l => {
                  const isSelected = selectedLeagueId === l.id;
                  return (
                    <div
                      key={l.id}
                      onClick={() => setSelectedLeagueId(l.id)}
                      className={`flex justify-between items-center p-3 rounded-xl border transition-all duration-200 cursor-pointer w-full text-left group ${
                        isSelected
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-primary/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {l.logo_url ? (
                          <img src={l.logo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-white/10" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 border border-white/10">
                            <Users size={14} className="text-textMuted" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-white text-sm group-hover:text-primary transition-colors truncate">{l.name}</div>
                          <div className="text-[10px] text-textMuted mt-0.5">{l.member_count || 1} Members</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {l.my_rank !== undefined && l.my_rank !== null ? (
                          <div className="text-right">
                            <div className="text-[9px] text-textMuted font-semibold leading-none">Rank</div>
                            <div className="font-black text-sm text-primary font-mono mt-0.5">#{l.my_rank}</div>
                          </div>
                        ) : (
                          <div className="text-right">
                            <div className="text-[9px] text-textMuted font-semibold leading-none">Rank</div>
                            <div className="font-bold text-white/30 text-xs mt-0.5">Unranked</div>
                          </div>
                        )}
                        <Link
                          to={`/leaderboard?leagueId=${l.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded bg-white/5 hover:bg-white/10 text-textMuted hover:text-white transition-colors"
                          title="View Full Leaderboard"
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center p-8 text-textMuted flex flex-col items-center justify-center h-[200px]">
                <Users className="w-12 h-12 mb-3 opacity-20" />
                <p>You haven't joined any leagues yet.</p>
                <Link to="/leagues" className="text-primary hover:underline mt-2 text-sm">
                  Join or Create a League
                </Link>
              </div>
            )}
          </Card>

          {/* Standings Preview Card */}
          <Card
            title={
              <div className="flex justify-between items-center w-full">
                <span>Standings Preview</span>
                {selectedLeagueId && leagues && leagues.length > 0 && (
                  <Link
                    to={`/leaderboard?leagueId=${selectedLeagueId}`}
                    className="text-xs text-primary hover:underline flex items-center gap-0.5"
                  >
                    View Full <ArrowUpRight size={12} />
                  </Link>
                )}
              </div>
            }
            className="h-full"
          >
            {selectedLeagueId ? (
              isLoadingLeaderboard ? (
                <div className="flex flex-col gap-2.5 animate-pulse">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-white/5 rounded-xl" />
                  ))}
                </div>
              ) : leaderboardEntries && leaderboardEntries.length > 0 ? (
                <div className="space-y-2">
                  {leaderboardEntries.slice(0, 5).map((entry) => {
                    const isCurrentUser = entry.user_id === user?.id;
                    const rank = entry.rank;
                    const isPodium = rank <= 3;
                    const podiumColors =
                      rank === 1
                        ? 'text-amber-400'
                        : rank === 2
                        ? 'text-slate-300'
                        : 'text-amber-600';

                    return (
                      <div
                        key={entry.user_id}
                        className={`flex justify-between items-center p-2 px-3 rounded-lg text-xs ${
                          isCurrentUser
                            ? 'bg-primary/20 border border-primary/30'
                            : 'bg-white/5 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-5 font-mono text-center font-bold ${
                              isPodium ? podiumColors : 'text-textMuted'
                            }`}
                          >
                            {isPodium ? (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉') : `#${rank}`}
                          </span>
                          <div className="min-w-0">
                            <div className={`font-semibold truncate ${isCurrentUser ? 'text-primary' : 'text-white'}`}>
                              {entry.display_name}
                            </div>
                            {entry.team_name && (
                              <div className="text-[10px] text-textMuted truncate leading-none mt-0.5">
                                {entry.team_name}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="font-bold text-white font-mono flex-shrink-0">
                          {entry.total_points} <span className="text-[9px] font-normal text-textMuted font-sans">pts</span>
                        </div>
                      </div>
                    );
                  })}

                  {(() => {
                    const userEntryIndex = leaderboardEntries.findIndex(e => e.user_id === user?.id);
                    if (userEntryIndex > 4) {
                      const userEntry = leaderboardEntries[userEntryIndex];
                      return (
                        <>
                          <div className="flex justify-center my-1">
                            <span className="text-textMuted text-[10px]">• • •</span>
                          </div>
                          <div className="flex justify-between items-center p-2 px-3 rounded-lg text-xs bg-primary/20 border border-primary/30">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-5 font-mono text-center font-bold text-primary">
                                #{userEntry.rank}
                              </span>
                              <div className="min-w-0">
                                <div className="font-semibold text-primary truncate">
                                  {userEntry.display_name} (You)
                                </div>
                                {userEntry.team_name && (
                                  <div className="text-[10px] text-primary/70 truncate leading-none mt-0.5">
                                    {userEntry.team_name}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="font-bold text-primary font-mono flex-shrink-0">
                              {userEntry.total_points} <span className="text-[9px] font-normal text-primary/70 font-sans">pts</span>
                            </div>
                          </div>
                        </>
                      );
                    }
                    return null;
                  })()}
                </div>
              ) : (
                <div className="text-center py-10 text-xs text-textMuted">No standings found for this league.</div>
              )
            ) : (
              <div className="text-center py-10 text-xs text-textMuted">Select a league on the left to see standings.</div>
            )}
          </Card>
        </div>

        {/* Right Column: Next Match & Last Match Results Stack (Narrower - lg:col-span-1) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Next Match Widget */}
          <Card title={<span className="flex items-center gap-2 text-primary"><Clock size={16} /> Next Match</span>}>
            {nextScheduledFixture ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-center gap-4 w-full">
                    <span className="font-bold text-white text-sm w-[40%] truncate text-right">{nextScheduledFixture.home_team}</span>
                    <span className="text-textMuted text-xs font-extrabold uppercase">VS</span>
                    <span className="font-bold text-white text-sm w-[40%] truncate text-left">{nextScheduledFixture.away_team}</span>
                  </div>
                </div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-textMuted">
                    <Calendar size={13} className="text-primary" />
                    <span>{formatDateTime(nextScheduledFixture.kickoff_time, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-textMuted">
                    <MapPin size={13} className="text-primary" />
                    <span className="truncate">{nextScheduledFixture.venue || 'TBD Venue'}</span>
                  </div>
                  
                  <div className="border-t border-white/5 pt-3 mt-1">
                    {predictionForNext ? (
                      <div className="p-2 bg-success/10 border border-success/20 rounded text-success text-center font-semibold">
                        🎯 Predicted: {predictionForNext.predicted_home} - {predictionForNext.predicted_away}
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded text-amber-500 text-center flex flex-col items-center gap-1.5 font-semibold">
                        <span>⚠️ No prediction submitted yet</span>
                        <Link to="/predictions" className="inline-flex items-center gap-1 text-[11px] hover:underline text-primary">
                          Predict now <Play size={10} fill="currentColor" />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-textMuted text-xs">
                No upcoming scheduled matches.
              </div>
            )}
          </Card>

          {/* Recent Match Results Widget */}
          <Card title={<span className="flex items-center gap-2 text-primary"><Target size={16} /> Recent Match Results</span>}>
            {recentCompletedFixtures.length > 0 ? (
              <div className="space-y-4">
                {recentCompletedFixtures.map((fixture, idx) => {
                  const prediction = predictions.find(p => p.fixture_id === fixture.id);
                  const cleanHome = cleanTeamName(fixture.home_team);
                  const cleanAway = cleanTeamName(fixture.away_team);

                  return (
                    <div key={fixture.id} className={`flex flex-col gap-2 ${idx > 0 ? 'border-t border-white/5 pt-4' : ''}`}>
                      {/* Top Row: Stage/Group & Prediction Badge */}
                      <div className="flex justify-between items-center text-[10px] font-semibold tracking-wider uppercase text-textMuted">
                        <span>{getMatchTypeName(fixture.stage, fixture.group_code)}</span>
                        <div>
                          {prediction ? (
                            (() => {
                              const pts = prediction.points_awarded ?? 0;
                              if (pts === 5) return <span className="text-emerald-400 font-bold">🎯 +5 pts</span>;
                              if (pts === 3) return <span className="text-blue-400 font-bold">📐 +3 pts</span>;
                              if (pts === 2) return <span className="text-amber-400 font-bold">👍 +2 pts</span>;
                              return <span className="text-red-400/80">❌ 0 pts</span>;
                            })()
                          ) : (
                            <span className="text-textMuted/60 italic">Missed</span>
                          )}
                        </div>
                      </div>

                      {/* Middle Row: Teams & Score */}
                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/20 border border-white/5">
                        {/* Home Team */}
                        <div className="flex items-center gap-2 w-[40%] justify-end text-right">
                          <span className="text-xs font-bold text-white/90 truncate" title={cleanHome}>{cleanHome}</span>
                          {fixture.home_logo ? (
                            <img
                              src={fixture.home_logo}
                              alt=""
                              className="w-6 h-4 object-cover rounded border border-white/10 shrink-0 shadow-sm"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center shrink-0 border border-white/10 text-[9px] font-bold text-white">
                              {cleanHome[0] || '?'}
                            </div>
                          )}
                        </div>

                        {/* Score */}
                        <span className="text-primary text-xs font-black px-2 py-0.5 rounded bg-white/5 font-mono min-w-[3.5rem] text-center shrink-0">
                          {fixture.home_score} : {fixture.away_score}
                        </span>

                        {/* Away Team */}
                        <div className="flex items-center gap-2 w-[40%] text-left">
                          {fixture.away_logo ? (
                            <img
                              src={fixture.away_logo}
                              alt=""
                              className="w-6 h-4 object-cover rounded border border-white/10 shrink-0 shadow-sm"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center shrink-0 border border-white/10 text-[9px] font-bold text-white">
                              {cleanAway[0] || '?'}
                            </div>
                          )}
                          <span className="text-xs font-bold text-white/90 truncate" title={cleanAway}>{cleanAway}</span>
                        </div>
                      </div>

                      {/* Bottom Row: Prediction info (if exists) */}
                      {prediction && (
                        <div className="text-[11px] text-textMuted/80 text-center">
                          Predicted: <span className="font-bold text-white/70">{prediction.predicted_home} - {prediction.predicted_away}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-textMuted text-xs">
                No matches concluded yet.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
