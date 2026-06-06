import React, { useState, useEffect } from 'react';
import { useFixtures } from '../api/hooks/useFixtures';
import { useTournamentContext } from '../api/TournamentContext';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
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
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Match #</Th>
                          <Th>Date & Time</Th>
                          {stage === 'group' && <Th>Group</Th>}
                          <Th>Match</Th>
                          <Th>Score</Th>
                          <Th>Status</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {list.map(fixture => (
                          <Tr
                            key={fixture.id}
                            className="cursor-pointer hover:bg-white/10"
                            onClick={() => navigate('/predictions')}
                          >
                            <Td className="font-mono text-xs text-primary font-bold">
                              {getMatchNumber(fixture.external_id)}
                            </Td>
                            <Td className="whitespace-nowrap text-textMuted">
                              {formatDateTime(fixture.kickoff_time)}
                            </Td>
                            {stage === 'group' && (
                              <Td className="text-textMuted">{fixture.group_code ?? '-'}</Td>
                            )}
                            <Td className="font-medium">
                              {(() => {
                                const cleanHome = cleanTeamName(fixture.home_team);
                                const cleanAway = cleanTeamName(fixture.away_team);
                                return (
                                  <div className="flex items-center gap-3 justify-center">
                                    <div className="flex items-center justify-end gap-2 w-60">
                                      <span className="truncate text-right w-48" title={cleanHome}>
                                        {cleanHome}
                                      </span>
                                      {fixture.home_logo ? (
                                        <img
                                          src={fixture.home_logo}
                                          alt={cleanHome}
                                          className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
                                        />
                                      ) : (
                                        <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white/60">
                                          {cleanHome[0] || '?'}
                                        </div>
                                      )}
                                    </div>

                                    <span className="text-textMuted text-xs font-bold">VS</span>

                                    <div className="flex items-center justify-start gap-2 w-60">
                                      {fixture.away_logo ? (
                                        <img
                                          src={fixture.away_logo}
                                          alt={cleanAway}
                                          className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
                                        />
                                      ) : (
                                        <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white/60">
                                          {cleanAway[0] || '?'}
                                        </div>
                                      )}
                                      <span className="truncate text-left w-48" title={cleanAway}>
                                        {cleanAway}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </Td>
                            <Td className="text-center">
                              {fixture.status === 'completed' || fixture.status === 'live' ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="font-bold text-lg">
                                    {fixture.home_score ?? '-'} : {fixture.away_score ?? '-'}
                                  </span>
                                  {fixture.home_score_aet !== null && fixture.away_score_aet !== null && (
                                    <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide">
                                      AET {fixture.home_score_aet} : {fixture.away_score_aet}
                                    </span>
                                  )}
                                  {fixture.knockout_winner && fixture.home_score_aet === fixture.away_score_aet && (
                                    <span className="text-[10px] text-violet-400 font-semibold uppercase tracking-wide">
                                      Pens · {fixture.knockout_winner} wins
                                    </span>
                                  )}
                                </div>
                              ) : '-'}
                            </Td>
                            <Td>
                              <Badge variant={fixture.status as any}>{fixture.status}</Badge>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </div>
  );
};
