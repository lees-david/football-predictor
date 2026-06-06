import React, { useState, useEffect } from 'react';
import { useFixtures } from '../api/hooks/useFixtures';
import { useTournamentContext } from '../api/TournamentContext';
import { Card } from '../components/ui/Card';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDateTime } from '../utils/timezone';
import { cleanTeamName } from '../utils/teamNames';

const STAGE_ORDER = ['group', 'round_32', 'round_16', 'quarter_final', 'semi_final', 'third_place', 'final'];
const STAGE_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round_32: 'Round of 32',
  round_16: 'Round of 16',
  quarter_final: 'Quarter-Finals',
  semi_final: 'Semi-Finals',
  third_place: 'Third Place Play-off',
  final: 'Final',
};

export const Fixtures: React.FC = () => {
  const { selectedTournamentId } = useTournamentContext();
  const { data: fixtures, isLoading } = useFixtures(selectedTournamentId);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'fixtures' | 'results'>(
    searchParams.get('tab') === 'results' ? 'results' : 'fixtures'
  );

  useEffect(() => {
    setActiveTab(searchParams.get('tab') === 'results' ? 'results' : 'fixtures');
  }, [searchParams]);
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  if (isLoading) return <div className="animate-pulse">Loading fixtures...</div>;

  const filtered = fixtures?.filter(f =>
    activeTab === 'results' ? f.status === 'completed' : f.status !== 'completed'
  ) || [];

  const sortedFiltered = [...filtered].sort((a, b) => {
    const dateA = new Date(a.kickoff_time).getTime();
    const dateB = new Date(b.kickoff_time).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return (a.group_code || '').localeCompare(b.group_code || '');
  });

  const byStage: Record<string, typeof sortedFiltered> = {};
  sortedFiltered.forEach(f => {
    if (!byStage[f.stage]) byStage[f.stage] = [];
    byStage[f.stage].push(f);
  });

  const orderedStages = STAGE_ORDER.filter(s => byStage[s]?.length);

  const toggleStage = (stage: string) =>
    setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }));

  const getMatchNumber = (externalId: string | null) => {
    if (!externalId) return '-';
    const match = externalId.match(/m(\d+)$/);
    return match ? `#${match[1]}` : externalId;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{activeTab === 'results' ? 'Results' : 'Fixtures'}</h1>

        <div className="flex bg-black/40 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('fixtures')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'fixtures' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
            }`}
          >
            Fixtures
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'results' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
            }`}
          >
            Results
          </button>
        </div>
      </div>

      {orderedStages.length === 0 ? (
        <Card className="p-8 text-center text-textMuted">
          {(() => {
            const allCompleted = (fixtures?.length ?? 0) > 0 && fixtures!.every(f => f.status === 'completed');
            const noneYet = (fixtures?.length ?? 0) === 0;
            if (activeTab === 'fixtures') {
              if (allCompleted) return (
                <div className="space-y-2">
                  <p className="font-semibold text-white">The tournament is over — all matches have been played.</p>
                  <p>
                    <Link to="/fixtures?tab=results" className="text-primary hover:underline">See the results</Link>
                    {' · '}
                    <Link to="/leagues" className="text-primary hover:underline">View your leagues</Link>
                  </p>
                </div>
              );
              if (noneYet) return (
                <div className="space-y-2">
                  <p className="font-semibold text-white">The tournament hasn't started yet.</p>
                  <p>Check back here once fixtures are announced.</p>
                </div>
              );
              return 'No upcoming fixtures.';
            } else {
              if (noneYet) return (
                <div className="space-y-2">
                  <p className="font-semibold text-white">No results yet.</p>
                  <p>Check back once matches have been played.</p>
                </div>
              );
              return 'No results yet — check back once matches are completed.';
            }
          })()}
        </Card>
      ) : (
        <div className="space-y-4">
          {orderedStages.map(stage => {
            const list = byStage[stage];
            const isOpen = openStages[stage] ?? false;
            const completedCount = list.filter(f => f.status === 'completed').length;
            const liveCount = list.filter(f => f.status === 'live').length;

            const badges = (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${
                completedCount === list.length
                  ? 'bg-success/20 text-success'
                  : 'bg-white/10 text-textMuted'
              }`}>
                {completedCount}/{list.length}
                {liveCount > 0 && (
                  <span className="ml-2 text-emerald-400 font-bold animate-pulse">· {liveCount} LIVE</span>
                )}
              </span>
            );

            return (
              <CollapsibleSection
                key={stage}
                title={STAGE_LABELS[stage] ?? stage}
                badges={badges}
                isOpen={isOpen}
                onToggle={() => toggleStage(stage)}
                bodyClassName=""
              >
                  <div className="space-y-2.5">
                    {list.map(fixture => {
                      const cleanHome = cleanTeamName(fixture.home_team);
                      const cleanAway = cleanTeamName(fixture.away_team);
                      return (
                        <div
                          key={fixture.id}
                          onClick={() => navigate('/predictions')}
                          className="p-3.5 bg-black/25 border border-white/5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer hover:bg-white/5 active:bg-white/10 transition-all duration-200"
                        >
                          <div className="flex-1 min-w-0 flex items-center gap-3">
                            {/* Match Number and Group */}
                            <div className="flex flex-col items-center justify-center bg-white/5 border border-white/10 rounded-xl p-2 min-w-[54px] flex-shrink-0">
                              <span className="font-mono text-xs text-primary font-bold">
                                {getMatchNumber(fixture.external_id)}
                              </span>
                              <span className="text-[8px] text-textMuted font-extrabold mt-1 uppercase tracking-wider">
                                {fixture.group_code ? `Group ${fixture.group_code}` : 'K.O.'}
                              </span>
                            </div>

                            {/* Teams column */}
                            <div className="flex-1 min-w-0 flex flex-col gap-2">
                              {/* Home Team */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                {fixture.home_logo ? (
                                  <img
                                    src={fixture.home_logo}
                                    alt={cleanHome}
                                    className="w-6 h-4 object-cover rounded shadow-sm border border-white/10 flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white flex-shrink-0">
                                    {cleanHome[0] || '?'}
                                  </div>
                                )}
                                <span className="text-xs font-semibold text-white/90 truncate">{cleanHome}</span>
                              </div>

                              {/* Away Team */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                {fixture.away_logo ? (
                                  <img
                                    src={fixture.away_logo}
                                    alt={cleanAway}
                                    className="w-6 h-4 object-cover rounded shadow-sm border border-white/10 flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white flex-shrink-0">
                                    {cleanAway[0] || '?'}
                                  </div>
                                )}
                                <span className="text-xs font-semibold text-white/90 truncate">{cleanAway}</span>
                              </div>
                            </div>
                          </div>

                          {/* Match Result / Date & Time */}
                          <div className="flex flex-col items-end justify-center text-right flex-shrink-0 pl-1">
                            {(() => {
                              const dt = formatDateTime(fixture.kickoff_time);
                              const parts = dt.split(', ');
                              const datePart = parts[0] || dt;
                              const timePart = parts[1] || '';

                              if (fixture.status === 'live') {
                                return (
                                  <div className="flex flex-col items-end gap-1.5 justify-center h-full">
                                    <span className="font-mono font-black text-sm text-white bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-xl leading-none">
                                      {fixture.home_score} - {fixture.away_score}
                                    </span>
                                    <span className="text-[8px] text-emerald-400 font-extrabold uppercase tracking-widest leading-none animate-pulse flex items-center gap-1 mt-0.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> LIVE
                                    </span>
                                  </div>
                                );
                              }

                              if (fixture.status === 'completed') {
                                return (
                                  <div className="flex flex-col items-end gap-1.5 justify-center h-full">
                                    <span className="font-mono font-black text-sm text-white bg-white/5 px-2.5 py-1 rounded-xl leading-none">
                                      {fixture.home_score} - {fixture.away_score}
                                    </span>
                                    <span className="text-[8px] text-textMuted font-bold uppercase tracking-wider leading-none mt-0.5">
                                      FT · {datePart}
                                    </span>
                                  </div>
                                );
                              }

                              // Scheduled
                              return (
                                <div className="flex flex-col items-end gap-1.5 justify-center h-full">
                                  <span className="text-[10px] text-textMuted font-bold uppercase tracking-wider leading-none">
                                    {datePart}
                                  </span>
                                  <span className="text-xs text-white font-black font-mono leading-none bg-white/5 border border-white/10 px-2 py-1 rounded-lg mt-0.5">
                                    {timePart}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </div>
  );
};
